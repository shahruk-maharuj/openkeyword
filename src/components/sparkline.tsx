import { sparklineGeometry, trendLabel, trendSummary } from "@/lib/sparkline";

const COLOR = {
  up: "text-emerald-600",
  down: "text-rose-500",
  flat: "text-zinc-400",
} as const;

/** Tiny inline SVG trend line. Renders a dash when there is nothing to draw. */
export function Sparkline({ values, width = 80, height = 24 }: { values?: number[]; width?: number; height?: number }) {
  const geo = sparklineGeometry(values, width, height);
  if (!geo) return <span className="text-zinc-300">—</span>;

  const label = trendLabel(values);
  const { direction } = trendSummary(values);

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={label}
      className={`inline-block align-middle ${COLOR[direction]}`}
    >
      <title>{label}</title>
      <path d={geo.area} fill="currentColor" opacity={0.12} />
      <path d={geo.line} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={geo.end.x} cy={geo.end.y} r={1.75} fill="currentColor" />
    </svg>
  );
}
