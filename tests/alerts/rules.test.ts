import { describe, expect, it } from "vitest";
import {
  UNUSUAL_MIN_EXCESS_VND,
  evaluateAlerts,
  evaluateUnusualSpending,
  monthEndOf,
  type AlertInput,
} from "@/lib/alerts";
import { addDays, forecastCashflow, localDateOf, type FinanceTransaction } from "@/lib/finance";
import { input, profile, recurring, tx, vn } from "../finance/helpers";

const NOW = vn("2026-11-23T10:00:00");
const TODAY = "2026-11-23";

/** One expense per day for the 30 baseline days (2026-10-17 .. 2026-11-15). */
function baselineDaily(amount: bigint): FinanceTransaction[] {
  const rows: FinanceTransaction[] = [];
  for (let i = 0; i < 30; i += 1) {
    rows.push(tx("expense", amount, `${addDays("2026-10-17", i)}T12:00:00`));
  }
  return rows;
}
const recentSpend = (amount: bigint, date = "2026-11-20") => tx("expense", amount, `${date}T12:00:00`);

function alertInput(overrides: Partial<Parameters<typeof input>[0]> = {}, labels?: Map<string, string>): AlertInput {
  const forecastInput = input({ now: NOW, ...overrides });
  return {
    forecast: forecastCashflow(forecastInput),
    transactions: forecastInput.transactions,
    ...(labels ? { recurringLabels: labels } : {}),
    now: NOW,
  };
}
const codes = (a: AlertInput) => evaluateAlerts(a).alerts.map((x) => x.code);

describe("unusual spending (7 recent days vs prior 30-day baseline)", () => {
  // baseline 100.000/day over 30 days -> expected 7-day spend 700.000; 1,5x = 1.050.000
  it("alerts exactly at 1,5x the baseline and not 1 VND below", () => {
    const atThreshold = evaluateUnusualSpending([...baselineDaily(100_000n), recentSpend(1_050_000n)], NOW);
    expect(atThreshold.alert?.code).toBe("unusual_spending");
    const below = evaluateUnusualSpending([...baselineDaily(100_000n), recentSpend(1_049_999n)], NOW);
    expect(below.alert).toBeNull();
    expect(below.note).toBeNull();
  });

  it("applies the absolute floor when the ratio is met but the excess is small", () => {
    // baseline 10.000/day -> expected 70.000; floor needs recent >= 70.000 + 200.000 = 270.000
    expect(UNUSUAL_MIN_EXCESS_VND).toBe(200_000n);
    expect(evaluateUnusualSpending([...baselineDaily(10_000n), recentSpend(270_000n)], NOW).alert).not.toBeNull();
    expect(evaluateUnusualSpending([...baselineDaily(10_000n), recentSpend(269_999n)], NOW).alert).toBeNull();
    // 1,5x is met (105.000) but the excess (35.000) is below the floor.
    expect(evaluateUnusualSpending([...baselineDaily(10_000n), recentSpend(105_000n)], NOW).alert).toBeNull();
  });

  it("states the numbers and the sample size, uses the required wording, and never mentions fraud", () => {
    const { alert } = evaluateUnusualSpending([...baselineDaily(100_000n), recentSpend(2_100_000n)], NOW);
    expect(alert).not.toBeNull();
    expect(alert!.title).toBe("Chi tiêu bất thường so với 30 ngày trước");
    expect(alert!.body).toContain("2.100.000 ₫");
    expect(alert!.body).toContain("700.000 ₫");
    expect(alert!.body).toContain("30 giao dịch trong 30 ngày");
    expect(alert!.body).toContain("gấp khoảng 3,0 lần");
    expect(alert!.severity).toBe("warning"); // >= 2,0x
    expect(alert!.caveat).toMatch(/thống kê/);
    const text = `${alert!.title} ${alert!.body} ${alert!.caveat}`.toLowerCase();
    expect(text).not.toMatch(/gian lận|lừa đảo|fraud|đáng ngờ/);
  });

  it("is only info between 1,5x and 2x", () => {
    const { alert } = evaluateUnusualSpending([...baselineDaily(100_000n), recentSpend(1_100_000n)], NOW);
    expect(alert?.severity).toBe("info");
  });

  it("gives a visible 'chưa đủ dữ liệu' note and no alert when the sample is too small", () => {
    const fewTransactions = [
      tx("expense", 100_000n, "2026-10-20T12:00:00"),
      tx("expense", 100_000n, "2026-10-21T12:00:00"),
      tx("expense", 100_000n, "2026-10-22T12:00:00"),
      tx("expense", 100_000n, "2026-10-23T12:00:00"),
      recentSpend(9_000_000n),
    ];
    const result = evaluateUnusualSpending(fewTransactions, NOW);
    expect(result.alert).toBeNull();
    expect(result.note?.message).toContain("Chưa đủ dữ liệu");
    expect(result.note?.message).toContain("4 giao dịch trong 4 ngày");
  });

  it("needs >= 7 distinct days even with >= 5 transactions", () => {
    const sixDays = [1, 2, 3, 4, 5, 6].map((d) => tx("expense", 100_000n, `2026-11-0${d}T12:00:00`));
    sixDays.push(tx("expense", 100_000n, "2026-11-06T13:00:00"));
    const result = evaluateUnusualSpending([...sixDays, recentSpend(9_000_000n)], NOW);
    expect(result.alert).toBeNull();
    expect(result.note).not.toBeNull();
  });

  it("accepts exactly the minimum sample (5 transactions on 7 days is impossible, 7 on 7 works)", () => {
    const sevenDays = [1, 2, 3, 4, 5, 6, 7].map((d) => tx("expense", 100_000n, `2026-11-0${d}T12:00:00`));
    // observed span 2026-11-01..2026-11-15 = 15 days -> expected7 = 700.000 * 7 / 15 = 326.667
    const result = evaluateUnusualSpending([...sevenDays, recentSpend(1_000_000n)], NOW);
    expect(result.note).toBeNull();
    expect(result.alert).not.toBeNull();
  });

  it("ignores income, excluded, recurring-linked, future, today and out-of-window rows", () => {
    const base = baselineDaily(100_000n);
    const noise: FinanceTransaction[] = [
      tx("income", 9_000_000n, "2026-11-20T12:00:00"),
      tx("excluded", 9_000_000n, "2026-11-20T12:00:00"),
      tx("expense", 9_000_000n, "2026-11-20T12:00:00", { recurringItemId: "r1", recurringInstanceDate: "2026-11-20" }),
      tx("expense", 9_000_000n, "2026-11-23T08:00:00"), // today (partly observed)
      tx("expense", 9_000_000n, "2026-11-25T08:00:00"), // future
      tx("expense", 9_000_000n, "2026-11-15T08:00:00"), // baseline, not recent
    ];
    expect(evaluateUnusualSpending([...base, ...noise], NOW).alert).toBeNull();
  });

  it("does not understate the baseline when history is short (averages over the observed span)", () => {
    // 10 days of 100.000 (11-06..11-15): span 10 days -> expected7 = 700.000, not 233.333
    const short = Array.from({ length: 10 }, (_, i) => tx("expense", 100_000n, `${addDays("2026-11-06", i)}T12:00:00`));
    expect(evaluateUnusualSpending([...short, recentSpend(1_049_999n)], NOW).alert).toBeNull();
    expect(evaluateUnusualSpending([...short, recentSpend(1_050_000n)], NOW).alert).not.toBeNull();
  });
});

