/** Lowercase, trim and collapse whitespace so the same keyword dedupes. */
export function normalize(keyword: string): string {
  return keyword.toLowerCase().replace(/\s+/g, " ").trim();
}

export function wordCount(keyword: string): number {
  return normalize(keyword).split(" ").filter(Boolean).length;
}

/** Run async tasks with a concurrency cap, keeping input order. */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export function toCsv(rows: Record<string, unknown>[], columns: string[]): string {
  const cell = (v: unknown) => {
    const s = v === undefined || v === null ? "" : Array.isArray(v) ? v.join("|") : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [columns.join(","), ...rows.map((r) => columns.map((c) => cell(r[c])).join(","))].join("\n");
}
