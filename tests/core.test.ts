import { describe, expect, it } from "vitest";
import { classifyIntent, clusterFor } from "../src/lib/analyze";
import { mapLimit, normalize, toCsv, wordCount } from "../src/lib/text";
import { createAutocompleteProvider, expansions, parseSuggestions } from "../src/lib/providers/autocomplete";
import { providerStatus, research } from "../src/lib/research";
import type { Provider } from "../src/lib/types";

describe("text helpers", () => {
  it("normalizes case and whitespace", () => {
    expect(normalize("  Roof   REPAIR ")).toBe("roof repair");
    expect(wordCount("roof  repair near me")).toBe(4);
  });

  it("caps concurrency and keeps order", async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([5, 1, 3, 2], 2, async (n) => {
      running++; peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, n));
      running--;
      return n * 10;
    });
    expect(out).toEqual([50, 10, 30, 20]);
    expect(peak).toBeLessThanOrEqual(2);
  });

  it("escapes CSV cells", () => {
    const csv = toCsv([{ k: 'say "hi", ok', s: ["a", "b"] }], ["k", "s"]);
    expect(csv).toBe('k,s\n"say ""hi"", ok",a|b');
  });
});

describe("intent", () => {
  it.each([
    ["roof repair cost", "transactional"],
    ["roof repair near me", "transactional"],
    ["best roof repair company", "commercial"],
    ["metal vs shingle roof", "commercial"],
    ["how to repair a roof leak", "informational"],
    ["roofing company login", "navigational"],
    ["roof repair", "informational"],
  ])("%s → %s", (kw, intent) => {
    expect(classifyIntent(kw)).toBe(intent);
  });

  it("matches whole words only", () => {
    // "isolation" contains "is" but isn't a question
    expect(classifyIntent("roof isolation price")).toBe("transactional");
    expect(classifyIntent("bestow roof")).toBe("informational");
  });
});

describe("clusters", () => {
  it("groups by the first meaningful non-seed word", () => {
    expect(clusterFor("roof repair cost", "roof repair")).toBe("cost");
    expect(clusterFor("how to repair a roof", "roof repair")).toBe("how");
    expect(clusterFor("roof repair", "roof repair")).toBe("(seed)");
  });
});

describe("google autocomplete provider", () => {
  it("builds seed, a–z, question and modifier queries", () => {
    const q = expansions("Roof Repair");
    expect(q[0]).toBe("roof repair");
    expect(q).toContain("roof repair a");
    expect(q).toContain("how roof repair");
    expect(q).toContain("roof repair near me");
    expect(new Set(q).size).toBe(q.length);
  });

  it("parses the firefox client response and ignores junk", () => {
    expect(parseSuggestions(["q", ["a", "b", 3]])).toEqual(["a", "b"]);
    expect(parseSuggestions({})).toEqual([]);
    expect(parseSuggestions(null)).toEqual([]);
  });

  it("dedupes across queries and survives failed requests", async () => {
    let calls = 0;
    const fakeFetch = (async (url: string) => {
      calls++;
      if (url.includes("q=roof%20repair%20z")) return new Response("oops", { status: 500 });
      const q = decodeURIComponent(new URL(url).searchParams.get("q")!);
      return new Response(JSON.stringify([q, [`${q} cost`, "Roof Repair Cost", "roof repair"]]));
    }) as typeof fetch;
    const ideas = await createAutocompleteProvider(fakeFetch).ideas!("roof repair", { country: "us", language: "en" });
    expect(calls).toBe(expansions("roof repair").length);
    const kws = ideas.map((i) => i.keyword);
    expect(new Set(kws).size).toBe(kws.length);
    expect(kws).toContain("roof repair cost");
    expect(kws).not.toContain("roof repair z cost");
  });
});

describe("research pipeline", () => {
  const ideasA: Provider = {
    id: "a", name: "A", requiredEnv: [],
    ideas: async () => [{ keyword: "Roof Repair Cost", sources: ["a"] }, { keyword: "how to fix roof", sources: ["a"] }],
  };
  const ideasB: Provider = {
    id: "b", name: "B", requiredEnv: [],
    ideas: async () => [{ keyword: "roof repair cost", sources: ["b"] }],
  };
  const metrics: Provider = {
    id: "m", name: "M", requiredEnv: ["M_KEY"],
    metrics: async () => new Map([["how to fix roof", { volume: 900, cpcLow: 1, cpcHigh: 3 }]]),
  };

  it("merges sources, enriches rows and sorts by volume", async () => {
    const rows = await research("roof repair", { country: "us", language: "en" }, [ideasA, ideasB, metrics], { M_KEY: "x" });
    expect(rows.map((r) => r.keyword)).toEqual(["how to fix roof", "roof repair cost"]);
    expect(rows[0].volume).toBe(900);
    expect(rows[1].sources.sort()).toEqual(["a", "b"]);
    expect(rows[1].intent).toBe("transactional");
  });

  it("skips providers whose keys are missing", async () => {
    const rows = await research("roof repair", { country: "us", language: "en" }, [ideasA, metrics], {});
    expect(rows.every((r) => r.volume === undefined)).toBe(true);
  });

  it("reports planned providers as not configured", () => {
    const status = providerStatus({});
    expect(status.find((p) => p.id === "google-autocomplete")?.configured).toBe(true);
    const ads = status.find((p) => p.id === "google-ads")!;
    expect(ads.configured).toBe(false);
    expect(ads.planned).toBe(true);
  });
});
