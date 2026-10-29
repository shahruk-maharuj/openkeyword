import { describe, expect, it } from "vitest";
import { cleanSeries, sparklineGeometry, trendLabel, trendSummary } from "../src/lib/sparkline";
import { toCsv } from "../src/lib/text";

describe("sparkline geometry", () => {
  it("returns null when there is nothing to draw", () => {
    expect(sparklineGeometry(undefined, 80, 24)).toBeNull();
    expect(sparklineGeometry([], 80, 24)).toBeNull();
    expect(sparklineGeometry([42], 80, 24)).toBeNull();
    expect(sparklineGeometry([1, 2], 4, 24)).toBeNull(); // too narrow for the padding
  });

  it("spans the box edge to edge and puts the max at the top", () => {
    const g = sparklineGeometry([0, 50, 100], 100, 20, 0)!;
    expect(g.line).toBe("M0,20L50,10L100,0");
    expect(g.end).toEqual({ x: 100, y: 0 });
  });

  it("respects padding", () => {
    const g = sparklineGeometry([10, 20], 84, 24, 2)!;
    expect(g.line).toBe("M2,22L82,2");
  });

  it("closes the area path along the bottom", () => {
    const g = sparklineGeometry([0, 100], 10, 10, 0)!;
    expect(g.area).toBe("M0,10L10,0L10,10L0,10Z");
  });

  it("draws a flat series through the middle", () => {
    const g = sparklineGeometry([30, 30, 30], 80, 24)!;
    expect(g.line).toBe("M2,12L40,12L78,12");
  });

  it("ignores non-numeric junk instead of producing NaN", () => {
    const g = sparklineGeometry([0, null, "x", NaN, Infinity, 100] as unknown[], 10, 10, 0)!;
    expect(g.line).toBe("M0,10L10,0");
    expect(g.line).not.toContain("NaN");
    expect(cleanSeries("nope" as unknown as unknown[])).toEqual([]);
  });

  it("keeps coordinates short for long weekly series", () => {
    const weekly = Array.from({ length: 52 }, (_, i) => (i * 37) % 101);
    const g = sparklineGeometry(weekly, 80, 24)!;
    expect(g.line.match(/[ML]/g)).toHaveLength(52);
    for (const n of g.line.match(/-?\d+(\.\d+)?/g)!) expect(n.split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });
});

describe("trend summary", () => {
  it("compares the last quarter with the first quarter", () => {
    expect(trendSummary([40, 40, 50, 50, 60, 60, 80, 80])).toEqual({ direction: "up", changePct: 100 });
    expect(trendSummary([80, 80, 60, 60, 50, 50, 40, 40])).toEqual({ direction: "down", changePct: -50 });
  });

  it("treats small moves as flat", () => {
    expect(trendSummary([50, 52, 49, 54]).direction).toBe("flat");
  });

  it("handles rising from zero and empty data", () => {
    expect(trendSummary([0, 0, 10, 20])).toEqual({ direction: "up", changePct: null });
    expect(trendSummary([0, 0, 0])).toEqual({ direction: "flat", changePct: 0 });
    expect(trendSummary([])).toEqual({ direction: "flat", changePct: null });
  });

  it("writes a readable label", () => {
    expect(trendLabel([40, 40, 80, 80])).toBe("Interest up 100% over 12 months");
    expect(trendLabel([80, 40])).toBe("Interest down 50% over 12 months");
    expect(trendLabel([50, 50])).toBe("Interest steady over 12 months");
    expect(trendLabel([0, 30])).toBe("Interest rising from zero over 12 months");
    expect(trendLabel(undefined)).toBe("No trend data");
  });
});

describe("csv export", () => {
  it("includes the trend series as pipe-separated values", () => {
    const csv = toCsv([{ keyword: "roof repair", trend: [10, 20, 30] }, { keyword: "roof cost" }], ["keyword", "trend"]);
    expect(csv).toBe("keyword,trend\nroof repair,10|20|30\nroof cost,");
  });
});
