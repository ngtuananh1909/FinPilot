import { describe, expect, it } from "vitest";
import { formatCompactVnd, formatExactVnd, vndStringToNumber } from "@/components/charts/format";
import {
  belowThresholdPolygons,
  computeYDomain,
  linePath,
  linearScale,
  maxLabelsFor,
  niceTicks,
  polygonPath,
  selectTickIndices,
} from "@/components/charts/geometry";
import { buildChartSummary } from "@/components/charts/summary";

const NBSP = "\u00a0";

describe("formatCompactVnd", () => {
  it.each([
    [2_500_000, `2,5${NBSP}tr`],
    [2_000_000, `2${NBSP}tr`],
    [850_000, `850${NBSP}k`],
    [1_200_000_000, `1,2${NBSP}tỷ`],
    [-1_500_000, `-1,5${NBSP}tr`],
    [-300_000, `-300${NBSP}k`],
    [0, "0"],
    [999, "999"],
    [-0.2, "0"],
    [9_999_999, `10${NBSP}tr`],
  ])("%s -> %s", (value, expected) => {
    expect(formatCompactVnd(value)).toBe(expected);
  });
  it("returns empty for non-finite input", () => {
    expect(formatCompactVnd(Number.NaN)).toBe("");
  });
});

describe("formatExactVnd / vndStringToNumber", () => {
  it("groups with dots and signs negatives", () => {
    expect(formatExactVnd(2_800_000)).toBe("2.800.000 ₫");
    expect(formatExactVnd(-1_000)).toBe("-1.000 ₫");
    expect(formatExactVnd(0)).toBe("0 ₫");
  });
  it("is exact up to the safe-integer limit", () => {
    expect(vndStringToNumber(String(Number.MAX_SAFE_INTEGER))).toBe(Number.MAX_SAFE_INTEGER);
    expect(vndStringToNumber("-123456789")).toBe(-123_456_789);
    expect(vndStringToNumber("abc")).toBe(0);
  });
});

describe("linearScale", () => {
  it("maps domain to range, including inverted ranges", () => {
    const y = linearScale([0, 100], [200, 0]);
    expect(y(0)).toBe(200);
    expect(y(100)).toBe(0);
    expect(y(50)).toBe(100);
  });
  it("maps a zero-width domain to the midpoint instead of NaN", () => {
    expect(linearScale([5, 5], [0, 10])(5)).toBe(5);
  });
});

describe("computeYDomain", () => {
  it("pads around the data", () => {
    expect(computeYDomain([0, 100], 0.1)).toEqual([-10, 110]);
  });
  it("handles negative balances", () => {
    const [min, max] = computeYDomain([-3_000_000, -1_000_000, 500_000]);
    expect(min).toBeLessThan(-3_000_000);
    expect(max).toBeGreaterThan(500_000);
  });
  it("gives a flat series a visible range", () => {
    const [min, max] = computeYDomain([1_000_000, 1_000_000]);
    expect(max).toBeGreaterThan(min);
    expect(min).toBeLessThan(1_000_000);
  });
  it("handles a single zero and an empty list", () => {
    const [min, max] = computeYDomain([0]);
    expect(max).toBeGreaterThan(min);
    expect(computeYDomain([])).toEqual([-1, 1]);
  });
});

describe("niceTicks", () => {
  it("picks 1/2/5 steps, ascending, inside the range", () => {
    const ticks = niceTicks(-300_000, 4_100_000, 4);
    expect(ticks).toEqual([0, 1_000_000, 2_000_000, 3_000_000, 4_000_000]);
  });
  it("never returns -0 and includes negative ticks", () => {
    const ticks = niceTicks(-2_500_000, 500_000, 4);
    expect(ticks.some((t) => Object.is(t, -0))).toBe(false);
    expect(ticks).toContain(0);
    expect(ticks[0]).toBeLessThan(0);
  });
  it("copes with huge values and degenerate ranges", () => {
    const ticks = niceTicks(0, 9_000_000_000_000, 4);
    expect(ticks.length).toBeGreaterThanOrEqual(3);
    expect(ticks.length).toBeLessThanOrEqual(8);
    expect(niceTicks(5, 5)).toEqual([5]);
    expect(niceTicks(Number.NaN, 1)).toEqual([]);
  });
});

