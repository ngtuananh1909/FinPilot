import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInMonth,
  diffDays,
  FinanceError,
  isLeapYear,
  localDateOf,
  parseLocalDate,
} from "@/lib/finance";

describe("calendar helpers", () => {
  it("handles leap years including century rules", () => {
    expect(isLeapYear(2028)).toBe(true);
    expect(isLeapYear(2027)).toBe(false);
    expect(isLeapYear(2100)).toBe(false);
    expect(isLeapYear(2000)).toBe(true);
    expect(daysInMonth(2028, 2)).toBe(29);
    expect(daysInMonth(2027, 2)).toBe(28);
    expect(daysInMonth(2026, 4)).toBe(30);
    expect(daysInMonth(2026, 12)).toBe(31);
  });

  it("adds days across month, year and leap boundaries", () => {
    expect(addDays("2026-11-23", 44)).toBe("2027-01-06");
    expect(addDays("2028-02-28", 1)).toBe("2028-02-29");
    expect(addDays("2027-02-28", 1)).toBe("2027-03-01");
    expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(diffDays("2027-01-06", "2026-11-23")).toBe(44);
  });

  it.each(["2027-02-29", "2026-13-01", "2026-1-1", "2026-04-31", "", "abc", "0999-01-01"])(
    "rejects invalid date %s",
    (value) => {
      expect(() => parseLocalDate(value)).toThrow(FinanceError);
    },
  );

  it("maps instants to the Asia/Ho_Chi_Minh calendar day regardless of host timezone", () => {
    expect(localDateOf(new Date("2026-11-23T16:59:59Z"))).toBe("2026-11-23");
    expect(localDateOf(new Date("2026-11-23T17:00:00Z"))).toBe("2026-11-24");
    expect(localDateOf(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
    expect(localDateOf(new Date("2026-11-23T00:00:00+07:00"))).toBe("2026-11-23");
  });

  it("rejects invalid instants", () => {
    expect(() => localDateOf(new Date("nope"))).toThrow(FinanceError);
  });
});
