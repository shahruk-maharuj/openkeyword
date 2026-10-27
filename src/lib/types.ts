export type Intent = "informational" | "commercial" | "transactional" | "navigational";

export interface ResearchOptions {
  /** Two-letter country code, e.g. "us", "gb", "bd". */
  country: string;
  /** Two-letter language code, e.g. "en". */
  language: string;
}

export interface KeywordIdea {
  keyword: string;
  /** Which provider(s) surfaced this keyword. */
  sources: string[];
}

export interface KeywordMetrics {
  /** Average monthly searches. */
  volume?: number;
  /** Low/high top-of-page bid, in the account currency. */
  cpcLow?: number;
  cpcHigh?: number;
  /** 0–100 competition index from Google Ads. */
  competition?: number;
}

export interface KeywordRow extends KeywordIdea, KeywordMetrics {
  intent: Intent;
  cluster: string;
  words: number;
}

/**
 * A data source. Every source is a provider, so adding a new one
 * (Bing, YouTube, Amazon, DataForSEO…) means adding one file.
 */
export interface Provider {
  id: string;
  name: string;
  /** Environment variables the provider needs. Empty = works with no keys. */
  requiredEnv: string[];
  /** True while the provider is on the roadmap but not built yet. */
  planned?: boolean;
  /** Expand a seed into keyword ideas. */
  ideas?(seed: string, opts: ResearchOptions): Promise<KeywordIdea[]>;
  /** Attach real metrics to a list of keywords. */
  metrics?(keywords: string[], opts: ResearchOptions): Promise<Map<string, KeywordMetrics>>;
}

export interface ProviderStatus {
  id: string;
  name: string;
  configured: boolean;
  planned: boolean;
  missingEnv: string[];
}
