import { describe, expect, it } from "vitest";
import { monthToDateTotals } from "@/features/dashboard/month-totals";
import { tx, vn } from "../../finance/helpers";

// vitest.config.ts runs every test under TZ=America/New_York; assert that, so these tests would
// fail if a Date method that depends on the host zone crept into month-totals.ts.
describe("monthToDateTotals", () => {
  it("runs under a non-Vietnam host timezone", () => {
    expect(process.env.TZ).toBe("America/New_York");
    expect(new Date("2026-11-24T00:00:00Z").getTimezoneOffset()).toBe(300);
  });

  const now = vn("2026-11-24T12:00:00");

  it("sums income and expense for the current Vietnam month and counts rows", () => {
    const totals = monthToDateTotals(
      [
        tx("income", 5_000_000n, "2026-11-05T09:00:00"),
        tx("expense", 120_000n, "2026-11-10T19:30:00"),
        tx("expense", 80_000n, "2026-11-24T08:00:00"),
      ],
      now,
    );
    expect(totals).toEqual({ start: "2026-11-01", incomeVnd: 5_000_000n, expenseVnd: 200_000n, incomeCount: 1, expenseCount: 2 });
  });

  it("returns zeros (not an error) when there are no transactions", () => {
    expect(monthToDateTotals([], now)).toEqual({ start: "2026-11-01", incomeVnd: 0n, expenseVnd: 0n, incomeCount: 0, expenseCount: 0 });
  });

  it("ignores `excluded` rows (transfers, refunds) in both totals and counts", () => {
    const totals = monthToDateTotals(
      [tx("excluded", 9_000_000n, "2026-11-12T10:00:00"), tx("expense", 50_000n, "2026-11-12T10:00:00")],
      now,
    );
    expect(totals.incomeVnd).toBe(0n);
    expect(totals.expenseVnd).toBe(50_000n);
    expect(totals.incomeCount + totals.expenseCount).toBe(1);
  });

  it("ignores future-dated rows, including later today", () => {
    const totals = monthToDateTotals(
      [
        tx("expense", 1_000n, "2026-11-24T12:00:01"), // one second after now
        tx("expense", 2_000n, "2026-11-24T23:59:59"),
        tx("income", 3_000n, "2026-11-30T09:00:00"),
        tx("expense", 4_000n, "2026-11-24T12:00:00"), // exactly now counts as posted
      ],
      now,
    );
    expect(totals.expenseVnd).toBe(4_000n);
    expect(totals.incomeVnd).toBe(0n);
  });

  it("ignores previous and next months", () => {
    const totals = monthToDateTotals(
      [tx("expense", 7n, "2026-10-31T23:59:59"), tx("expense", 11n, "2026-12-01T00:00:00")],
      now,
    );
    expect(totals.expenseVnd).toBe(0n);
  });

  describe("Vietnam midnight boundary (host TZ = America/New_York)", () => {
    it("00:00 on the 1st in Vietnam belongs to the new month", () => {
      const early = vn("2026-12-01T00:00:00"); // = 2026-11-30T17:00:00Z = 12:00 on 11/30 in New York
      const totals = monthToDateTotals([tx("expense", 100n, "2026-12-01T00:00:00")], vn("2026-12-01T09:00:00"));
      expect(totals.start).toBe("2026-12-01");
      expect(totals.expenseVnd).toBe(100n);
      expect(early.getUTCMonth()).toBe(10); // in UTC it is still November: a UTC-based implementation would get this wrong
    });

    it("23:59:59 on the last day in Vietnam stays in the old month, even though UTC and New York are earlier still", () => {
      const lastSecond = tx("expense", 100n, "2026-11-30T23:59:59");
      expect(monthToDateTotals([lastSecond], vn("2026-11-30T23:59:59")).expenseVnd).toBe(100n);
      expect(monthToDateTotals([lastSecond], vn("2026-12-01T00:00:00")).expenseVnd).toBe(0n);
    });

    it("an evening in Vietnam that is still the previous day in New York is counted on the Vietnam date", () => {
      // 2026-11-01 02:00 in Vietnam = 2026-10-31 15:00 in New York.
      const t = tx("income", 500n, "2026-11-01T02:00:00");
      const totals = monthToDateTotals([t], vn("2026-11-01T08:00:00"));
      expect(totals.start).toBe("2026-11-01");
      expect(totals.incomeVnd).toBe(500n);
    });

    it("`now` itself is bucketed by the Vietnam date, so 'this month' flips at Vietnam midnight", () => {
      expect(monthToDateTotals([], vn("2026-11-30T23:59:59")).start).toBe("2026-11-01");
      expect(monthToDateTotals([], vn("2026-12-01T00:00:00")).start).toBe("2026-12-01");
    });
  });

  it("keeps full bigint precision for large sums", () => {
    const big = 9_007_199_254_740_000n;
    const totals = monthToDateTotals([tx("income", big, "2026-11-02T10:00:00"), tx("income", big, "2026-11-03T10:00:00")], now);
    expect(totals.incomeVnd).toBe(big * 2n);
  });

  it("counts rows dated before the balance snapshot (activity, not balance)", () => {
    expect(monthToDateTotals([tx("expense", 10n, "2026-11-01T00:30:00")], now).expenseVnd).toBe(10n);
  });
});
