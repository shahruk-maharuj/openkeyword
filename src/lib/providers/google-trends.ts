import type { KeywordIdea, KeywordMetrics, Provider, ResearchOptions } from "../types";
import { normalize } from "../text";

/**
 * Google Trends — 12-month interest for the top keywords, plus "rising"
 * related queries as extra ideas.
 *
 * Google Trends has no official API. This uses the same JSON endpoints the
 * trends.google.com page calls, so it can break or rate-limit at any time.
 * To stay polite and fail soft:
 *  - only the first {@link TOP_KEYWORDS} keywords get a trend line,
 *  - requests run one at a time with a timeout,
 *  - every answer is cached for 24 hours,
 *  - after a 429 the provider stops calling Google for a while,
 *  - any error returns nothing instead of throwing.
 */

const BASE = "https://trends.google.com/trends/api";
const USER_AGENT = "Mozilla/5.0 (compatible; OpenKeyword/0.1; +https://github.com/shahruk-maharuj/openkeyword)";

/** How many keywords get a 12-month trend line per search. */
export const TOP_KEYWORDS = 5;
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
/** How long to back off after Google says "too many requests". */
export const COOLDOWN_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 5000;
/** Stop adding trend lines once a search has spent this long on Trends. */
const METRICS_BUDGET_MS = 15000;

interface Widget {
  id: string;
  token: string;
  request: unknown;
}

export interface TrendsData {
  /** Monthly-ish interest values, 0–100, oldest first (Google returns weekly points for 12 months). */
  trend: number[];
  /** Rising related queries, most rising first. Undefined when not fetched. */
  rising?: string[];
}

