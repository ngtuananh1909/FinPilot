import { describe, expect, it } from "vitest";
import { ImportError } from "@/lib/import/errors";
import { resolveMapping, suggestMapping } from "@/lib/import/mapping";

describe("suggestMapping", () => {
  it("maps the canonical English header and ignores persona_code", () => {
    const m = suggestMapping(["persona_code", "occurred_at", "kind", "amount_vnd", "category", "merchant", "description"]);
    expect(m).toEqual({
      occurred_at: 1,
      kind: 2,
      amount_vnd: 3,
      debit_vnd: null,
      credit_vnd: null,
      category: 4,
      merchant: 5,
      description: 6,
    });
  });

  it("maps Vietnamese headers regardless of diacritics and case", () => {
    const m = suggestMapping(["Ngày giao dịch", "Thu/Chi", "Số tiền", "Danh mục", "Nội dung"]);
    expect(m).toMatchObject({ occurred_at: 0, kind: 1, amount_vnd: 2, category: 3, description: 4 });
    expect(suggestMapping(["NGAY", "so tien", "Mô tả"])).toMatchObject({ occurred_at: 0, amount_vnd: 1, description: 2 });
  });

  it("maps generic bank headers", () => {
    expect(suggestMapping(["Date", "Amount", "Description"])).toMatchObject({
      occurred_at: 0,
      amount_vnd: 1,
      description: 2,
    });
  });

  it("suggests separate debit/credit columns (Ghi nợ / Ghi có) when there is no single amount", () => {
    const m = suggestMapping(["Ngày", "Ghi nợ", "Ghi có", "Nội dung"]);
    expect(m).toMatchObject({ occurred_at: 0, debit_vnd: 1, credit_vnd: 2, description: 3, amount_vnd: null });
    expect(suggestMapping(["date", "debit", "credit"])).toMatchObject({ debit_vnd: 1, credit_vnd: 2 });
  });

  it("prefers a single amount column over debit/credit", () => {
    const m = suggestMapping(["date", "amount", "debit", "credit"]);
    expect(m.amount_vnd).toBe(1);
    expect(m.debit_vnd).toBeNull();
    expect(m.credit_vnd).toBeNull();
  });

  it("uses each column once and leaves unknown columns unmapped", () => {
    const m = suggestMapping(["foo", "bar"]);
    expect(Object.values(m).every((v) => v === null)).toBe(true);
  });
});

describe("resolveMapping", () => {
  const headers = ["a", "b", "c", "d"];

  it("reports missing date/amount instead of guessing", () => {
    expect(resolveMapping(headers).issues).toEqual(["occurred_at_missing", "amount_missing"]);
  });

  it("accepts an explicit mapping, overriding the suggestion", () => {
    const r = resolveMapping(["date", "amount", "x"], { amount_vnd: 2, description: 1 });
    expect(r.mapping).toMatchObject({ occurred_at: 0, amount_vnd: 2, description: 1 });
    expect(r.issues).toEqual([]);
  });

  it("null explicitly unmaps a suggested field", () => {
    expect(resolveMapping(["date", "amount"], { amount_vnd: null }).issues).toEqual(["amount_missing"]);
  });

  it("derives the kind source", () => {
    expect(resolveMapping(["date", "amount"]).kindSource).toBe("sign");
    expect(resolveMapping(["date", "amount", "kind"]).kindSource).toBe("column");
    expect(resolveMapping(["date", "debit", "credit"]).kindSource).toBe("debit_credit");
  });

  it("flags amount + debit/credit together", () => {
    const r = resolveMapping(["date", "amount", "debit"], { debit_vnd: 2 });
    expect(r.issues).toContain("amount_conflict");
  });

  it.each([
    [{ amount_vnd: 9 }],
    [{ amount_vnd: -1 }],
    [{ amount_vnd: 1.5 }],
    [{ amount_vnd: 0 }], // column 0 already used by occurred_at
  ])("rejects invalid mapping %j", (input) => {
    expect(() => resolveMapping(["date", "amount", "x"], input)).toThrow(ImportError);
  });
});
