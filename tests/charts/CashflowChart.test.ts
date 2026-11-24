import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CashflowChart, type CashflowChartProps, type ChartSeries } from "@/components/charts/CashflowChart";
import { addDays } from "@/lib/finance";

const dates = (n: number, start = "2026-11-24") => Array.from({ length: n }, (_, i) => addDays(start, i));
const series = (values: number[], id = "balance", variant: ChartSeries["variant"] = "primary", label = "Số dư dự kiến"): ChartSeries => ({
  id,
  label,
  variant,
  points: values.map((value, i) => ({ date: addDays("2026-11-24", i), value })),
});
const base: Omit<CashflowChartProps, "series"> = {
  idPrefix: "t",
  title: "Dự báo số dư",
  summary: "Tóm tắt: thấp nhất 100.000 ₫ vào 03/12.",
  reserve: 300_000,
};
const render = (props: Partial<CashflowChartProps> & { series: readonly ChartSeries[] }) =>
  renderToStaticMarkup(createElement(CashflowChart, { ...base, ...props }));

const dip = [2_000_000, 1_000_000, 100_000, 50_000, 800_000, 1_500_000];

describe("CashflowChart accessibility", () => {
  const html = render({ series: [series(dip)], markers: [{ seriesId: "balance", date: "2026-11-27", kind: "minimum", label: "Thấp nhất" }] });

  it("is an image with aria-labelledby pointing at the title and the visible summary", () => {
    expect(html).toMatch(/<svg[^>]*role="img"/);
    const labelledBy = /<svg[^>]*aria-labelledby="([^"]+)"/.exec(html)![1]!.split(" ");
    expect(labelledBy).toEqual(["t-title", "t-summary"]);
    for (const id of labelledBy) expect(html).toContain(`id="${id}"`);
    expect(html).toMatch(/<title id="t-title">Dự báo số dư<\/title>/);
    expect(html).toMatch(/<figcaption id="t-summary"[^>]*>Tóm tắt: thấp nhất 100\.000 ₫ vào 03\/12\.<\/figcaption>/);
  });

  it("is responsive: viewBox on the root svg, no fixed width/height", () => {
    const root = /<svg[^>]*role="img"[^>]*>/.exec(html)![0];
    expect(root).toContain("viewBox=");
    expect(root).not.toMatch(/\swidth=|\sheight=/);
    expect(root).toMatch(/w-full/);
  });

  it("offers a data table fallback with a row for every day and a row header per date", () => {
    expect(html).toContain("<details");
    expect(html).toContain("Xem bảng số liệu");
    expect(html.match(/<tr/g)).toHaveLength(dip.length + 1);
    expect(html.match(/<th scope="row"/g)).toHaveLength(dip.length);
    expect(html).toContain('<th scope="col"');
  });

  it("does not rely on color alone: hatch pattern, dashed reserve line, text labels, sr-only breach text", () => {
    expect(html).toContain("<pattern");
    expect(html).toContain('stroke-dasharray="2 3"');
    expect(html).toContain("Dự phòng 300\u00a0k");
    expect(html).toContain("Dưới mức dự phòng");
    expect(html).toContain("(dưới mức dự phòng)");
    expect(html).toContain('data-testid="below-reserve-area"');
  });

  it("draws no animation (nothing to disable for prefers-reduced-motion)", () => {
    expect(html).not.toMatch(/<animate|animation|transition/);
  });

  it("labels the zero line and a thin set of date ticks including first and last", () => {
    expect(html).toContain("0 ₫");
    const many = render({ series: [series(Array.from({ length: 45 }, (_, i) => 3_000_000 - i * 60_000))] });
    const xLabels = [...many.matchAll(/>(\d{2}\/\d{2})<\/text>/g)].map((m) => m[1]);
    expect(xLabels.length).toBeLessThanOrEqual(6);
    expect(xLabels[0]).toBe("24/11");
    expect(xLabels[xLabels.length - 1]).toBe("07/01");
  });
});

describe("CashflowChart rendering cases", () => {
  const bad = /NaN|undefined|Infinity/;

  it("shades only when the line goes below the reserve", () => {
    expect(render({ series: [series([2_000_000, 1_500_000, 1_000_000])] })).not.toContain('data-testid="below-reserve-area"');
    expect(render({ series: [series(dip)] }).match(/data-testid="below-reserve-area"/g)).toHaveLength(1);
  });

  it("handles negative balances, a flat series, one point and huge values without NaN", () => {
    for (const values of [[-3_000_000, -1_000_000, 500_000], [1_000_000, 1_000_000, 1_000_000], [750_000], [9_000_000_000_000_000, 8_000_000_000_000_000]]) {
      const html = render({ series: [series(values)] });
      expect(html, JSON.stringify(values)).not.toMatch(bad);
      expect(html).toContain("<path");
    }
    expect(render({ series: [series([-3_000_000, -1_000_000])] })).toContain("-3\u00a0tr");
  });

  it("renders an empty series list without crashing", () => {
    const html = render({ series: [] });
    expect(html).not.toMatch(bad);
    expect(html).toContain("<svg");
  });

  it("renders two scenarios: legend entries, dashed second line, shared table columns", () => {
    const html = render({
      series: [series(dip, "now", "primary", "Mua ngay"), series(dip.map((v) => v + 500_000), "later", "secondary", "Mua sau")],
      markers: [{ seriesId: "later", date: "2026-11-26", kind: "purchase", label: "Mua sau (ngày mua)" }],
    });
    expect(html).toContain("Mua ngay");
    expect(html).toContain("Mua sau");
    expect(html).toContain('stroke-dasharray="7 3"');
    expect(html).toContain('data-marker="purchase"');
    expect(html.match(/<th scope="col"/g)).toHaveLength(4); // date + 2 series + notes
    expect(html).toContain("Mua sau (ngày mua)");
  });

  it("uses distinct shapes for income and expense markers and lists them in the table", () => {
    const html = render({
      series: [series(dip)],
      markers: [
        { seriesId: "balance", date: "2026-11-25", kind: "income", label: "Lương" },
        { seriesId: "balance", date: "2026-11-26", kind: "expense", label: "Tiền trọ" },
      ],
    });
    expect(html).toContain('data-marker="income"');
    expect(html).toContain('data-marker="expense"');
    const poly = [...html.matchAll(/<polygon points="([^"]+)"/g)].map((m) => m[1]);
    expect(new Set(poly).size).toBe(2);
    expect(html).toContain("Lương");
    expect(html).toContain("Tiền trọ");
  });

  it("hides the reserve line and label when the reserve is zero, and skips markers on unknown dates", () => {
    const html = render({
      series: [series(dip)],
      reserve: 0,
      markers: [{ seriesId: "balance", date: "2030-01-01", kind: "minimum", label: "Thấp nhất" }],
    });
    expect(html).not.toContain("Dự phòng 0");
    expect(html).not.toContain('stroke-dasharray="2 3"');
    expect(html).not.toContain('data-marker="minimum"');
    expect(html).not.toContain('data-testid="below-reserve-area"');
  });

  it("escapes text coming from labels", () => {
    const html = render({
      series: [series(dip)],
      markers: [{ seriesId: "balance", date: "2026-11-25", kind: "income", label: "<script>alert(1)</script>" }],
    });
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("dates helper sanity", () => {
    expect(dates(3)).toEqual(["2026-11-24", "2026-11-25", "2026-11-26"]);
  });
});
