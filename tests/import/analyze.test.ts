import { describe, expect, it } from "vitest";
import { analyzeCsv, classifyRows, countRows, type ExistingTransaction } from "@/lib/import/analyze";
import { importFingerprint } from "@/lib/import/fingerprint";

const HEAD = "occurred_at,kind,amount_vnd,category,merchant,description";
const run = (lines: string[], extra: Partial<Parameters<typeof analyzeCsv>[0]> = {}) =>
  analyzeCsv({ csv: [HEAD, ...lines].join("\n"), ...extra });
const view = (lines: string[], extra: Partial<Parameters<typeof analyzeCsv>[0]> = {}) =>
  run(lines, extra).rows.map((r) => r.view);

describe("analyzeCsv: normalisation", () => {
  it("normalises a clean row", () => {
    const [row] = view(["2026-11-01T12:30:00+07:00,expense,45000,food,Canteen,Lunch"]);
    expect(row).toMatchObject({
      status: "ok",
      reasons: [],
      values: {
        occurredAt: "2026-11-01T05:30:00.000Z",
        localDate: "2026-11-01",
        kind: "expense",
        amountVnd: "45000",
        category: "food",
        merchant: "Canteen",
        description: "Lunch",
      },
    });
  });

  it("reads Vietnamese headers, ; delimiter, DD/MM/YYYY and 1.500.000đ", () => {
    const csv = "Ngày giao dịch;Thu/Chi;Số tiền;Nội dung\n25/11/2026;Chi;1.500.000đ;Tiền trọ";
    const a = analyzeCsv({ csv });
    expect(a.parsed.delimiter).toBe(";");
    expect(a.rows[0]?.view).toMatchObject({
      status: "ok",
      values: { localDate: "2026-11-25", kind: "expense", amountVnd: "1500000", description: "Tiền trọ" },
    });
  });

  it("derives kind from the amount sign when there is no kind column, and says so", () => {
    const a = analyzeCsv({ csv: "date,amount\n2026-11-01,-45.000\n2026-11-02,(12.000)\n2026-11-03,3.000.000" });
    expect(a.kindSource).toBe("sign");
    expect(a.rows.map((r) => [r.view.values.kind, r.view.values.amountVnd])).toEqual([
      ["expense", "45000"],
      ["expense", "12000"],
      ["income", "3000000"],
    ]);
  });

  it("uses debit/credit columns for the kind", () => {
    const a = analyzeCsv({
      csv: "Ngày,Ghi nợ,Ghi có\n2026-11-01,45.000,\n2026-11-02,,5.000.000\n2026-11-03,1000,2000\n2026-11-04,,\n2026-11-05,0,0",
    });
    expect(a.kindSource).toBe("debit_credit");
    const [debit, credit, both, none, zero] = a.rows.map((r) => r.view);
    expect(debit).toMatchObject({ status: "ok", values: { kind: "expense", amountVnd: "45000" } });
    expect(credit).toMatchObject({ status: "ok", values: { kind: "income", amountVnd: "5000000" } });
    expect(both?.reasons).toEqual([{ field: "row", code: "both_debit_and_credit" }]);
    expect(none?.status).toBe("invalid");
    expect(zero?.status).toBe("invalid");
  });

  it("marks a row invalid with a reason per problem and never guesses", () => {
    const rows = view([
      "2026-11-01,expense,abc,food,A,B", // bad amount
      "2026-11-01,expense,45.50,food,A,B", // fraction
      "2026-11-01,expense,0,food,A,B", // zero
      "2026-11-01,transfer,45000,food,A,B", // unknown kind
      "2026-11-01,,45000,food,A,B", // missing kind
      "2026-11-01,income,-45000,food,A,B", // kind/sign conflict
      "2026-02-30,expense,45000,food,A,B", // impossible date
      ",expense,45000,food,A,B", // missing date
      "2026-11-01,expense,45000,food,A", // ragged (too few)
      "2026-11-01,expense,45000,food,A,B,C", // ragged (too many)
      `2026-11-01,expense,45000,food,${"m".repeat(201)},B`, // merchant too long
    ]);
    expect(rows.map((r) => r.status)).toEqual(Array(11).fill("invalid"));
    expect(rows.map((r) => r.reasons[0]?.code)).toEqual([
      "invalid_amount",
      "fractional_amount",
      "non_positive_amount",
      "kind_unknown",
      "kind_missing",
      "kind_sign_conflict",
      "invalid_date",
      "date_missing",
      "column_count_mismatch",
      "column_count_mismatch",
      "too_long",
    ]);
    expect(rows.every((r) => r.values.occurredAt === null || r.status === "invalid")).toBe(true);
  });

  it("flags ambiguous dates and resolves them only with an explicit dayFirst", () => {
    const line = "03/04/2026,expense,45000,food,A,B";
    const [amb] = view([line]);
    expect(amb).toMatchObject({ status: "ambiguous", reasons: [{ field: "occurred_at", code: "ambiguous_date" }] });
    expect(amb?.values.occurredAt).toBeNull();
    expect(view([line], { options: { dayFirst: true } })[0]?.values.localDate).toBe("2026-04-03");
    expect(view([line], { options: { dayFirst: false } })[0]?.values.localDate).toBe("2026-03-04");
  });

  it("an ambiguous date plus another problem is invalid, not ambiguous", () => {
    expect(view(["03/04/2026,expense,abc,food,A,B"])[0]?.status).toBe("invalid");
  });

  it("keeps formula-looking cells as plain text", () => {
    const [row] = view(['2026-11-01,expense,45000,food,"=HYPERLINK(""http://x"")","@SUM(A1:A9)"']);
    expect(row?.status).toBe("ok");
    expect(row?.values.merchant).toBe('=HYPERLINK("http://x")');
    expect(row?.values.description).toBe("@SUM(A1:A9)");
  });

  it("collapses whitespace in text and defaults an unusable category with a warning", () => {
    const [row] = view(['2026-11-01,expense,45000,"<b>x</b>","  Cafe \n  Sữa ",""']);
    expect(row?.values).toMatchObject({ category: "other", merchant: "Cafe Sữa", description: null });
    expect(row?.warnings).toEqual(["category_defaulted"]);
    expect(view(["2026-11-01,expense,45000,,A,B"])[0]).toMatchObject({ warnings: [], values: { category: "other" } });
    expect(view(["2026-11-01,expense,45000,Ăn uống,A,B"])[0]?.values.category).toBe("Ăn uống");
  });

  it("uses stable row ids: same content = same id, changed row = different id", () => {
    const lines = ["2026-11-01,expense,45000,food,A,B", "2026-11-02,expense,45000,food,A,B"];
    const first = view(lines).map((r) => r.rowId);
    expect(view(lines).map((r) => r.rowId)).toEqual(first);
    expect(first[0]).toMatch(/^r1-[0-9a-f]{8}$/);
    expect(new Set(first).size).toBe(2);
    expect(view(["2026-11-01,expense,45001,food,A,B", lines[1] as string])[0]?.rowId).not.toBe(first[0]);
  });

  it("returns no rows when the mapping is incomplete", () => {
    const a = analyzeCsv({ csv: "foo,bar\n1,2" });
    expect(a.mappingIssues).toEqual(["occurred_at_missing", "amount_missing"]);
    expect(a.rows).toEqual([]);
  });

  it("applies an explicit mapping to differently named columns", () => {
    const a = analyzeCsv({ csv: "x,y,z\n2026-11-01,45000,Highlands", mapping: { occurred_at: 0, amount_vnd: 1, kind: null, merchant: 2 } });
    expect(a.rows[0]?.view).toMatchObject({ status: "ok", values: { kind: "income", merchant: "Highlands" } });
  });

  it("ignores persona_code and unknown columns", () => {
    const a = analyzeCsv({ csv: "persona_code,occurred_at,kind,amount_vnd,junk\nstudent,2026-11-01,expense,5000,zzz" });
    expect(a.rows[0]?.view.status).toBe("ok");
    expect(a.mapping.kind).toBe(2);
  });
});

