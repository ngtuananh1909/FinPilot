import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { assistantHref } from "@/features/dashboard/insight";
import { SimulationResult } from "@/features/simulator/SimulationResult";
import { SimulatorForm } from "@/features/simulator/SimulatorForm";
import { SimulatorContent, type SimulatorState } from "@/features/simulator/SimulatorView";
import type { ReadinessDto } from "@/lib/settings/dto";
import { runSimulation, toDto } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/simulator",
}));

const bounds = { min: "2026-11-24", max: "2027-01-07" };
const render = (node: Parameters<typeof renderToStaticMarkup>[0]) => renderToStaticMarkup(node);
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");

function expectReferencesResolve(html: string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)) {
    for (const ref of (m[1] ?? "").split(" ")) expect(ids.has(ref), `missing id ${ref}`).toBe(true);
  }
}

const ready = (): SimulatorState => ({ kind: "ready", bounds, reserveVnd: "1000000" });

describe("Simulator: initial state", () => {
  const html = render(createElement(SimulatorContent, { state: ready() }));

  it("has a heading, an estimate disclaimer and a labelled field for every input", () => {
    expect(html).toContain("<h1");
    expect(html).toContain("không phải lời khuyên tài chính");
    for (const label of ["Tên món đồ (không bắt buộc)", "Số tiền (₫)", "Ngày mua ngay", "Mua sau vào", "Ngày nhận lương tiếp theo", "Chọn một ngày"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/<label for="[^"]+-cost"[^>]*>Số tiền \(₫\)<\/label>/);
    expectReferencesResolve(html);
  });

  it("limits both date inputs to the 45-day window and starts on today", () => {
    const now = /<input id="[^"]+-now"[^>]*>/.exec(html)![0];
    expect(now).toContain('type="date"');
    expect(now).toContain('min="2026-11-24"');
    expect(now).toContain('max="2027-01-07"');
    expect(now).toContain('value="2026-11-24"');
  });

  it("shows the date picker for 'later' only after choosing a date (default: next payday)", () => {
    expect(html).not.toContain("Ngày mua sau");
    const radios = html.match(/<input type="radio"[^>]*>/g)!;
    expect(radios).toHaveLength(2);
    expect(radios[0]).toContain('checked=""');
    expect(radios[1]).not.toContain("checked");
  });

  it("states the current reserve and links to Settings to change it (not editable here)", () => {
    expect(textOf(html)).toContain("Mức dự phòng tối thiểu hiện tại: 1.000.000 ₫");
    expect(hrefs(html)).toContain("/settings");
    expect(html).toContain("Thay đổi trong Cài đặt");
  });

  it("has an always-mounted error live region, a submit button, and numeric keyboard for the amount", () => {
    expect(html).toMatch(/<div role="alert" aria-live="assertive"><\/div>/);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Mô phỏng<\/button>/);
    expect(html).toContain('inputMode="numeric"');
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('aria-busy="false"');
  });

  it("renders no result, no money from the engine and no fake comparison before the first run", () => {
    expect(html).not.toContain("Kết quả mô phỏng");
    expect(html).not.toContain("simulation-result");
    expect(html).not.toMatch(/<svg/);
  });

  it("is independent of Demo: nothing in the form mentions demo or guest", () => {
    expect(html).not.toMatch(/demo|guest|khách/i);
  });
});

describe("Simulator: empty and error states", () => {
  it("empty profile: explains and links to onboarding, with no form to fill in", () => {
    const html = render(createElement(SimulatorContent, { state: { kind: "empty", message: "Chưa có hồ sơ tài chính." } }));
    expect(html).toContain("Chưa thể mô phỏng");
    expect(html).toContain("Chưa có hồ sơ tài chính.");
    expect(hrefs(html)).toContain("/onboarding");
    expect(html).not.toContain("<form");
  });

  it("load error: an alert with the code and a retry button, no form", () => {
    const html = render(createElement(SimulatorContent, { state: { kind: "error", message: "Máy chủ bận.", code: "db_unavailable" } }));
    expect(html).toContain('role="alert"');
    expect(html).toContain("Không tải được dữ liệu mô phỏng");
    expect(html).toContain("Mã lỗi: db_unavailable");
    expect(html).toMatch(/<button[^>]*>Thử lại<\/button>/);
    expect(html).not.toContain("<form");
  });
});

describe("SimulatorForm: injected submitter is not called on render", () => {
  it("renders without touching the network", () => {
    const submit = vi.fn();
    render(createElement(SimulatorForm, { bounds, reserveVnd: "0", submit }));
    expect(submit).not.toHaveBeenCalled();
  });
});

