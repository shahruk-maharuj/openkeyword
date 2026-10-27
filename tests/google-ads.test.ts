import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildRequestBody,
  chunk,
  createGoogleAdsProvider,
  isPlannable,
  MAX_KEYWORDS_PER_CALL,
  parseHistoricalMetrics,
} from "../src/lib/providers/google-ads";

const ENV = {
  GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token",
  GOOGLE_ADS_CLIENT_ID: "client-id",
  GOOGLE_ADS_CLIENT_SECRET: "client-secret",
  GOOGLE_ADS_REFRESH_TOKEN: "refresh-token",
  GOOGLE_ADS_CUSTOMER_ID: "123-456-7890",
};
const US_EN = { country: "us", language: "en" };

interface Call { url: string; init?: RequestInit }

/** A fake fetch that answers the OAuth and Ads endpoints like Google does. */
function fakeGoogle(opts: { adsStatus?: number; tokenStatus?: number } = {}) {
  const calls: Call[] = [];
  const fetchImpl = (async (url: string, init?: RequestInit) => {
    calls.push({ url, init });
    if (url.startsWith("https://oauth2.googleapis.com/token")) {
      if (opts.tokenStatus) return new Response("{}", { status: opts.tokenStatus });
      return Response.json({ access_token: "access-1", expires_in: 3599 });
    }
    if (opts.adsStatus) return new Response('{"error":{"message":"nope"}}', { status: opts.adsStatus });
    const body = JSON.parse(String(init!.body)) as { keywords: string[] };
    return Response.json({
      results: body.keywords.map((text, i) => ({
        text,
        closeVariants: text === "roof repair" ? ["roof repairs"] : undefined,
        keywordMetrics: {
          avgMonthlySearches: String(1000 + i),
          competition: "MEDIUM",
          competitionIndex: "42",
          lowTopOfPageBidMicros: "1250000",
          highTopOfPageBidMicros: "4999999",
        },
      })),
    });
  }) as typeof fetch;
  return { fetchImpl, calls, adsCalls: () => calls.filter((c) => c.url.includes("googleads.googleapis.com")) };
}

afterEach(() => vi.restoreAllMocks());