const existing = (over: Partial<ExistingTransaction> = {}): ExistingTransaction => ({
  id: "00000000-0000-4000-8000-000000000001",
  occurredAt: new Date("2026-11-01T05:30:00Z"),
  kind: "expense",
  amountVnd: 45000n,
  merchant: "Canteen",
  description: null,
  fingerprint: null,
  ...over,
});

const classify = (lines: string[], ex: ExistingTransaction[] = []) =>
  classifyRows(run(lines).rows, ex).map((r) => r.view);

describe("classifyRows", () => {
  it("exact duplicate: same stored fingerprint", () => {
    const stored = importFingerprint({
      occurredAt: new Date("2026-11-01T12:30:00+07:00"),
      kind: "expense",
      amountVnd: 45000n,
      merchant: "canteen",
    });
    const [row] = classify(["2026-11-01,expense,45000,food,Canteen,x"], [existing({ fingerprint: stored, merchant: "Other" })]);
    expect(row).toMatchObject({ status: "exact_duplicate", duplicateOf: { scope: "existing" } });
  });

  it("exact duplicate: a stored row without a fingerprint but identical content", () => {
    const [row] = classify(["2026-11-01,expense,45000,food, canteen ,x"], [existing()]);
    expect(row).toMatchObject({
      status: "exact_duplicate",
      duplicateOf: { scope: "existing", transactionId: "00000000-0000-4000-8000-000000000001" },
    });
  });

  it("exact duplicate: a repeat inside the file; the first occurrence stays ok", () => {
    const rows = classify(["2026-11-01,expense,45000,food,Canteen,a", "2026-11-01,expense,45000,food,canteen,b"]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "exact_duplicate"]);
    expect(rows[1]?.duplicateOf).toEqual({ scope: "file", rowNumber: 1 });
  });

  it("possible duplicate: same day/kind/amount with similar merchant text", () => {
    const [row] = classify(["2026-11-01,expense,45000,food,Canteen KTX,x"], [existing({ merchant: "Canteen" })]);
    expect(row).toMatchObject({ status: "possible_duplicate", duplicateOf: { scope: "existing" } });
  });

  it("possible duplicate also catches diacritic-only merchant differences", () => {
    const [row] = classify(["2026-11-01,expense,45000,food,Cà phê,x"], [existing({ merchant: "Ca phe" })]);
    expect(row?.status).toBe("possible_duplicate");
  });

  it("possible duplicate inside the file", () => {
    const rows = classify(["2026-11-01,expense,45000,food,Grab Food,a", "2026-11-01,expense,45000,food,Grab Food Hanoi,b"]);
    expect(rows.map((r) => r.status)).toEqual(["ok", "possible_duplicate"]);
  });

  it("is not a duplicate when date, kind, amount or merchant text differ", () => {
    const ex = [existing()];
    expect(classify(["2026-11-02,expense,45000,food,Canteen,x"], ex)[0]?.status).toBe("ok");
    expect(classify(["2026-11-01,income,45000,food,Canteen,x"], ex)[0]?.status).toBe("ok");
    expect(classify(["2026-11-01,expense,46000,food,Canteen,x"], ex)[0]?.status).toBe("ok");
    expect(classify(["2026-11-01,expense,45000,food,Highlands,x"], ex)[0]?.status).toBe("ok");
  });

  it("uses the Vietnam calendar day (late-evening UTC rows match the next local day)", () => {
    const ex = [existing({ occurredAt: new Date("2026-11-01T18:30:00Z") })]; // 2 Nov 01:30 local
    expect(classify(["2026-11-02,expense,45000,food,Canteen,x"], ex)[0]?.status).toBe("exact_duplicate");
    expect(classify(["2026-11-01,expense,45000,food,Canteen,x"], ex)[0]?.status).toBe("ok");
  });

  it("never changes invalid or ambiguous rows and never removes any row", () => {
    const rows = classify(["2026-11-01,expense,abc,food,Canteen,x", "03/04/2026,expense,45000,food,Canteen,x", "2026-11-01,expense,45000,food,Canteen,x"], [
      existing(),
    ]);
    expect(rows.map((r) => r.status)).toEqual(["invalid", "ambiguous", "exact_duplicate"]);
    expect(rows).toHaveLength(3);
    expect(countRows(classifyRows(run(["2026-11-01,expense,45000,food,Canteen,x"]).rows, [existing()]))).toMatchObject({
      total: 1,
      exactDuplicate: 1,
      ok: 0,
    });
  });
});
