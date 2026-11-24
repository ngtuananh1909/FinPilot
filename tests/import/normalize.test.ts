import { describe, expect, it } from "vitest";
import { parseAmount, parseDate, parseKind } from "@/lib/import/normalize";

const amount = (raw: string) => {
  const r = parseAmount(raw);
  return r.ok ? `${r.negative ? "-" : ""}${r.magnitude}` : r.code;
};

describe("parseAmount", () => {
  it.each([
    ["45000", "45000"],
    ["45.000", "45000"],
    ["45,000", "45000"],
    ["1.500.000", "1500000"],
    ["1,500,000", "1500000"],
    ["1.500.000đ", "1500000"],
    ["1.500.000 ₫", "1500000"],
    ["₫1.500.000", "1500000"],
    ["45000 VND", "45000"],
    ["45.000d", "45000"],
    ["-45000", "-45000"],
    ["−45.000", "-45000"],
    ["(45000)", "-45000"],
    ["(45.000đ)", "-45000"],
    ["+45000", "45000"],
    ["1.234", "1234"],
    ["999", "999"],
    ["45.00", "45"],
    ["45,00", "45"],
    ["1.500.000,00", "1500000"],
    ["1,500,000.00", "1500000"],
    ["0", "0"],
    ["  45 000  ", "45000"],
    ["9007199254740991", "9007199254740991"],
  ])("%s -> %s", (raw, expected) => {
    expect(amount(raw)).toBe(expected);
  });

  it.each([
    ["45.50", "fractional_amount"],
    ["45,5", "fractional_amount"],
    ["0.500", "fractional_amount"],
    ["1.500.000,50", "fractional_amount"],
    ["9007199254740992", "amount_too_large"],
    ["99999999999999999999999", "amount_too_large"],
    ["", "amount_missing"],
    ["   ", "amount_missing"],
    ["abc", "invalid_amount"],
    ["12abc", "invalid_amount"],
    ["1e5", "invalid_amount"],
    ["--5", "invalid_amount"],
    ["(-5)", "invalid_amount"],
    ["1..000", "invalid_amount"],
    ["12.34.5", "invalid_amount"],
    ["1,5.000,000", "invalid_amount"],
    ["₫", "invalid_amount"],
    ["=1+1", "invalid_amount"],
  ])("%j is rejected as %s", (raw, code) => {
    expect(amount(raw)).toBe(code);
  });
});

const date = (raw: string, dayFirst?: boolean) => {
  const r = parseDate(raw, { dayFirst });
  return r.ok ? r.instant.toISOString() : r.code;
};

describe("parseDate", () => {
  it.each([
    ["2026-11-01T12:30:00+07:00", "2026-11-01T05:30:00.000Z"],
    ["2026-11-01T12:30:00+0700", "2026-11-01T05:30:00.000Z"],
    ["2026-11-01T05:30:00Z", "2026-11-01T05:30:00.000Z"],
    ["2026-11-01 12:30:00+07:00", "2026-11-01T05:30:00.000Z"],
    ["2026-11-01T23:30:00-05:00", "2026-11-02T04:30:00.000Z"],
    // naive values are Asia/Ho_Chi_Minh (UTC+7)
    ["2026-11-01", "2026-11-01T05:00:00.000Z"],
    ["2026-11-01 08:15", "2026-11-01T01:15:00.000Z"],
    ["2026-11-01T08:15:30", "2026-11-01T01:15:30.000Z"],
    ["2026/11/01", "2026-11-01T05:00:00.000Z"],
    ["2026/11/01 00:00", "2026-10-31T17:00:00.000Z"],
    ["25/11/2026", "2026-11-25T05:00:00.000Z"],
    ["25-11-2026", "2026-11-25T05:00:00.000Z"],
    ["25/11/2026 18:45", "2026-11-25T11:45:00.000Z"],
  ])("%s -> %s", (raw, expected) => {
    expect(date(raw)).toBe(expected);
  });

  it("day/month with both parts <= 12 is ambiguous until the user chooses", () => {
    expect(date("03/04/2026")).toBe("ambiguous_date");
    expect(date("03-04-2026 10:00")).toBe("ambiguous_date");
    expect(date("03/04/2026", true)).toBe("2026-04-03T05:00:00.000Z"); // 3 April
    expect(date("03/04/2026", false)).toBe("2026-03-04T05:00:00.000Z"); // 4 March
  });

  it("is not ambiguous when the day/month are equal or one part is > 12", () => {
    expect(date("05/05/2026")).toBe("2026-05-05T05:00:00.000Z");
    expect(date("13/04/2026")).toBe("2026-04-13T05:00:00.000Z");
    expect(date("04/13/2026")).toBe("2026-04-13T05:00:00.000Z"); // only MM/DD is possible
  });

  it("an explicit format is applied strictly", () => {
    expect(date("13/04/2026", false)).toBe("invalid_date"); // month 13
    expect(date("04/13/2026", true)).toBe("invalid_date");
  });

  it.each([
    "30/02/2026",
    "31/04/2026",
    "29/02/2027",
    "2026-02-30",
    "2026-13-01",
    "2026-00-10",
    "32/01/2026",
    "00/01/2026",
    "2026-11-01 24:00",
    "2026-11-01 12:60",
    "2026-11-01T25:00:00+07:00",
    "1999-12-31",
    "2101-01-01",
    "yesterday",
    "01.11.2026",
    "1/11/26",
    "2026-11-01T12:30:00+25:00",
  ])("%s is invalid", (raw) => {
    expect(date(raw)).toBe("invalid_date");
  });

  it("accepts 29/02 on a leap year", () => {
    expect(date("29/02/2028")).toBe("2028-02-29T05:00:00.000Z");
  });

  it("reports an empty cell as date_missing", () => {
    expect(date("")).toBe("date_missing");
    expect(date("  ")).toBe("date_missing");
  });

  it("does not depend on the host timezone (vitest runs with TZ=America/New_York)", () => {
    expect(date("2026-11-01 00:30")).toBe("2026-10-31T17:30:00.000Z");
  });
});

describe("parseKind", () => {
  it.each([
    ["income", "income"],
    ["Income", "income"],
    ["Thu", "income"],
    ["THU NHẬP", "income"],
    ["credit", "income"],
    ["Ghi có", "income"],
    ["expense", "expense"],
    ["Chi", "expense"],
    ["Chi tiêu", "expense"],
    ["debit", "expense"],
    ["Ghi nợ", "expense"],
    ["excluded", "excluded"],
    ["Loại trừ", "excluded"],
  ])("%s -> %s", (raw, kind) => {
    expect(parseKind(raw)).toBe(kind);
  });

  it.each(["", "transfer", "thu chi", "+", "-", "?", "incomee"])("never guesses: %j -> null", (raw) => {
    expect(parseKind(raw)).toBeNull();
  });

  it("does not match inherited object keys", () => {
    expect(parseKind("constructor")).toBeNull();
    expect(parseKind("__proto__")).toBeNull();
    expect(parseKind("toString")).toBeNull();
  });
});
