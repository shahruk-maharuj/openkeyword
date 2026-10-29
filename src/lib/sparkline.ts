/**
 * Pure helpers for the inline SVG trend sparkline. No chart library:
 * we turn a list of 0–100 interest values into an SVG path string.
 */

export interface SparklineGeometry {
  /** Polyline path for the line itself, e.g. "M0,20L10,5". */
  line: string;
  /** Closed path for the soft fill under the line. */
  area: string;
  /** Last point, for the end-of-line dot. */
  end: { x: number; y: number };
}

/** Drop anything that isn't a finite number. */
export function cleanSeries(values: readonly unknown[] | undefined): number[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
}

const round = (n: number) => Math.round(n * 100) / 100;

/**
 * Map values onto a width × height box with `pad` pixels of breathing room.
 * The y-axis is scaled to the series' own min/max so small changes stay
 * visible; a flat series is drawn as a line through the middle.
 * Returns null when there are fewer than two points to draw.
 */
export function sparklineGeometry(
  values: readonly unknown[] | undefined,
  width: number,
  height: number,
  pad = 2,
): SparklineGeometry | null {
  const v = cleanSeries(values);
  if (v.length < 2 || width <= 2 * pad || height <= 2 * pad) return null;

  const min = Math.min(...v);
  const max = Math.max(...v);
  const range = max - min;
  const innerW = width - 2 * pad;
  const innerH = height - 2 * pad;

  const points = v.map((n, i) => ({
    x: round(pad + (i / (v.length - 1)) * innerW),
    y: round(range === 0 ? height / 2 : pad + (1 - (n - min) / range) * innerH),
  }));

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${p.x},${p.y}`).join("");
  const bottom = round(height - pad);
  const area = `${line}L${points[points.length - 1].x},${bottom}L${points[0].x},${bottom}Z`;
  return { line, area, end: points[points.length - 1] };
}

export type TrendDirection = "up" | "down" | "flat";

export interface TrendSummary {
  direction: TrendDirection;
  /** Percent change from the first quarter of the series to the last quarter. Null when it can't be computed. */
  changePct: number | null;
}

/**
 * Compare the average of the most recent quarter of the series with the
 * oldest quarter. Averaging smooths out single noisy weeks. Changes within
 * ±10% count as flat.
 */
export function trendSummary(values: readonly unknown[] | undefined, flatBand = 10): TrendSummary {
  const v = cleanSeries(values);
  if (v.length < 2) return { direction: "flat", changePct: null };

  const q = Math.max(1, Math.floor(v.length / 4));
  const avg = (xs: number[]) => xs.reduce((s, n) => s + n, 0) / xs.length;
  const first = avg(v.slice(0, q));
  const last = avg(v.slice(-q));

  if (first === 0) {
    return last === 0 ? { direction: "flat", changePct: 0 } : { direction: "up", changePct: null };
  }
  const changePct = Math.round(((last - first) / first) * 100);
  const direction: TrendDirection = changePct > flatBand ? "up" : changePct < -flatBand ? "down" : "flat";
  return { direction, changePct };
}

/** Short human label, used for the tooltip and screen readers. */
export function trendLabel(values: readonly unknown[] | undefined): string {
  const { direction, changePct } = trendSummary(values);
  if (cleanSeries(values).length < 2) return "No trend data";
  if (changePct === null) return "Interest rising from zero over 12 months";
  if (direction === "flat") return "Interest steady over 12 months";
  return `Interest ${direction} ${Math.abs(changePct)}% over 12 months`;
}