describe("selectTickIndices", () => {
  it("always includes first and last and respects the maximum", () => {
    const idx = selectTickIndices(45, 6);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(44);
    expect(idx).toHaveLength(6);
    expect(idx).toEqual([...idx].sort((a, b) => a - b));
  });
  it("handles tiny inputs", () => {
    expect(selectTickIndices(0, 5)).toEqual([]);
    expect(selectTickIndices(1, 5)).toEqual([0]);
    expect(selectTickIndices(2, 5)).toEqual([0, 1]);
    expect(selectTickIndices(3, 10)).toEqual([0, 1, 2]);
  });
  it("on a 375px chart the labels stay at least ~50px apart", () => {
    const innerWidth = 360 - 46 - 14;
    const idx = selectTickIndices(45, maxLabelsFor(innerWidth, 56));
    for (let i = 1; i < idx.length; i += 1) {
      const gap = ((idx[i]! - idx[i - 1]!) / 44) * innerWidth;
      expect(gap).toBeGreaterThanOrEqual(50);
    }
  });
});

describe("linePath / polygonPath", () => {
  it("builds M/L commands and rounds to 2 decimals", () => {
    expect(linePath([{ x: 0, y: 1.234 }, { x: 10.005, y: 2 }])).toBe("M0 1.23L10.01 2");
    expect(linePath([])).toBe("");
    expect(polygonPath([{ x: 0, y: 0 }, { x: 1, y: 1 }])).toBe("M0 0L1 1Z");
  });
});

describe("belowThresholdPolygons", () => {
  const pts = (values: number[]) => values.map((value, x) => ({ x, value }));
  it("returns nothing when the series never goes below the threshold", () => {
    expect(belowThresholdPolygons(pts([5, 6, 7]), 5)).toEqual([]); // equal is not below
  });
  it("interpolates the crossings so the shading starts on the threshold", () => {
    const polygons = belowThresholdPolygons(pts([10, 0, 10]), 5);
    expect(polygons).toHaveLength(1);
    const xs = polygons[0]!.map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(0.5);
    expect(Math.max(...xs)).toBeCloseTo(1.5);
    expect(polygons[0]!.some((p) => p.value === 0 && p.x === 1)).toBe(true);
  });
  it("handles a series that starts and ends below, with two separate dips", () => {
    expect(belowThresholdPolygons(pts([1, 1, 9, 9, 1, 1]), 5)).toHaveLength(2);
  });
  it("handles negative thresholds and balances", () => {
    expect(belowThresholdPolygons(pts([-10, -20, -10]), -15)).toHaveLength(1);
  });
  it("skips degenerate single-point shapes (1 point series)", () => {
    expect(belowThresholdPolygons(pts([1]), 5)).toEqual([]);
    expect(belowThresholdPolygons([], 5)).toEqual([]);
  });
});

describe("buildChartSummary", () => {
  const base = {
    startDate: "2026-11-24",
    endDate: "2027-01-07",
    dayCount: 45,
    reserve: 500_000,
  };
  it("states the minimum, its date, the end balance and the breach count", () => {
    const text = buildChartSummary({
      ...base,
      series: [
        {
          label: "Số dư dự kiến",
          minimum: { date: "2026-12-03", value: -250_000 },
          end: { date: "2027-01-07", value: 1_200_000 },
          breachDays: 6,
          firstBreachDate: "2026-12-01",
        },
      ],
    });
    expect(text).toContain("45 ngày");
    expect(text).toContain("từ 24/11 đến 07/01");
    expect(text).toContain("thấp nhất -250.000 ₫ vào 03/12");
    expect(text).toContain("số dư cuối kỳ 1.200.000 ₫");
    expect(text).toContain("6 ngày dưới mức dự phòng, ngày đầu tiên là 01/12");
    expect(text).toContain("500.000 ₫");
  });
  it("says explicitly when nothing breaches and when no reserve is set", () => {
    const text = buildChartSummary({
      ...base,
      reserve: 0,
      series: [
        { label: "Mua ngay", minimum: { date: "2026-11-24", value: 5 }, end: { date: "2027-01-07", value: 9 }, breachDays: 0, firstBreachDate: null },
        { label: "Mua sau", minimum: { date: "2026-11-24", value: 6 }, end: { date: "2027-01-07", value: 9 }, breachDays: 0, firstBreachDate: null },
      ],
    });
    expect(text).toContain("Chưa đặt mức dự phòng");
    expect(text).toContain("Mua ngay: ");
    expect(text).toContain("Mua sau: ");
    expect(text.match(/không có ngày nào dưới mức dự phòng/g)).toHaveLength(2);
  });
});
