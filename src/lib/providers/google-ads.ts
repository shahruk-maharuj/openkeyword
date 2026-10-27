import type { KeywordMetrics, Provider, ResearchOptions } from "../types";
import { normalize } from "../text";

/**
 * Google Ads Keyword Planner — real search volume, CPC and competition.
 *
 * Uses the Google Ads REST API (`KeywordPlanIdeaService.GenerateKeywordHistoricalMetrics`)
 * with an OAuth refresh token. Needs a Google Ads account, a developer token and
 * OAuth credentials:
 * https://developers.google.com/google-ads/api/docs/get-started/introduction
 *
 * Fail-soft: any error (bad credentials, quota, network) is logged once per call
 * and the provider returns whatever it already has, so keyless sources keep working.
 */
export const GOOGLE_ADS_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
];

/** Override with GOOGLE_ADS_API_VERSION when Google sunsets this one. */
export const DEFAULT_API_VERSION = "v26";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://googleads.googleapis.com";
/** Google's documented maximum keywords per GenerateKeywordHistoricalMetrics call. */
export const MAX_KEYWORDS_PER_CALL = 10_000;
/** Google Ads rejects the whole request if any keyword is longer than this. */
const MAX_KEYWORD_CHARS = 80;
const MAX_KEYWORD_WORDS = 10;
const TIMEOUT_MS = 20_000;

/**
 * Country → geo target constant. Country criterion IDs are 2000 + the ISO 3166-1
 * numeric code: https://developers.google.com/google-ads/api/data/geotargets
 */
export const GEO_TARGETS: Record<string, number> = {
  us: 2840, gb: 2826, ca: 2124, au: 2036, nz: 2554, ie: 2372,
  ae: 2784, sa: 2682, in: 2356, bd: 2050, pk: 2586, sg: 2702,
  de: 2276, fr: 2250, es: 2724, it: 2380, nl: 2528, br: 2076, mx: 2484, za: 2710,
};

/** Language → language constant: https://developers.google.com/google-ads/api/data/codes-formats#languages */
export const LANGUAGES: Record<string, number> = {
  en: 1000, de: 1001, fr: 1002, es: 1003, it: 1004, ja: 1005, nl: 1010, ko: 1012,
  pt: 1014, zh: 1017, ar: 1019, hi: 1023, pl: 1030, ru: 1031, tr: 1037, bn: 1056,
};

type Env = Record<string, string | undefined>;

interface HistoricalMetricsResult {
  text?: string;
  closeVariants?: string[];
  keywordMetrics?: {
    avgMonthlySearches?: string | number;
    competitionIndex?: string | number;
    lowTopOfPageBidMicros?: string | number;
    highTopOfPageBidMicros?: string | number;
  };
}

