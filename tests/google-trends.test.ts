import { describe, expect, it } from "vitest";
import {
  COOLDOWN_MS,
  CACHE_TTL_MS,
  createGoogleTrendsProvider,
  parseRising,
  parseTimeline,
  parseTrendsJson,
  parseWidgets,
  toMonthly,
} from "../src/lib/providers/google-trends";
import { providerStatus } from "../src/lib/research";

const opts = { country: "us", language: "en" };

const explore = (keyword: string) =>
  `)]}'\n${JSON.stringify({
    widgets: [
      { id: "TIMESERIES", token: `ts-${keyword}`, request: { kw: keyword } },
      { id: "GEO_MAP", token: "geo", request: {} },
      { id: "RELATED_QUERIES", token: `rq-${keyword}`, request: { kw: keyword } },
    ],
  })}`;

const timeline = (values: number[]) =>
  `)]}',\n${JSON.stringify({ default: { timelineData: values.map((v) => ({ value: [v], formattedTime: "x" })) } })}`;

const related = (rising: string[]) =>
  `)]}',\n${JSON.stringify({
    default: { rankedList: [{ rankedKeyword: [{ query: "top one", value: 100 }] }, { rankedKeyword: rising.map((query) => ({ query, value: 250 })) }] },
  })}`;

/** A fake Trends backend that records every URL it sees. */
function fakeTrends(handler?: (url: URL) => Response | undefined) {
  const calls: URL[] = [];
  const fetchImpl = (async (input: string) => {
    const url = new URL(input);
    calls.push(url);
    const custom = handler?.(url);
    if (custom) return custom;
    if (url.pathname.endsWith("/explore")) {
      const req = JSON.parse(url.searchParams.get("req")!);
      return new Response(explore(req.comparisonItem[0].keyword));
    }
    if (url.pathname.endsWith("/multiline")) return new Response(timeline(Array.from({ length: 52 }, (_, i) => i)));
    if (url.pathname.endsWith("/relatedsearches")) return new Response(related(["Roof Repair Grants 2026", "diy roof repair"]));
    return new Response("not found", { status: 404 });
  }) as typeof fetch;
  return { calls, fetchImpl };
}

describe("google trends parsing", () => {
  it("strips the anti-hijacking prefix", () => {
    expect(parseTrendsJson(`)]}',\n{"a":1}`)).toEqual({ a: 1 });
    expect(parseTrendsJson("<html>blocked</html>")).toBeUndefined();
    expect(parseTrendsJson("")).toBeUndefined();
  });

  it("reads widgets, timeline and rising queries and ignores junk", () => {
    expect(parseWidgets(parseTrendsJson(explore("x"))).map((w) => w.id)).toEqual(["TIMESERIES", "GEO_MAP", "RELATED_QUERIES"]);
    expect(parseWidgets({ widgets: [{ id: "X" }] })).toEqual([]);
    expect(parseTimeline(parseTrendsJson(timeline([1, 2, 3])))).toEqual([1, 2, 3]);
    expect(parseTimeline({ default: { timelineData: [{ value: ["nope"] }, {}] } })).toEqual([]);
    expect(parseRising(parseTrendsJson(related(["A  B"])))).toEqual(["a b"]);
    expect(parseRising({ default: { rankedList: [{}] } })).toEqual([]);
    expect(parseRising(null)).toEqual([]);
  });

  it("averages weekly points into 12 months", () => {
    const monthly = toMonthly(Array.from({ length: 52 }, () => 50));
    expect(monthly).toHaveLength(12);
    expect(monthly.every((v) => v === 50)).toBe(true);
    expect(toMonthly([1, 2, 3])).toEqual([1, 2, 3]);
  });
});

