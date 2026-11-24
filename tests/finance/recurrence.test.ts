import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  addDays,
  daysInMonth,
  FinanceError,
  occurrenceDateInMonth,
  parseLocalDate,
  recurringOccurrences,
} from "@/lib/finance";

const schedule = (dayOfMonth: number, extra = {}) => ({
  dayOfMonth,
  startDate: "2026-01-01",
  endDate: null,
  active: true,
  ...extra,
});

describe("monthly recurrence", () => {
  it("clamps day 31 to Feb 29 in a leap year and Feb 28 otherwise", () => {
    expect(occurrenceDateInMonth(2028, 2, 31)).toBe("2028-02-29");
    expect(occurrenceDateInMonth(2027, 2, 31)).toBe("2027-02-28");
    expect(occurrenceDateInMonth(2027, 2, 29)).toBe("2027-02-28");
    expect(occurrenceDateInMonth(2028, 2, 29)).toBe("2028-02-29");
    expect(occurrenceDateInMonth(2026, 4, 31)).toBe("2026-04-30");
    expect(occurrenceDateInMonth(2026, 4, 30)).toBe("2026-04-30");
    expect(occurrenceDateInMonth(2026, 1, 31)).toBe("2026-01-31");
  });

  it("returns one clamped occurrence per month in a range", () => {
    expect(recurringOccurrences(schedule(31), "2027-01-01", "2027-04-30")).toEqual([
      "2027-01-31",
      "2027-02-28",
      "2027-03-31",
      "2027-04-30",
    ]);
  });

  it("respects range edges inclusively", () => {
    expect(recurringOccurrences(schedule(15), "2026-11-15", "2026-11-15")).toEqual(["2026-11-15"]);
    expect(recurringOccurrences(schedule(15), "2026-11-16", "2026-12-14")).toEqual([]);
  });

  it("respects start date, end date and active flag", () => {
    expect(recurringOccurrences(schedule(5, { startDate: "2026-11-06" }), "2026-11-01", "2026-12-31")).toEqual([
      "2026-12-05",
    ]);
    expect(recurringOccurrences(schedule(5, { endDate: "2026-11-30" }), "2026-11-01", "2027-01-31")).toEqual([
      "2026-11-05",
    ]);
    expect(recurringOccurrences(schedule(5, { active: false }), "2026-11-01", "2027-01-31")).toEqual([]);
  });

  it("returns nothing for an inverted range", () => {
    expect(recurringOccurrences(schedule(5), "2026-12-01", "2026-11-01")).toEqual([]);
  });

  it.each([0, 32, 1.5, -1, Number.NaN])("rejects day of month %s", (day) => {
    expect(() => occurrenceDateInMonth(2026, 1, day)).toThrow(FinanceError);
    expect(() => recurringOccurrences(schedule(day), "2026-01-01", "2026-02-01")).toThrow(FinanceError);
  });

  it("property: one valid, clamped, strictly increasing occurrence per month", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 31 }),
        fc.integer({ min: 2020, max: 2040 }),
        fc.integer({ min: 1, max: 12 }),
        fc.integer({ min: 1, max: 24 }),
        (day, year, month, spanMonths) => {
          const from = `${year}-${String(month).padStart(2, "0")}-01`;
          const lastMonthIndex = year * 12 + (month - 1) + spanMonths - 1;
          const toYear = Math.floor(lastMonthIndex / 12);
          const toMonth = (lastMonthIndex % 12) + 1;
          const to = `${toYear}-${String(toMonth).padStart(2, "0")}-${daysInMonth(toYear, toMonth)}`;
          const dates = recurringOccurrences({ ...schedule(day), startDate: "2000-01-01" }, from, to);
          expect(dates).toHaveLength(spanMonths);
          dates.forEach((date, index) => {
            const parts = parseLocalDate(date);
            expect(parts.day).toBe(Math.min(day, daysInMonth(parts.year, parts.month)));
            if (index > 0) expect(date > dates[index - 1]!).toBe(true);
          });
          expect(addDays(dates[0]!, 0)).toBe(dates[0]);
        },
      ),
      { numRuns: 200 },
    );
  });
});
