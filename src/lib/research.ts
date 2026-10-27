import type { KeywordIdea, KeywordRow, Provider, ProviderStatus, ResearchOptions } from "./types";
import { classifyIntent, clusterFor } from "./analyze";
import { normalize, wordCount } from "./text";
import { autocompleteProvider } from "./providers/autocomplete";
import { googleAdsProvider } from "./providers/google-ads";

export const PROVIDERS: Provider[] = [autocompleteProvider, googleAdsProvider];

export function providerStatus(env: Record<string, string | undefined> = process.env): ProviderStatus[] {
  return PROVIDERS.map((p) => {
    const missingEnv = p.requiredEnv.filter((k) => !env[k]);
    return { id: p.id, name: p.name, configured: !p.planned && missingEnv.length === 0, planned: !!p.planned, missingEnv };
  });
}

function isConfigured(p: Provider, env: Record<string, string | undefined>) {
  return !p.planned && p.requiredEnv.every((k) => env[k]);
}

export async function research(
  seed: string,
  opts: ResearchOptions,
  providers: Provider[] = PROVIDERS,
  env: Record<string, string | undefined> = process.env,
): Promise<KeywordRow[]> {
  const active = providers.filter((p) => isConfigured(p, env));

  // 1. Collect ideas from every idea provider and merge their sources.
  const merged = new Map<string, KeywordIdea>();
  const ideaLists = await Promise.all(active.filter((p) => p.ideas).map((p) => p.ideas!(seed, opts)));
  for (const list of ideaLists) {
    for (const idea of list) {
      const k = normalize(idea.keyword);
      const existing = merged.get(k);
      if (existing) existing.sources = [...new Set([...existing.sources, ...idea.sources])];
      else merged.set(k, { keyword: k, sources: [...idea.sources] });
    }
  }

  // 2. Attach metrics from every metrics provider.
  const keywords = [...merged.keys()];
  const metricMaps = await Promise.all(active.filter((p) => p.metrics).map((p) => p.metrics!(keywords, opts)));

  // 3. Enrich and sort: real volume first when we have it, then shorter keywords.
  return keywords
    .map((k) => {
      const metrics = Object.assign({}, ...metricMaps.map((m) => m.get(k) ?? {}));
      return {
        ...merged.get(k)!,
        ...metrics,
        intent: classifyIntent(k),
        cluster: clusterFor(k, seed),
        words: wordCount(k),
      } satisfies KeywordRow;
    })
    .sort((a, b) => (b.volume ?? -1) - (a.volume ?? -1) || a.words - b.words || a.keyword.localeCompare(b.keyword));
}