describe("google trends provider", () => {
  it("needs no keys", () => {
    expect(providerStatus({}).find((p) => p.id === "google-trends")?.configured).toBe(true);
  });

  it("returns rising queries as ideas and builds the right request", async () => {
    const { calls, fetchImpl } = fakeTrends();
    const ideas = await createGoogleTrendsProvider({ fetchImpl }).ideas!("Roof Repair", { country: "gb", language: "en" });
    expect(ideas).toEqual([
      { keyword: "roof repair grants 2026", sources: ["google-trends"] },
      { keyword: "diy roof repair", sources: ["google-trends"] },
    ]);
    const req = JSON.parse(calls[0].searchParams.get("req")!);
    expect(req.comparisonItem[0]).toEqual({ keyword: "roof repair", geo: "GB", time: "today 12-m" });
    expect(calls.find((u) => u.pathname.endsWith("/relatedsearches"))?.searchParams.get("token")).toBe("rq-roof repair");
  });

  it("adds a 12-month trend for the top 5 keywords only", async () => {
    const { calls, fetchImpl } = fakeTrends();
    const keywords = ["a", "b", "c", "d", "e", "f", "g"];
    const metrics = await createGoogleTrendsProvider({ fetchImpl }).metrics!(keywords, opts);
    expect([...metrics.keys()]).toEqual(["a", "b", "c", "d", "e"]);
    expect(metrics.get("a")?.trend).toHaveLength(12);
    expect(calls.filter((u) => u.pathname.endsWith("/explore"))).toHaveLength(5);
    // Trend lines don't need related queries, so those calls are skipped.
    expect(calls.some((u) => u.pathname.endsWith("/relatedsearches"))).toBe(false);
  });

  it("caches for 24 hours, shared between ideas and metrics", async () => {
    let t = 0;
    const { calls, fetchImpl } = fakeTrends();
    const provider = createGoogleTrendsProvider({ fetchImpl, now: () => t });
    await provider.ideas!("roof", opts);
    const before = calls.length;
    await provider.metrics!(["roof"], opts);
    await provider.ideas!("roof", opts);
    expect(calls.length).toBe(before);
    // A trend fetched for metrics alone is topped up with rising queries when the seed needs them.
    await provider.metrics!(["gutter"], opts);
    const mid = calls.length;
    expect((await provider.ideas!("gutter", opts)).length).toBe(2);
    expect(calls.length).toBeGreaterThan(mid);
    t = CACHE_TTL_MS + 1;
    await provider.ideas!("roof", opts);
    expect(calls.length).toBeGreaterThan(before);
  });

  it("runs one request at a time", async () => {
    let running = 0;
    let peak = 0;
    const { fetchImpl: inner } = fakeTrends();
    const fetchImpl = (async (...args: Parameters<typeof fetch>) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 2));
      running--;
      return inner(...args);
    }) as typeof fetch;
    const provider = createGoogleTrendsProvider({ fetchImpl });
    await Promise.all([provider.ideas!("seed", opts), provider.metrics!(["a", "b", "c"], opts)]);
    expect(peak).toBe(1);
  });

  it("fails soft on errors, garbage and timeouts", async () => {
    const broken = [
      () => new Response("server error", { status: 500 }),
      () => new Response("<html>captcha</html>"),
      () => { throw new Error("network down"); },
    ];
    for (const make of broken) {
      const provider = createGoogleTrendsProvider({ fetchImpl: (async () => make()) as typeof fetch });
      await expect(provider.ideas!("roof", opts)).resolves.toEqual([]);
      await expect(provider.metrics!(["roof"], opts)).resolves.toEqual(new Map());
    }
  });

  it("retries once with Google's cookie, then backs off after a 429", async () => {
    let t = 0;
    const { calls, fetchImpl } = fakeTrends(() =>
      new Response("slow down", { status: 429, headers: { "set-cookie": "NID=abc123; path=/; HttpOnly" } }),
    );
    const provider = createGoogleTrendsProvider({ fetchImpl, now: () => t });
    expect(await provider.ideas!("roof", opts)).toEqual([]);
    expect(calls).toHaveLength(2); // first try + one retry with the cookie

    expect(await provider.metrics!(["a", "b"], opts)).toEqual(new Map());
    expect(calls).toHaveLength(2); // cooling down: no new requests

    t = COOLDOWN_MS + 1;
    await provider.ideas!("roof", opts);
    expect(calls.length).toBeGreaterThan(2);
  });

  it("sends the cookie on the retry", async () => {
    const seen: (string | undefined)[] = [];
    let first = true;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      seen.push((init?.headers as Record<string, string>)?.Cookie);
      if (first) {
        first = false;
        return new Response("", { status: 429, headers: { "set-cookie": "NID=xyz; path=/" } });
      }
      return new Response("nope", { status: 404 });
    }) as typeof fetch;
    await createGoogleTrendsProvider({ fetchImpl }).ideas!("roof", opts);
    expect(seen).toEqual([undefined, "NID=xyz"]);
  });
});
