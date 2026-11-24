import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AssistantView } from "@/features/assistant/AssistantView";
import { SUGGESTED_PROMPTS, formatChangeValue, summarizeEvidence } from "@/features/assistant/evidence";
import { MAX_QUESTION_CHARS, sanitizePrefill } from "@/lib/assistant/question";

const render = (props: Partial<Parameters<typeof AssistantView>[0]> = {}) =>
  renderToStaticMarkup(createElement(AssistantView, { aiConfigured: true, initialQuota: { limit: 20, used: 3, remaining: 17 }, prefill: "", ...props }));

describe("sanitizePrefill (?q= from Dashboard/Simulator links)", () => {
  it.each([
    [undefined, ""],
    [42, ""],
    [["Tôi có đủ tiền?", "x"], "Tôi có đủ tiền?"],
    ["  a\u0000b\u202e\nc  ", "a b c"],
    ["\ud83d", ""],
    ["ok \ud83d\ude00", "ok \ud83d\ude00"],
  ])("%j -> %j", (input, expected) => {
    expect(sanitizePrefill(input)).toBe(expected);
  });

  it("caps at 300 code points without splitting surrogate pairs", () => {
    const out = sanitizePrefill("😀".repeat(400));
    expect(Array.from(out)).toHaveLength(300);
    expect(() => encodeURIComponent(out)).not.toThrow();
  });

  it("the composer limit matches the API limit", () => {
    expect(MAX_QUESTION_CHARS).toBe(2000);
  });
});

describe("summarizeEvidence (built only from typed tool fields)", () => {
  it("summarises a forecast with VND formatting", () => {
    const s = summarizeEvidence({
      name: "forecast_cashflow",
      args: {},
      ok: true,
      error: null,
      cached: false,
      result: { summary: { minimumVnd: "150000", minimumDate: "2026-12-04", endBalanceVnd: "2100000", reserveBreachDays: 3 } },
    });
    expect(s).toContain("150.000");
    expect(s).toContain("3 ngày dưới mức dự phòng");
  });

  it("explains failures and incomplete data honestly", () => {
    expect(summarizeEvidence({ name: "x", args: {}, ok: false, error: "invalid_arguments", cached: false, result: null })).toMatch(/không chạy/);
    expect(summarizeEvidence({ name: "get_financial_snapshot", args: {}, ok: true, error: null, cached: false, result: { status: "incomplete" } })).toMatch(
      /chưa đủ/,
    );
  });

  it("formats proposal values", () => {
    expect(formatChangeValue("projectedMonthlyBudgetVnd", "3000000")).toContain("3.000.000");
    expect(formatChangeValue("targetDate", "2027-06-01")).toBe("01/06/2027");
    expect(formatChangeValue("name", null)).toBe("—");
  });
});

describe("AssistantView markup", () => {
  it("shows the suggested prompts from docs/02, quota and a labelled composer", () => {
    const html = render();
    for (const p of SUGGESTED_PROMPTS) expect(html).toContain(p);
    expect(html).toContain("Còn <strong class=\"tabular-nums\">17</strong>/20 lượt hôm nay");
    expect(html).toMatch(/<label[^>]*class="sr-only"[^>]*>Câu hỏi cho trợ lý<\/label>/);
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('maxLength="2000"');
  });

  it("puts a prefill in the composer but does not send it", () => {
    const html = render({ prefill: "Tại sao chi tiêu tuần này tăng?" });
    expect(html).toContain(">Tại sao chi tiêu tuần này tăng?</textarea>");
    expect(html).not.toContain("đang tra cứu");
  });

  it("AC-15: not configured -> explicit status, composer disabled, links to non-AI pages, no fake answer", () => {
    const html = render({ aiConfigured: false });
    expect(html).toContain("Trợ lý AI chưa được cấu hình");
    expect(html).toContain("không tạo câu trả lời giả");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
    expect(html).toContain('href="/simulator"');
  });

  it("AC-14: exhausted quota disables the composer with a clear message", () => {
    const html = render({ initialQuota: { limit: 20, used: 20, remaining: 0 } });
    expect(html).toContain("dùng hết lượt trò chuyện hôm nay");
    expect(html).toMatch(/<textarea[^>]*disabled=""/);
  });
});

describe("RichText (model text, no HTML injection)", () => {
  it("renders **bold** as <strong>, bullets as •, and escapes HTML", async () => {
    const { RichText } = await import("@/features/assistant/RichText");
    const html = renderToStaticMarkup(
      createElement(RichText, { text: "## Kết luận\n- Tiền trọ **đủ khả năng chi trả**\n<img src=x onerror=alert(1)> **x" }),
    );
    expect(html).toContain("<strong>đủ khả năng chi trả</strong>");
    expect(html).toContain("• Tiền trọ");
    expect(html).toContain("Kết luận");
    expect(html).not.toContain("##");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("**");
  });

  it("formats evidence dates as dd/mm/yyyy", () => {
    const s = summarizeEvidence({
      name: "forecast_cashflow",
      args: {},
      ok: true,
      error: null,
      cached: false,
      result: { summary: { minimumVnd: "-778147", minimumDate: "2026-12-24", endBalanceVnd: "1533335", reserveBreachDays: 7 } },
    });
    expect(s).toContain("24/12/2026");
  });
});
