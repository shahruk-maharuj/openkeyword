"use client";

import { useEffect, useMemo, useState } from "react";
import type { Intent, KeywordRow, ProviderStatus } from "@/lib/types";
import { toCsv } from "@/lib/text";

const COUNTRIES: [string, string][] = [
  ["us", "United States"], ["gb", "United Kingdom"], ["ca", "Canada"], ["au", "Australia"],
  ["ae", "UAE"], ["in", "India"], ["bd", "Bangladesh"], ["de", "Germany"], ["fr", "France"], ["es", "Spain"],
];
const LANGS: [string, string][] = [["en", "English"], ["bn", "Bangla"], ["de", "German"], ["fr", "French"], ["es", "Spanish"], ["ar", "Arabic"], ["hi", "Hindi"]];
const INTENTS: Intent[] = ["informational", "commercial", "transactional", "navigational"];
const INTENT_STYLE: Record<Intent, string> = {
  informational: "bg-sky-50 text-sky-800 ring-sky-200",
  commercial: "bg-amber-50 text-amber-800 ring-amber-200",
  transactional: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  navigational: "bg-zinc-100 text-zinc-700 ring-zinc-200",
};

interface Result { seed: string; count: number; ms: number; rows: KeywordRow[] }

export default function Home() {
  const [seed, setSeed] = useState("");
  const [country, setCountry] = useState("us");
  const [lang, setLang] = useState("en");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [intent, setIntent] = useState<Intent | "all">("all");
  const [cluster, setCluster] = useState<string | null>(null);
  const [filter, setFilter] = useState("");

  useEffect(() => {
    fetch("/api/providers").then((r) => r.json()).then((d) => setProviders(d.providers)).catch(() => {});
  }, []);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!seed.trim()) return;
    setLoading(true); setError(null); setIntent("all"); setCluster(null); setFilter("");
    try {
      const res = await fetch(`/api/research?q=${encodeURIComponent(seed)}&country=${country}&lang=${lang}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Something went wrong.");
      setResult(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  const clusters = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of result?.rows ?? []) counts.set(r.cluster, (counts.get(r.cluster) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1]);
  }, [result]);

  const rows = useMemo(() => {
    const f = filter.trim().toLowerCase();
    return (result?.rows ?? []).filter(
      (r) => (intent === "all" || r.intent === intent) && (!cluster || r.cluster === cluster) && (!f || r.keyword.includes(f)),
    );
  }, [result, intent, cluster, filter]);

  const intentCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of result?.rows ?? []) c[r.intent] = (c[r.intent] ?? 0) + 1;
    return c;
  }, [result]);

  function exportCsv() {
    const csv = toCsv(rows as unknown as Record<string, unknown>[], ["keyword", "intent", "cluster", "words", "volume", "cpcLow", "cpcHigh", "competition", "trend", "sources"]);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = Object.assign(document.createElement("a"), { href: url, download: `openkeyword-${result?.seed.replace(/\s+/g, "-")}.csv` });
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6">
      <header className="flex items-baseline justify-between gap-4">
        <h1 className="text-xl font-semibold tracking-tight">OpenKeyword</h1>
        <a href="https://github.com/shahruk-maharuj/openkeyword" className="text-sm text-zinc-500 hover:text-zinc-900">GitHub ↗</a>
      </header>
      <p className="mt-1 text-sm text-zinc-500">Free, self-hosted keyword research. Real data, your own keys.</p>

      <form onSubmit={run} className="mt-8 flex flex-col gap-2 sm:flex-row">
        <input
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          placeholder="Seed keyword, e.g. roof repair"
          className="h-11 flex-1 rounded-md border border-zinc-300 px-3 outline-none focus:border-zinc-900"
          maxLength={80}
        />
        <select value={country} onChange={(e) => setCountry(e.target.value)} className="h-11 rounded-md border border-zinc-300 px-2" aria-label="Country">
          {COUNTRIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select value={lang} onChange={(e) => setLang(e.target.value)} className="h-11 rounded-md border border-zinc-300 px-2" aria-label="Language">
          {LANGS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <button disabled={loading} className="h-11 rounded-md bg-zinc-900 px-5 font-medium text-white disabled:opacity-50">
          {loading ? "Researching…" : "Research"}
        </button>
      </form>

      {providers.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2 text-xs">
          {providers.map((p) => (
            <li key={p.id} className="rounded-full border border-zinc-200 px-2.5 py-1 text-zinc-600" title={p.missingEnv.length ? `Needs: ${p.missingEnv.join(", ")}` : undefined}>
              <span className={`mr-1.5 inline-block size-1.5 rounded-full align-middle ${p.configured ? "bg-emerald-500" : "bg-zinc-300"}`} />
              {p.name}{p.planned ? " · coming soon" : !p.configured ? " · add keys" : ""}
            </li>
          ))}
        </ul>
      )}

      {error && <p className="mt-6 rounded-md bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}

      {result && (
        <section className="mt-10">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-zinc-500">
              <span className="font-medium text-zinc-900">{result.count}</span> keywords for “{result.seed}” in {(result.ms / 1000).toFixed(1)}s
            </p>
            <div className="flex gap-2">
              <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter…" className="h-9 w-40 rounded-md border border-zinc-300 px-2 text-sm" />
              <button onClick={exportCsv} className="h-9 rounded-md border border-zinc-300 px-3 text-sm hover:bg-zinc-50">Export CSV</button>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {(["all", ...INTENTS] as const).map((i) => (
              <button key={i} onClick={() => setIntent(i)} className={`rounded-md px-3 py-1.5 text-sm capitalize ${intent === i ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-700 hover:bg-zinc-200"}`}>
                {i} <span className="opacity-60">{i === "all" ? result.count : intentCounts[i] ?? 0}</span>
              </button>
            ))}
          </div>

          <div className="mt-6 grid gap-6 lg:grid-cols-[220px_1fr]">
            <aside>
              <h2 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Clusters</h2>
              <ul className="mt-2 max-h-[60vh] space-y-0.5 overflow-auto text-sm">
                {clusters.map(([c, n]) => (
                  <li key={c}>
                    <button onClick={() => setCluster(cluster === c ? null : c)} className={`flex w-full justify-between rounded px-2 py-1 text-left ${cluster === c ? "bg-zinc-900 text-white" : "hover:bg-zinc-100"}`}>
                      <span className="truncate">{c}</span><span className="opacity-60">{n}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="overflow-x-auto rounded-md border border-zinc-200">
              <table className="w-full text-sm">
                <thead className="bg-zinc-50 text-left text-xs uppercase tracking-wide text-zinc-500">
                  <tr><th className="px-3 py-2">Keyword</th><th className="px-3 py-2">Intent</th><th className="px-3 py-2 text-right">Words</th><th className="px-3 py-2 text-right">Volume</th><th className="px-3 py-2 text-right">CPC</th></tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.keyword} className="border-t border-zinc-100">
                      <td className="px-3 py-2">{r.keyword}</td>
                      <td className="px-3 py-2"><span className={`rounded px-1.5 py-0.5 text-xs capitalize ring-1 ${INTENT_STYLE[r.intent]}`}>{r.intent}</span></td>
                      <td className="px-3 py-2 text-right tabular-nums text-zinc-500">{r.words}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.volume?.toLocaleString() ?? <span className="text-zinc-300">—</span>}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.cpcHigh !== undefined ? `$${r.cpcLow?.toFixed(2)}–${r.cpcHigh.toFixed(2)}` : <span className="text-zinc-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length === 0 && <p className="px-3 py-8 text-center text-sm text-zinc-400">No keywords match these filters.</p>}
            </div>
          </div>
          {result.count === 0 && (
            <p className="mt-4 rounded-md bg-amber-50 px-4 py-3 text-sm text-amber-800">
              No suggestions came back. Either Google couldn&apos;t be reached from this server, or it is rate-limiting requests. Wait a minute and try again.
            </p>
          )}
          {result.count > 0 && result.rows.every((r) => r.volume === undefined) && (
            <p className="mt-4 text-xs text-zinc-500">Volume and CPC appear once Google Keyword Planner is connected. See the README.</p>
          )}
        </section>
      )}
    </main>
  );
}