describe("google ads helpers", () => {
  it("parses metrics, converts micros and maps close variants", () => {
    const m = parseHistoricalMetrics({
      results: [
        {
          text: "Roof Repair",
          closeVariants: ["roof repairs"],
          keywordMetrics: { avgMonthlySearches: "2400", competitionIndex: "67", lowTopOfPageBidMicros: "1500000", highTopOfPageBidMicros: "7254321" },
        },
        { text: "no metrics" },
        { text: "zero volume", keywordMetrics: {} },
        null,
      ],
    });
    expect(m.get("roof repair")).toEqual({ volume: 2400, competition: 67, cpcLow: 1.5, cpcHigh: 7.25 });
    expect(m.get("roof repairs")).toEqual(m.get("roof repair"));
    expect(m.has("no metrics")).toBe(false);
    expect(m.get("zero volume")).toEqual({});
  });

  it("ignores junk responses", () => {
    expect(parseHistoricalMetrics(null).size).toBe(0);
    expect(parseHistoricalMetrics({ results: "x" }).size).toBe(0);
  });

  it("builds geo and language resource names, or null when unmapped", () => {
    expect(buildRequestBody(["a"], { country: "bd", language: "bn" })).toEqual({
      keywords: ["a"],
      geoTargetConstants: ["geoTargetConstants/2050"],
      language: "languageConstants/1056",
      keywordPlanNetwork: "GOOGLE_SEARCH",
    });
    expect(buildRequestBody(["a"], { country: "zz", language: "en" })).toBeNull();
    expect(buildRequestBody(["a"], { country: "us", language: "xx" })).toBeNull();
  });

  it("drops keywords Google Ads would reject", () => {
    expect(isPlannable("roof repair")).toBe(true);
    expect(isPlannable("x".repeat(81))).toBe(false);
    expect(isPlannable("one two three four five six seven eight nine ten eleven")).toBe(false);
    expect(isPlannable("   ")).toBe(false);
  });

  it("chunks into batches", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
});

describe("google ads provider", () => {
  it("exchanges the refresh token and calls Keyword Planner with the right request", async () => {
    const g = fakeGoogle();
    const provider = createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => ENV });
    const metrics = await provider.metrics!(["Roof Repair", "roof repair cost"], US_EN);

    const token = g.calls[0];
    expect(token.url).toBe("https://oauth2.googleapis.com/token");
    const form = new URLSearchParams(String(token.init!.body));
    expect(form.get("grant_type")).toBe("refresh_token");
    expect(form.get("refresh_token")).toBe("refresh-token");
    expect(form.get("client_id")).toBe("client-id");

    const [ads] = g.adsCalls();
    expect(ads.url).toBe("https://googleads.googleapis.com/v26/customers/1234567890:generateKeywordHistoricalMetrics");
    const headers = ads.init!.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer access-1");
    expect(headers["developer-token"]).toBe("dev-token");
    expect(headers["login-customer-id"]).toBeUndefined();
    expect(JSON.parse(String(ads.init!.body))).toEqual({
      keywords: ["roof repair", "roof repair cost"],
      geoTargetConstants: ["geoTargetConstants/2840"],
      language: "languageConstants/1000",
      keywordPlanNetwork: "GOOGLE_SEARCH",
    });

    expect(metrics.get("roof repair")).toEqual({ volume: 1000, competition: 42, cpcLow: 1.25, cpcHigh: 5 });
    expect(metrics.get("roof repairs")?.volume).toBe(1000);
    expect(metrics.get("roof repair cost")?.volume).toBe(1001);
  });

  it("sends login-customer-id and honours an API version override", async () => {
    const g = fakeGoogle();
    const env = { ...ENV, GOOGLE_ADS_LOGIN_CUSTOMER_ID: "999-888-7777", GOOGLE_ADS_API_VERSION: "v27" };
    await createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => env }).metrics!(["roof"], US_EN);
    const [ads] = g.adsCalls();
    expect(ads.url).toContain("/v27/customers/1234567890:");
    expect((ads.init!.headers as Record<string, string>)["login-customer-id"]).toBe("9998887777");
  });

  it("reuses the access token across searches", async () => {
    const g = fakeGoogle();
    const provider = createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => ENV });
    await provider.metrics!(["a"], US_EN);
    await provider.metrics!(["b"], US_EN);
    expect(g.calls.filter((c) => c.url.includes("oauth2")).length).toBe(1);
    expect(g.adsCalls().length).toBe(2);
  });

  it("batches large keyword lists one call at a time", async () => {
    const g = fakeGoogle();
    const keywords = Array.from({ length: MAX_KEYWORDS_PER_CALL + 5 }, (_, i) => `kw ${i}`);
    const metrics = await createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => ENV }).metrics!(keywords, US_EN);
    const sizes = g.adsCalls().map((c) => (JSON.parse(String(c.init!.body)) as { keywords: string[] }).keywords.length);
    expect(sizes).toEqual([MAX_KEYWORDS_PER_CALL, 5]);
    expect(metrics.size).toBe(MAX_KEYWORDS_PER_CALL + 5);
  });

  it("returns nothing without keys and makes no requests", async () => {
    const g = fakeGoogle();
    const m = await createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => ({}) }).metrics!(["roof"], US_EN);
    expect(m.size).toBe(0);
    expect(g.calls.length).toBe(0);
  });

  it("skips unmapped countries instead of returning mislabelled data", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = fakeGoogle();
    const m = await createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => ENV }).metrics!(["roof"], { country: "zz", language: "en" });
    expect(m.size).toBe(0);
    expect(g.calls.length).toBe(0);
  });

  it.each([
    ["token refresh fails", { tokenStatus: 400 }],
    ["Ads API errors", { adsStatus: 403 }],
  ])("fails soft when %s", async (_, opts) => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const g = fakeGoogle(opts);
    const m = await createGoogleAdsProvider({ fetchImpl: g.fetchImpl, env: () => ENV }).metrics!(["roof"], US_EN);
    expect(m.size).toBe(0);
    expect(warn).toHaveBeenCalled();
    expect(String(warn.mock.calls[0][0])).not.toContain("client-secret");
  });

  it("fails soft when the network throws", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = (async () => { throw new Error("ECONNRESET"); }) as typeof fetch;
    const m = await createGoogleAdsProvider({ fetchImpl, env: () => ENV }).metrics!(["roof"], US_EN);
    expect(m.size).toBe(0);
  });
});