describe("SimulationResult", () => {
  const unsafeBoth = runSimulation({
    balance: 3_000_000n,
    reserve: 1_000_000n,
    cost: 2_500_000n,
    buyLater: { kind: "date", date: "2026-11-30" },
  });
  const gain = runSimulation({
    balance: 4_000_000n,
    reserve: 1_000_000n,
    monthlyIncome: 5_000_000n,
    paydayDay: 5,
    cost: 2_000_000n,
    buyLater: { kind: "next_payday" },
  });
  const unsafeHtml = render(createElement(SimulationResult, { result: toDto(unsafeBoth, "Bàn phím") }));
  const safeHtml = render(createElement(SimulationResult, { result: toDto(gain, null) }));

  it("renders the conclusion list from the server, the caveat, and both scenario cards", () => {
    expect(unsafeHtml).toContain('data-testid="simulation-result"');
    expect(unsafeHtml).toContain("Kết quả mô phỏng");
    expect(unsafeHtml).toContain("“Bàn phím”");
    expect(unsafeHtml).toContain('data-scenario="now"');
    expect(unsafeHtml).toContain('data-scenario="later"');
    expect(unsafeHtml).toContain("không phải cam kết");
  });

  it("announces 'both unsafe' in a status region and mentions the reserve", () => {
    expect(unsafeHtml).toMatch(/<p role="status"[^>]*>Cả hai cách mua đều chưa giữ được mức dự phòng theo ước tính\.<\/p>/);
    expect(textOf(unsafeHtml)).toContain("mức dự phòng 1.000.000 ₫");
    expect(safeHtml).not.toContain('role="status"');
  });

  it("scenario state is conveyed by an icon and text, not colour alone", () => {
    expect(unsafeHtml).toContain("Dưới mức dự phòng");
    expect(unsafeHtml).toContain('<span aria-hidden="true">▲</span>');
    expect(safeHtml).toContain("Giữ ≥ mức dự phòng");
    expect(safeHtml).toContain('<span aria-hidden="true">✓</span>');
    const belowZero = render(
      createElement(SimulationResult, {
        result: toDto(runSimulation({ balance: 3_000_000n, reserve: 1_000_000n, cost: 5_000_000n, buyLater: { kind: "date", date: "2026-11-30" } })),
      }),
    );
    expect(belowZero).toContain("Xuống dưới 0 ₫");
    expect(belowZero).toContain('<span aria-hidden="true">✕</span>');
  });

  it("shows lowest balance and date, end balance, breach days and headroom per scenario", () => {
    const text = textOf(unsafeHtml);
    expect(text).toContain("Thấp nhất");
    expect(text).toContain("Cuối kỳ");
    expect(text).toMatch(/Ngày dưới mức dự phòng \d+ ngày, từ \d\d\/\d\d/);
    expect(text).toContain("Chênh so với mức dự phòng -500.000 ₫");
    expect(textOf(safeHtml)).toMatch(/Chênh so với mức dự phòng \+1\.000\.000 ₫/);
  });

  it("renders the chart as role=img with title + summary and a table fallback covering both scenarios", () => {
    expect(unsafeHtml).toMatch(/<svg[^>]*role="img"/);
    expect(/<svg[^>]*aria-labelledby="([^"]+)"/.exec(unsafeHtml)![1]).toBe("simulator-cashflow-title simulator-cashflow-summary");
    expect(unsafeHtml).toContain("So sánh số dư 45 ngày: mua ngay và mua sau");
    expect(unsafeHtml).toContain("Xem bảng số liệu");
    expect(unsafeHtml.match(/<th scope="row"/g)).toHaveLength(45);
    expect(unsafeHtml).toMatch(/<th scope="col"[^>]*>Mua ngay<\/th>/);
    expect(unsafeHtml).toMatch(/<th scope="col"[^>]*>Mua sau<\/th>/);
    expect(unsafeHtml).toContain('data-marker="purchase"');
    expectReferencesResolve(unsafeHtml);
  });

  it("links to the Assistant with an encoded, length-capped question that names the item and dates", () => {
    const link = hrefs(unsafeHtml).find((h) => h.startsWith("/assistant?q="))!;
    expect(link).toBeDefined();
    expect(link).toMatch(/^\/assistant\?q=[^&#\s"]+$/);
    const q = new URL(link, "https://app.test").searchParams.get("q")!;
    expect(q).toContain("Bàn phím");
    expect(q).toContain("2.500.000 ₫");
    expect(q).toContain("23/11");
    expect(q).toContain("30/11");
    expect(q.length).toBeLessThanOrEqual(300);
    expect(unsafeHtml).toContain("Hỏi trợ lý AI để hiểu rõ hơn");
  });

  it("encodes a hostile item name instead of letting it into the URL structure or markup", () => {
    const name = `x" onmouseover="alert(1)" <b>&q=evil#`;
    const html = render(createElement(SimulationResult, { result: toDto(unsafeBoth, name) }));
    const link = hrefs(html).find((h) => h.startsWith("/assistant?q="))!;
    expect(link.slice("/assistant?q=".length)).not.toMatch(/[&#"<>\s]/);
    expect(new URL(link, "https://app.test").searchParams.getAll("q")).toHaveLength(1);
    expect(html).not.toContain("<b>");
    expect(html).not.toContain('onmouseover="alert');
  });

  it("does not crash when the item name ends in half an emoji at the 300-character cap", () => {
    const name = "a".repeat(80);
    expect(() => assistantHref(`${"x".repeat(299)}😀`)).not.toThrow();
    expect(() => render(createElement(SimulationResult, { result: toDto(unsafeBoth, `${name}😀`) }))).not.toThrow();
  });

  it("links to Settings when the profile is incomplete, and not when it is complete", () => {
    const incomplete: ReadinessDto = { complete: false, issues: [{ field: "payday_day", problem: "missing" }] };
    const html = render(createElement(SimulationResult, { result: toDto(gain, null, incomplete) }));
    expect(html).toContain("Hồ sơ tài chính chưa đầy đủ");
    expect(hrefs(html)).toContain("/settings");
    expect(hrefs(safeHtml)).not.toContain("/settings");
  });

  it("lists the assumptions and the shared-baseline note, and never promises safety", () => {
    expect(textOf(safeHtml)).toContain("khoản mua chỉ được trừ một lần vào ngày mua");
    for (const html of [unsafeHtml, safeHtml]) {
      expect(textOf(html)).not.toMatch(/đảm bảo|an toàn tuyệt đối|không rủi ro|hoàn toàn an toàn|(?<!chưa )chắc chắn/i);
    }
  });

  it("the DTO has no bigint and the markup has no 'undefined' or 'NaN'", () => {
    expect(() => JSON.stringify(toDto(unsafeBoth, "x"))).not.toThrow();
    expect(textOf(unsafeHtml)).not.toMatch(/undefined|NaN|\[object|\b\d+n\b/);
  });
});
