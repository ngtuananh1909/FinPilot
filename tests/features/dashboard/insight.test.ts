import { describe, expect, it } from "vitest";
import { DEFAULT_QUESTION, SEVERITY_LABEL, assistantHref, questionForAlert } from "@/features/dashboard/insight";
import type { Alert, AlertCode } from "@/lib/alerts";

const alert = (code: AlertCode, date: string | null = "2026-12-03"): Alert => ({
  code,
  severity: "warning",
  title: "t",
  body: "b",
  caveat: "c",
  date,
  evidence: {},
});

const decodedQuestion = (href: string) => {
  const url = new URL(href, "https://app.test");
  return { path: url.pathname, params: [...url.searchParams.keys()], q: url.searchParams.get("q") ?? "" };
};

describe("questionForAlert", () => {
  it("turns every alert code into a Vietnamese question (no AI call, pure text)", () => {
    const codes: AlertCode[] = ["negative_balance", "month_end_negative", "reserve_breach", "bill_due_soon", "unusual_spending"];
    for (const code of codes) {
      const q = questionForAlert(alert(code));
      expect(q.endsWith("?") || q.endsWith(".")).toBe(true);
      expect(q.length).toBeGreaterThan(20);
    }
  });

  it("puts the alert date into date-based questions as dd/mm", () => {
    expect(questionForAlert(alert("negative_balance"))).toContain("từ 03/12");
    expect(questionForAlert(alert("reserve_breach"))).toContain("từ 03/12");
    expect(questionForAlert(alert("bill_due_soon"))).not.toContain("03/12");
  });

  it("never frames a spending alert as fraud", () => {
    for (const code of ["negative_balance", "month_end_negative", "reserve_breach", "bill_due_soon", "unusual_spending"] as const) {
      expect(questionForAlert(alert(code))).not.toMatch(/gian lận|lừa đảo|fraud|đánh cắp/i);
    }
  });
});

describe("severity labels", () => {
  it("are text, so severity never relies on colour alone, and none claims fraud", () => {
    expect(Object.values(SEVERITY_LABEL).every((label) => label.length > 0)).toBe(true);
    expect(new Set(Object.values(SEVERITY_LABEL)).size).toBe(3);
  });
});

describe("assistantHref", () => {
  it("points at /assistant with a single encoded q parameter that round-trips", () => {
    const href = assistantHref(DEFAULT_QUESTION);
    expect(href.startsWith("/assistant?q=")).toBe(true);
    expect(href).not.toMatch(/\s/);
    const { path, params, q } = decodedQuestion(href);
    expect(path).toBe("/assistant");
    expect(params).toEqual(["q"]);
    expect(q).toBe(DEFAULT_QUESTION);
  });

  it("encodes characters that could break out of the query string or markup", () => {
    const hostile = `a&b=c#frag?x=1 "quote" <script>alert(1)</script> %00 \\ ../`;
    const href = assistantHref(hostile);
    const rest = href.slice("/assistant?q=".length);
    expect(rest).not.toMatch(/[&#"<>\s\\]/);
    expect(rest).not.toContain("=");
    const { params, q } = decodedQuestion(href);
    expect(params).toEqual(["q"]);
    expect(q).toBe(hostile);
  });

  it("caps the question at 300 characters", () => {
    const { q } = decodedQuestion(assistantHref("x".repeat(1000)));
    expect(q).toHaveLength(300);
    expect(decodedQuestion(assistantHref("y".repeat(300))).q).toHaveLength(300);
    expect(decodedQuestion(assistantHref("y".repeat(299))).q).toHaveLength(299);
  });

  it("bounds the URL length even when every character expands to 9 bytes", () => {
    // 300 Vietnamese characters with 3-byte UTF-8 sequences encode to at most 900 characters.
    expect(assistantHref("ệ".repeat(5000)).length).toBeLessThanOrEqual("/assistant?q=".length + 300 * 9);
  });

  it("does not throw when the cap would cut an emoji in half (URIError regression)", () => {
    const text = `${"x".repeat(299)}😀 tail`;
    expect(() => assistantHref(text)).not.toThrow();
    const { q } = decodedQuestion(assistantHref(text));
    expect([...q]).toHaveLength(300);
    expect(q.endsWith("😀")).toBe(true);
  });

  it("does not throw for a lone surrogate in user text (e.g. an item name sent through the API)", () => {
    expect(() => assistantHref(`mua \ud83d bàn phím`)).not.toThrow();
    expect(decodedQuestion(assistantHref(`mua \ud83d bàn phím`)).q).toBe("mua \uFFFD bàn phím");
  });
});
