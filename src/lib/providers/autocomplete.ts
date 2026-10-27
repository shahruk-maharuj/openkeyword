import type { KeywordIdea, Provider, ResearchOptions } from "../types";
import { mapLimit, normalize } from "../text";

const ENDPOINT = "https://suggestqueries.google.com/complete/search";

/** Question and modifier prefixes/suffixes that reveal long-tail demand. */
export const PREFIXES = ["how", "what", "why", "best", "is", "can", "where", "when", "which", "who"];
export const SUFFIXES = ["for", "vs", "near me", "without", "with", "free", "price", "review", "alternative", "examples"];
const LETTERS = "abcdefghijklmnopqrstuvwxyz".split("");

/** Every query sent to autocomplete for one seed (~47 requests). */
export function expansions(seed: string): string[] {
  const s = normalize(seed);
  return [
    s,
    ...LETTERS.map((l) => `${s} ${l}`),
    ...PREFIXES.map((p) => `${p} ${s}`),
    ...SUFFIXES.map((x) => `${s} ${x}`),
  ];
}

/** Google returns `[query, [suggestions...], ...]` for client=firefox. */
export function parseSuggestions(body: unknown): string[] {
  if (!Array.isArray(body) || !Array.isArray(body[1])) return [];
  return (body[1] as unknown[]).filter((x): x is string => typeof x === "string");
}

async function fetchSuggestions(q: string, opts: ResearchOptions, fetchImpl: typeof fetch): Promise<string[]> {
  const url = `${ENDPOINT}?client=firefox&q=${encodeURIComponent(q)}&hl=${opts.language}&gl=${opts.country}`;
  try {
    const res = await fetchImpl(url, { headers: { "User-Agent": "OpenKeyword/0.1 (+https://github.com/shahruk-maharuj/openkeyword)" } });
    if (!res.ok) return [];
    const text = await res.text();
    return parseSuggestions(JSON.parse(text));
  } catch {
    return [];
  }
}

export function createAutocompleteProvider(fetchImpl: typeof fetch = fetch): Provider {
  return {
    id: "google-autocomplete",
    name: "Google Autocomplete",
    requiredEnv: [],
    async ideas(seed, opts): Promise<KeywordIdea[]> {
      const queries = expansions(seed);
      // Small concurrency on purpose: be a polite client.
      const batches = await mapLimit(queries, 4, (q) => fetchSuggestions(q, opts, fetchImpl));
      const seen = new Set<string>();
      const out: KeywordIdea[] = [];
      for (const list of batches) {
        for (const raw of list) {
          const k = normalize(raw);
          if (!k || seen.has(k)) continue;
          seen.add(k);
          out.push({ keyword: k, sources: ["google-autocomplete"] });
        }
      }
      return out;
    },
  };
}

export const autocompleteProvider = createAutocompleteProvider();
