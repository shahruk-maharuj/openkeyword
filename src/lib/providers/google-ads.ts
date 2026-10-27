import type { KeywordMetrics, Provider } from "../types";

/**
 * Google Ads Keyword Planner — real search volume, CPC and competition.
 *
 * Needs a Google Ads account, a developer token and OAuth credentials:
 * https://developers.google.com/google-ads/api/docs/get-started/introduction
 *
 * Status: not implemented yet. It's the first item on ROADMAP.md.
 * Until then it reports itself as unconfigured and returns nothing,
 * so the app keeps working with keyless sources.
 */
export const GOOGLE_ADS_ENV = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
];

export const googleAdsProvider: Provider = {
  id: "google-ads",
  name: "Google Keyword Planner",
  requiredEnv: GOOGLE_ADS_ENV,
  planned: true,
  async metrics(): Promise<Map<string, KeywordMetrics>> {
    return new Map();
  },
};
