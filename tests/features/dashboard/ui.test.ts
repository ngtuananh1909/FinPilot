import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DashboardContent, type DashboardState } from "@/features/dashboard/DashboardView";
import { assistantHref, questionForAlert } from "@/features/dashboard/insight";
import { incomplete, negativeAlert, readyOverview, reserveAlert } from "./fixtures";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined }),
  usePathname: () => "/dashboard",
}));

const render = (state: DashboardState) => renderToStaticMarkup(createElement(DashboardContent, { state }));
const loaded = (over: Parameters<typeof readyOverview>[0] = {}) => render({ kind: "overview", overview: readyOverview(over) });

function expectReferencesResolve(html: string) {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const m of html.matchAll(/(?:aria-labelledby|aria-describedby|aria-controls|for)="([^"]+)"/g)) {
    for (const ref of (m[1] ?? "").split(" ")) expect(ids.has(ref), `missing id ${ref}`).toBe(true);
  }
}
const hrefs = (html: string) => [...html.matchAll(/<a [^>]*href="([^"]+)"/g)].map((m) => m[1]!.replaceAll("&amp;", "&"));

describe("Dashboard: loaded", () => {
  const html = loaded({ alerts: [reserveAlert, negativeAlert] });

  it("shows the estimated balance with its as-of time and the user's own snapshot", () => {
    expect(html).toContain("<h1");
    expect(html).toContain("Số dư ước tính");
    expect(html).toContain("2.500.000 ₫");
    expect(html).toMatch(/<time dateTime="2026-11-24T05:00:00.000Z">12:00, 24\/11\/2026<\/time>/);
    expect(html).toContain("Mốc số dư bạn nhập: 2.800.000 ₫");
  });

  it("shows month income/expense, the reserve and what is left after it", () => {
    expect(html).toContain("Thu tháng này (từ 01/11/2026)");
    expect(html).toContain("Chi tháng này");
    expect(html).toContain("300.000 ₫");
    expect(html).toContain("Còn dùng được sau dự phòng 300.000 ₫");
    expect(html).toContain("2.200.000 ₫");
  });

  it("marks a negative remainder with text colour AND a minus sign", () => {
    const negative = loaded({ availableAfterReserveVnd: "-150000" });
    expect(negative).toContain("-150.000 ₫");
    expect(negative).toContain("text-error");
  });

  it("states the balance is an estimate and the app has no bank connection", () => {
    expect(html).toContain("ước tính");
    expect(html).toContain("không kết nối ngân hàng");
  });

  it("renders the chart as role=img labelled by title + visible summary, with a data-table fallback", () => {
    expect(html).toMatch(/<svg[^>]*role="img"/);
    const labelledBy = /<svg[^>]*aria-labelledby="([^"]+)"/.exec(html)![1]!.split(" ");
    expect(labelledBy).toEqual(["dashboard-cashflow-title", "dashboard-cashflow-summary"]);
    expect(html).toContain("Xem bảng số liệu");
    expect(html.match(/<th scope="row"/g)).toHaveLength(45);
    expect(html).toContain("Dự báo dòng tiền 45 ngày");
  });

  it("does not rely on colour alone in the chart: below-reserve rows have text, markers have shapes", () => {
    expect(html).toContain("dưới mức dự phòng");
    expect(html).toContain("▼");
    expect(html).toMatch(/data-marker="minimum"/);
  });

  it("has the top alert first with a text severity label, then the others", () => {
    expect(html).toContain("Cảnh báo");
    expect(html).toContain(reserveAlert.title);
    expect(html).toContain("Cần chú ý ngay");
    expect(html).toContain(negativeAlert.title);
    expect(html.indexOf(reserveAlert.title)).toBeLessThan(html.indexOf(negativeAlert.title));
    expect(html).toContain(reserveAlert.caveat);
  });

  it("links the top alert to the Assistant with the encoded question, nothing else in the URL", () => {
    const expected = assistantHref(questionForAlert(reserveAlert));
    expect(hrefs(html)).toContain(expected);
    expect(expected).toMatch(/^\/assistant\?q=[^&#\s"]+$/);
  });

  it("still offers an Assistant link when there are no alerts, and says no alert fired", () => {
    const quiet = loaded({ alerts: [] });
    expect(quiet).toContain("Chưa có cảnh báo nào");
    expect(hrefs(quiet).some((h) => h.startsWith("/assistant?q="))).toBe(true);
  });

  it("lists upcoming items with a + / - sign, an sr-only kind, and flags income taken from the profile as an estimate", () => {
    expect(html).toContain("Tiền trọ");
    expect(html).toContain("còn 7 ngày");
    expect(html).toMatch(/Thu <\/span>\+6\.000\.000 ₫/);
    expect(html).toMatch(/Chi <\/span>-1\.500\.000 ₫/);
    expect(html).toContain("· ước tính");
  });

  it("links to Transactions and shows recent items", () => {
    expect(hrefs(html)).toContain("/transactions");
    expect(html).toContain("Cơm tấm");
    expect(html).toContain("23/11");
  });

  it("tells the user about incomplete data and links to Settings", () => {
    const partial = loaded({
      completeness: {
        complete: false,
        issues: [
          { field: "balance_snapshot", problem: "zero" },
          { field: "payday_day", problem: "missing" },
        ],
        truncated: true,
        balanceReliable: true,
        variableExpenseBasis: "missing",
      },
    });
    expect(partial).toContain("Dự báo chưa đầy đủ");
    expect(partial).toContain("số dư hiện tại, ngày nhận lương");
    expect(hrefs(partial)).toContain("/settings");
    expect(partial).toContain("chưa được tải hết");
  });

  it("explains unreconciled recurring items instead of guessing", () => {
    const html2 = loaded({ unreconciled: [{ itemId: "r1", label: "Tiền trọ", date: "2026-11-01", kind: "expense", amountVnd: "1500000" }] });
    expect(html2).toContain("chưa khớp với giao dịch nào");
    expect(html2).toContain("FinPilot không tự đoán");
  });

  it("every aria reference resolves, and nothing leaks 'undefined', 'NaN' or a bigint literal", () => {
    expectReferencesResolve(html);
    const text = html.replace(/<[^>]+>/g, " ");
    expect(text).not.toMatch(/undefined|NaN|\[object|\b\d+n\b/);
  });

  it("the DTO is JSON-serialisable (no bigint)", () => {
    expect(() => JSON.stringify(readyOverview({ alerts: [reserveAlert] }))).not.toThrow();
  });

  it("never uses fraud wording for any alert text", () => {
    expect(html).not.toMatch(/gian lận|lừa đảo|fraud/i);
  });
});

describe("Dashboard: empty (incomplete profile) - never a fabricated balance", () => {
  it.each(["profile_missing", "profile_empty", "balance_unreliable"] as const)("%s shows the message and a next step, no money", (reason) => {
    const html = render({ kind: "overview", overview: incomplete(reason) });
    expect(html).toContain("Chưa thể hiển thị số dư");
    expect(html).toContain("Chưa có hồ sơ tài chính");
    expect(html).not.toContain("₫");
    expect(html).not.toMatch(/<svg/);
    expect(html).not.toContain("Số dư ước tính");
    expect(hrefs(html).some((h) => ["/onboarding", "/settings"].includes(h))).toBe(true);
  });

  it("routes each reason to the right fix", () => {
    const of = (reason: Parameters<typeof incomplete>[0]) => hrefs(render({ kind: "overview", overview: incomplete(reason) }));
    expect(of("profile_missing")).toContain("/onboarding");
    expect(of("profile_empty")).toEqual(expect.arrayContaining(["/settings", "/transactions"]));
    expect(of("balance_unreliable")).toContain("/settings");
  });
});

describe("Dashboard: error", () => {
  const html = render({ kind: "error", message: "Máy chủ đang bận.", code: "db_unavailable" });

  it("is an alert with the message, the diagnostic code and a retry button", () => {
    expect(html).toContain('role="alert"');
    expect(html).toContain("Không tải được tổng quan");
    expect(html).toContain("Máy chủ đang bận.");
    expect(html).toContain("Mã lỗi: db_unavailable");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Thử lại<\/button>/);
  });

  it("states that no balance is shown and displays none", () => {
    expect(html).toContain("không hiển thị số dư khi chưa tính được");
    expect(html).not.toContain("₫");
  });

  it("omits the code line when there is no code", () => {
    expect(render({ kind: "error", message: "x" })).not.toContain("Mã lỗi");
  });
});