describe("forecast alerts", () => {
  const richProfile = (over: Parameters<typeof profile>[0]) =>
    profile({ balanceSnapshotAt: vn("2026-11-22T09:00:00"), ...over });

  it("returns no alert for a healthy forecast", () => {
    expect(codes(alertInput({ profile: richProfile({ balanceSnapshotVnd: 50_000_000n, expectedDailyExpenseVnd: 100_000n }) }))).toEqual([]);
  });

  it("raises reserve_breach with first date, shortfall and the reserve", () => {
    const a = alertInput({
      profile: richProfile({ balanceSnapshotVnd: 3_000_000n, minimumReserveVnd: 2_000_000n, expectedDailyExpenseVnd: 100_000n }),
    });
    const alert = evaluateAlerts(a).alerts.find((x) => x.code === "reserve_breach")!;
    // closing balance = 3.000.000 - 100.000 * (index + 1); first < 2.000.000 at index 10 = 2026-12-03
    expect(alert.date).toBe("2026-12-03");
    expect(alert.severity).toBe("warning");
    expect(alert.body).toContain("từ 03/12");
    expect(alert.body).toContain("2.000.000 ₫");
    expect(alert.evidence.shortfallVnd).toBe(String(2_000_000 - (3_000_000 - 4_500_000)));
    expect(alert.caveat.length).toBeGreaterThan(10);
  });

  it("does not raise reserve_breach at exactly the reserve (>= reserve is fine)", () => {
    // closing day0 = 3.000.000 - 100.000; with 100.000/day over 45 days minimum is -1.500.000, so use a tiny horizon of spend
    const a = alertInput({
      profile: richProfile({ balanceSnapshotVnd: 3_000_000n, minimumReserveVnd: 1_500_000n, expectedDailyExpenseVnd: 33_333n }),
    });
    // 3.000.000 - 45 * 33.333 = 1.500.015 >= 1.500.000
    expect(codes(a)).not.toContain("reserve_breach");
    const b = alertInput({
      profile: richProfile({ balanceSnapshotVnd: 3_000_000n, minimumReserveVnd: 1_500_000n, expectedDailyExpenseVnd: 33_334n }),
    });
    // 3.000.000 - 45 * 33.334 = 1.499.970 < 1.500.000
    expect(codes(b)).toContain("reserve_breach");
  });

  it("raises negative_balance (critical) and skips reserve_breach when the reserve is 0", () => {
    const a = alertInput({ profile: richProfile({ balanceSnapshotVnd: 3_000_000n, expectedDailyExpenseVnd: 100_000n }) });
    const result = evaluateAlerts(a).alerts;
    expect(result.map((x) => x.code)).toEqual(["negative_balance"]);
    expect(result[0]!.severity).toBe("critical");
    expect(result[0]!.date).toBe("2026-12-23"); // 3.000.000 - 31 * 100.000 < 0 at index 30
  });

  it("raises month_end_negative only when the balance on the last day of the month is negative", () => {
    const negative = alertInput({ profile: richProfile({ balanceSnapshotVnd: 3_000_000n, expectedDailyExpenseVnd: 500_000n }) });
    expect(codes(negative)).toContain("month_end_negative");
    const alert = evaluateAlerts(negative).alerts.find((x) => x.code === "month_end_negative")!;
    expect(alert.date).toBe("2026-11-30");
    expect(alert.body).toContain("-1.000.000 ₫"); // 3.000.000 - 8 * 500.000
    // zero at month end is not negative: 8 days * 375.000 = 3.000.000
    const zero = alertInput({ profile: richProfile({ balanceSnapshotVnd: 3_000_000n, expectedDailyExpenseVnd: 375_000n }) });
    expect(codes(zero)).not.toContain("month_end_negative");
  });

  it("orders critical before warning before info", () => {
    const a = alertInput(
      {
        profile: richProfile({ balanceSnapshotVnd: 3_000_000n, minimumReserveVnd: 1_000_000n, expectedDailyExpenseVnd: 100_000n }),
        recurringItems: [recurring({ id: "r1", dayOfMonth: 25, amountVnd: 100_000n })],
      },
      new Map([["r1", "Internet"]]),
    );
    const order = evaluateAlerts(a).alerts.map((x) => x.severity);
    const rank = { critical: 0, warning: 1, info: 2 } as const;
    expect([...order].sort((x, y) => rank[x] - rank[y])).toEqual(order);
    expect(order[0]).toBe("critical");
    expect(order[order.length - 1]).toBe("info");
  });

  it("raises bill_due_soon within 3 days (inclusive) and not at 4 days", () => {
    const labels = new Map([["r1", "Tiền trọ"]]);
    const make = (day: number) =>
      alertInput(
        {
          profile: richProfile({ balanceSnapshotVnd: 90_000_000n }),
          recurringItems: [recurring({ id: "r1", dayOfMonth: day, amountVnd: 1_500_000n })],
        },
        labels,
      );
    const due3 = evaluateAlerts(make(26)).alerts.find((x) => x.code === "bill_due_soon");
    expect(due3?.body).toContain("Tiền trọ 1.500.000 ₫");
    expect(due3?.body).toContain("còn 3 ngày");
    expect(codes(make(27))).not.toContain("bill_due_soon");
    expect(evaluateAlerts(make(23)).alerts.find((x) => x.code === "bill_due_soon")?.body).toContain("hôm nay");
    // income and yesterday's bill do not count
    expect(codes(make(22))).not.toContain("bill_due_soon");
  });

  it("is deterministic, JSON-safe and independent of the host timezone", () => {
    const a = alertInput({
      profile: richProfile({ balanceSnapshotVnd: 3_000_000n, minimumReserveVnd: 2_000_000n, expectedDailyExpenseVnd: 100_000n }),
      transactions: [...baselineDaily(100_000n), recentSpend(2_000_000n)],
    });
    const first = JSON.stringify(evaluateAlerts(a));
    for (let i = 0; i < 50; i += 1) expect(JSON.stringify(evaluateAlerts(a))).toBe(first);
    expect(localDateOf(NOW)).toBe(TODAY);
  });
});

describe("monthEndOf", () => {
  it("handles leap and short months", () => {
    expect(monthEndOf("2028-02-10")).toBe("2028-02-29");
    expect(monthEndOf("2027-02-10")).toBe("2027-02-28");
    expect(monthEndOf("2026-11-30")).toBe("2026-11-30");
    expect(monthEndOf("2026-12-01")).toBe("2026-12-31");
  });
});