/** Keywords Google Ads would reject (and fail the whole batch over). */
export function isPlannable(keyword: string): boolean {
  const k = normalize(keyword);
  return k.length > 0 && k.length <= MAX_KEYWORD_CHARS && k.split(" ").length <= MAX_KEYWORD_WORDS;
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** int64 fields arrive as strings in REST JSON. */
function num(v: unknown): number | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

function micros(v: unknown): number | undefined {
  const n = num(v);
  return n === undefined ? undefined : Math.round(n / 10_000) / 100;
}

/** Turn a GenerateKeywordHistoricalMetricsResponse into metrics keyed by normalized keyword. */
export function parseHistoricalMetrics(body: unknown): Map<string, KeywordMetrics> {
  const out = new Map<string, KeywordMetrics>();
  const results = (body as { results?: unknown })?.results;
  if (!Array.isArray(results)) return out;
  for (const r of results as HistoricalMetricsResult[]) {
    if (!r || typeof r.text !== "string" || !r.keywordMetrics) continue;
    const m = r.keywordMetrics;
    const metrics: KeywordMetrics = {};
    const volume = num(m.avgMonthlySearches);
    const competition = num(m.competitionIndex);
    const cpcLow = micros(m.lowTopOfPageBidMicros);
    const cpcHigh = micros(m.highTopOfPageBidMicros);
    if (volume !== undefined) metrics.volume = volume;
    if (competition !== undefined) metrics.competition = competition;
    if (cpcLow !== undefined) metrics.cpcLow = cpcLow;
    if (cpcHigh !== undefined) metrics.cpcHigh = cpcHigh;
    // Google merges close variants ("roof repairs" / "roof repair") into one result.
    const variants = [r.text, ...(Array.isArray(r.closeVariants) ? r.closeVariants : [])];
    for (const v of variants) {
      if (typeof v !== "string") continue;
      const k = normalize(v);
      if (k && !out.has(k)) out.set(k, metrics);
    }
  }
  return out;
}

export function buildRequestBody(keywords: string[], opts: ResearchOptions) {
  const geo = GEO_TARGETS[opts.country];
  const lang = LANGUAGES[opts.language];
  if (!geo || !lang) return null;
  return {
    keywords,
    geoTargetConstants: [`geoTargetConstants/${geo}`],
    language: `languageConstants/${lang}`,
    keywordPlanNetwork: "GOOGLE_SEARCH",
  };
}

const digits = (id: string) => id.replace(/\D/g, "");

export function createGoogleAdsProvider(options: { fetchImpl?: typeof fetch; env?: () => Env } = {}): Provider {
  const fetchImpl = options.fetchImpl ?? fetch;
  const readEnv = options.env ?? (() => process.env);
  let cachedToken: { value: string; expires: number; refreshToken: string } | null = null;

  async function accessToken(env: Env): Promise<string | null> {
    const refreshToken = env.GOOGLE_ADS_REFRESH_TOKEN!;
    if (cachedToken && cachedToken.refreshToken === refreshToken && cachedToken.expires > Date.now()) {
      return cachedToken.value;
    }
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: env.GOOGLE_ADS_CLIENT_ID!,
        client_secret: env.GOOGLE_ADS_CLIENT_SECRET!,
        refresh_token: refreshToken,
      }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      console.warn(`[google-ads] OAuth token refresh failed (HTTP ${res.status}). Check your client ID, secret and refresh token.`);
      return null;
    }
    const data = (await res.json()) as { access_token?: string; expires_in?: number };
    if (!data.access_token) return null;
    // Refresh a minute early so a token never expires mid-request.
    const ttl = Math.max(0, (data.expires_in ?? 3600) - 60) * 1000;
    cachedToken = { value: data.access_token, expires: Date.now() + ttl, refreshToken };
    return data.access_token;
  }

  return {
    id: "google-ads",
    name: "Google Keyword Planner",
    requiredEnv: GOOGLE_ADS_ENV,
    async metrics(keywords, opts): Promise<Map<string, KeywordMetrics>> {
      const out = new Map<string, KeywordMetrics>();
      const env = readEnv();
      if (GOOGLE_ADS_ENV.some((k) => !env[k])) return out;

      const plannable = [...new Set(keywords.map(normalize))].filter(isPlannable);
      if (plannable.length === 0) return out;
      if (!buildRequestBody(plannable.slice(0, 1), opts)) {
        console.warn(`[google-ads] No geo/language mapping for ${opts.country}/${opts.language}; skipping metrics.`);
        return out;
      }

      try {
        const token = await accessToken(env);
        if (!token) return out;
        const version = env.GOOGLE_ADS_API_VERSION || DEFAULT_API_VERSION;
        const customerId = digits(env.GOOGLE_ADS_CUSTOMER_ID!);
        const url = `${API_BASE}/${version}/customers/${customerId}:generateKeywordHistoricalMetrics`;
        const headers: Record<string, string> = {
          Authorization: `Bearer ${token}`,
          "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN!,
          "Content-Type": "application/json",
        };
        if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = digits(env.GOOGLE_ADS_LOGIN_CUSTOMER_ID);

        // One batch at a time on purpose: Keyword Planner has tight rate limits.
        for (const batch of chunk(plannable, MAX_KEYWORDS_PER_CALL)) {
          const res = await fetchImpl(url, {
            method: "POST",
            headers,
            body: JSON.stringify(buildRequestBody(batch, opts)),
            signal: AbortSignal.timeout(TIMEOUT_MS),
          });
          if (!res.ok) {
            if (res.status === 401) cachedToken = null;
            const detail = await res.text().catch(() => "");
            console.warn(`[google-ads] Keyword metrics request failed (HTTP ${res.status}). ${detail.slice(0, 300)}`);
            break;
          }
          for (const [k, m] of parseHistoricalMetrics(await res.json())) if (!out.has(k)) out.set(k, m);
        }
      } catch (err) {
        console.warn(`[google-ads] Keyword metrics unavailable: ${err instanceof Error ? err.message : String(err)}`);
      }
      return out;
    },
  };
}

export const googleAdsProvider = createGoogleAdsProvider();