/** Trends answers start with an anti-JSON-hijacking prefix like `)]}',`. */
export function parseTrendsJson(text: string): unknown {
  const start = text.search(/[[{]/);
  if (start < 0) return undefined;
  try {
    return JSON.parse(text.slice(start));
  } catch {
    return undefined;
  }
}

export function parseWidgets(body: unknown): Widget[] {
  const widgets = (body as { widgets?: unknown })?.widgets;
  if (!Array.isArray(widgets)) return [];
  return widgets.filter(
    (w): w is Widget => !!w && typeof w.id === "string" && typeof w.token === "string" && w.request !== undefined,
  );
}

/** `{ default: { timelineData: [{ value: [n], isPartial? }] } }` → [n, ...] */
export function parseTimeline(body: unknown): number[] {
  const data = (body as { default?: { timelineData?: unknown } })?.default?.timelineData;
  if (!Array.isArray(data)) return [];
  const out: number[] = [];
  for (const point of data) {
    const v = Array.isArray(point?.value) ? point.value[0] : undefined;
    if (typeof v === "number" && Number.isFinite(v)) out.push(v);
  }
  return out;
}

/** The second ranked list in a RELATED_QUERIES widget is "rising". */
export function parseRising(body: unknown): string[] {
  const lists = (body as { default?: { rankedList?: unknown } })?.default?.rankedList;
  if (!Array.isArray(lists) || lists.length < 2) return [];
  const rising = lists[1]?.rankedKeyword;
  if (!Array.isArray(rising)) return [];
  return rising
    .map((r: { query?: unknown }) => (typeof r?.query === "string" ? normalize(r.query) : ""))
    .filter(Boolean);
}

/** Collapse weekly points into 12 monthly averages so the line stays small. */
export function toMonthly(points: number[], buckets = 12): number[] {
  if (points.length <= buckets) return points;
  const out: number[] = [];
  for (let i = 0; i < buckets; i++) {
    const slice = points.slice(Math.floor((i * points.length) / buckets), Math.floor(((i + 1) * points.length) / buckets));
    out.push(Math.round(slice.reduce((a, b) => a + b, 0) / slice.length));
  }
  return out;
}

export interface TrendsProviderOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
}

export function createGoogleTrendsProvider({ fetchImpl = fetch, now = Date.now }: TrendsProviderOptions = {}): Provider {
  const cache = new Map<string, { expires: number; data: TrendsData }>();
  const pending = new Map<string, Promise<TrendsData | undefined>>();
  let cooldownUntil = 0;
  let cookie = "";
  // One request at a time, across ideas() and metrics().
  let queue: Promise<unknown> = Promise.resolve();

  function serial<T>(task: () => Promise<T>): Promise<T> {
    const run = queue.then(task, task);
    queue = run.catch(() => undefined);
    return run;
  }

  async function get(url: string): Promise<unknown> {
    if (now() < cooldownUntil) return undefined;
    const send = () =>
      fetchImpl(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "application/json, text/plain, */*", ...(cookie ? { Cookie: cookie } : {}) },
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    let res = await send();
    if (res.status === 429) {
      // Google usually hands out an NID cookie on the first 429; one retry with it is fair.
      const nid = res.headers.get("set-cookie")?.match(/NID=[^;]+/)?.[0];
      if (nid && !cookie) {
        cookie = nid;
        res = await send();
      }
    }
    if (res.status === 429) {
      cooldownUntil = now() + COOLDOWN_MS;
      return undefined;
    }
    if (!res.ok) return undefined;
    return parseTrendsJson(await res.text());
  }

  async function load(keyword: string, opts: ResearchOptions, withRising: boolean): Promise<TrendsData | undefined> {
    const hl = opts.language;
    const geo = opts.country.toUpperCase();
    const req = { comparisonItem: [{ keyword, geo, time: "today 12-m" }], category: 0, property: "" };
    const explore = await get(`${BASE}/explore?hl=${hl}&tz=0&req=${encodeURIComponent(JSON.stringify(req))}`);
    const widgets = parseWidgets(explore);
    const widget = (id: string) => widgets.find((w) => w.id === id);
    const widgetUrl = (path: string, w: Widget) =>
      `${BASE}/widgetdata/${path}?hl=${hl}&tz=0&req=${encodeURIComponent(JSON.stringify(w.request))}&token=${encodeURIComponent(w.token)}`;

    const series = widget("TIMESERIES");
    const related = withRising ? widget("RELATED_QUERIES") : undefined;
    if (!series && !related) return undefined;
    const trend = series ? toMonthly(parseTimeline(await get(widgetUrl("multiline", series)))) : [];
    const rising = related ? parseRising(await get(widgetUrl("relatedsearches", related))) : withRising ? [] : undefined;
    return { trend, rising };
  }

  /** Cached, de-duplicated, serialized, never throws. */
  function trends(keyword: string, opts: ResearchOptions, withRising = false): Promise<TrendsData | undefined> {
    const key = `${opts.country}|${opts.language}|${normalize(keyword)}`;
    const hit = cache.get(key);
    if (hit && hit.expires > now() && (!withRising || hit.data.rising)) return Promise.resolve(hit.data);
    const pendingKey = `${key}|${withRising}`;
    const inFlight = pending.get(pendingKey) ?? pending.get(`${key}|true`);
    if (inFlight) return inFlight;

    const p = serial(() => load(normalize(keyword), opts, withRising))
      .catch(() => undefined)
      .then((data) => {
        pending.delete(pendingKey);
        // Only cache real answers, so a blip doesn't hide trends for a day.
        if (data && (data.trend.length || data.rising?.length)) cache.set(key, { expires: now() + CACHE_TTL_MS, data });
        return data;
      });
    pending.set(pendingKey, p);
    return p;
  }

  return {
    id: "google-trends",
    name: "Google Trends",
    requiredEnv: [],
    async ideas(seed, opts): Promise<KeywordIdea[]> {
      const data = await trends(seed, opts, true);
      return (data?.rising ?? []).map((keyword) => ({ keyword, sources: ["google-trends"] }));
    },
    async metrics(keywords, opts): Promise<Map<string, KeywordMetrics>> {
      const out = new Map<string, KeywordMetrics>();
      // Keywords arrive seed-first in autocomplete order, which is a decent proxy for popularity.
      const deadline = now() + METRICS_BUDGET_MS;
      for (const k of keywords.slice(0, TOP_KEYWORDS)) {
        if (now() > deadline) break;
        const data = await trends(k, opts);
        if (data?.trend.length) out.set(k, { trend: data.trend });
      }
      return out;
    },
  };
}

export const googleTrendsProvider = createGoogleTrendsProvider();
