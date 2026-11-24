import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { FinanceError, forecastCashflow, simulatePurchase } from "@/lib/finance";
import { input, profile, recurring, stable, tx, vn } from "./helpers";

// Snapshot 1,000,000; reserve 300,000; no variable spend; salary 5,000,000 on the 28th.
const paydayInput = () =>
  input({
    profile: profile({ balanceSnapshotVnd: 1_000_000n, minimumReserveVnd: 300_000n }),
    recurringItems: [recurring({ id: "salary", kind: "income", amountVnd: 5_000_000n, dayOfMonth: 28 })],
  });
const baseline = () => forecastCashflow(paydayInput());
const later = { kind: "next_payday" } as const;

describe("buy now vs buy later", () => {
  it("marks an interim reserve breach unsafe even when the final balance is positive", () => {
    const result = simulatePurchase(baseline(), { costVnd: 800_000n, buyLater: later });
    const now = result.scenarios.now;
    expect(now.endBalanceVnd).toBeGreaterThan(0n);
    expect(now.safe).toBe(false);
    expect(now.violation).toBe("below_reserve");
    expect(now.minimumVnd).toBe(200_000n);
    expect(now.minimumDate).toBe("2026-11-23");
    expect(now.firstBreachDate).toBe("2026-11-23");
    expect(now.reserveBreachDays).toBe(5); // 11-23 .. 11-27
    expect(now.reserveHeadroomVnd).toBe(-100_000n);
  });

  it("shows buying on the next payday as safe with the same assumptions", () => {
    const f = baseline();
    const result = simulatePurchase(f, { costVnd: 800_000n, buyLater: later });
    expect(result.buyLaterSource).toBe("next_payday");
    expect(result.scenarios.later.purchaseDate).toBe("2026-11-28");
    expect(result.scenarios.later.safe).toBe(true);
    expect(result.scenarios.later.violation).toBe("none");
    expect(result.scenarios.later.minimumVnd).toBe(1_000_000n);
    expect(result.scenarios.later.reserveHeadroomVnd).toBe(700_000n);
    expect(result.minimumImprovementVnd).toBe(800_000n);
    expect(result.bothUnsafe).toBe(false);
    expect(result.assumptions).toBe(f.assumptions);
    expect(result.baseline).toBe(f.summary);
  });

  it("treats a minimum exactly equal to the reserve as safe, and one VND less as unsafe", () => {
    const exact = simulatePurchase(baseline(), { costVnd: 700_000n, buyLater: later });
    expect(exact.scenarios.now.safe).toBe(true);
    expect(exact.scenarios.now.reserveHeadroomVnd).toBe(0n);
    const over = simulatePurchase(baseline(), { costVnd: 700_001n, buyLater: later });
    expect(over.scenarios.now.safe).toBe(false);
  });

  it("distinguishes dipping below zero from dipping below the reserve", () => {
    const result = simulatePurchase(baseline(), { costVnd: 1_200_000n, buyLater: later });
    expect(result.scenarios.now.violation).toBe("below_zero");
    expect(result.scenarios.now.minimumVnd).toBe(-200_000n);
  });

  it("treats a zero reserve as 'not below zero'", () => {
    const f = forecastCashflow(input({ profile: profile({ balanceSnapshotVnd: 1_000_000n }) }));
    expect(simulatePurchase(f, { costVnd: 1_000_000n, buyLater: { kind: "date", date: "2026-11-30" } }).scenarios.now.safe).toBe(true);
    expect(simulatePurchase(f, { costVnd: 1_000_001n, buyLater: { kind: "date", date: "2026-11-30" } }).scenarios.now.safe).toBe(false);
  });

  it("flags when both options are unsafe", () => {
    const result = simulatePurchase(baseline(), {
      costVnd: 5_000_000n,
      buyLater: { kind: "date", date: "2026-11-27" },
    });
    expect(result.bothUnsafe).toBe(true);
  });

  it("subtracts the cost exactly once, from the purchase date onward", () => {
    const f = baseline();
    const { scenarios } = simulatePurchase(f, { costVnd: 123_456n, buyNowDate: "2026-11-25", buyLater: { kind: "date", date: "2026-12-10" } });
    f.days.forEach((day, i) => {
      const nowPoint = scenarios.now.closingBalances[i]!;
      const laterPoint = scenarios.later.closingBalances[i]!;
      expect(nowPoint.date).toBe(day.date);
      expect(nowPoint.balanceVnd).toBe(day.date >= "2026-11-25" ? day.closingBalanceVnd - 123_456n : day.closingBalanceVnd);
      expect(laterPoint.balanceVnd).toBe(day.date >= "2026-12-10" ? day.closingBalanceVnd - 123_456n : day.closingBalanceVnd);
    });
  });

  it("does not mutate the baseline forecast", () => {
    const f = baseline();
    const before = stable(f);
    simulatePurchase(f, { costVnd: 800_000n, buyLater: later });
    expect(stable(f)).toBe(before);
  });

  it("is deterministic across 100 replays", () => {
    const run = () => stable(simulatePurchase(baseline(), { costVnd: 800_000n, buyLater: later }));
    const reference = run();
    for (let i = 0; i < 100; i += 1) expect(run()).toBe(reference);
  });
});

describe("next payday resolution", () => {
  it("is strictly after the buy-now date (payday today is skipped)", () => {
    const f = forecastCashflow(
      input({
        profile: profile({ balanceSnapshotVnd: 1_000_000n }),
        recurringItems: [recurring({ id: "salary", kind: "income", dayOfMonth: 23 })],
      }),
    );
    expect(simulatePurchase(f, { costVnd: 1n, buyLater: later }).scenarios.later.purchaseDate).toBe("2026-12-23");
  });

  it("uses profile payday when there is no recurring income", () => {
    const f = forecastCashflow(input({ profile: profile({ expectedMonthlyIncomeVnd: 4_000_000n, paydayDay: 28 }) }));
    expect(simulatePurchase(f, { costVnd: 1n, buyLater: later }).scenarios.later.purchaseDate).toBe("2026-11-28");
  });

  it("measures the payday from a custom buy-now date", () => {
    const result = simulatePurchase(baseline(), { costVnd: 1n, buyNowDate: "2026-11-29", buyLater: later });
    expect(result.scenarios.later.purchaseDate).toBe("2026-12-28");
  });

  it("refuses to invent a payday when none is known", () => {
    const f = forecastCashflow(input({ transactions: [tx("income", 1_000_000n, "2026-11-25T08:00:00")] }));
    expect(() => simulatePurchase(f, { costVnd: 1n, buyLater: later })).toThrowError(
      expect.objectContaining({ code: "payday_unknown" }),
    );
  });
});

describe("input validation", () => {
  const f = baseline();
  const codeOf = (fn: () => unknown): string | undefined => {
    try {
      fn();
    } catch (error) {
      return error instanceof FinanceError ? error.code : "other";
    }
    return undefined;
  };

  it("rejects dates outside the 45-day horizon", () => {
    expect(codeOf(() => simulatePurchase(f, { costVnd: 1n, buyLater: { kind: "date", date: "2027-01-07" } }))).toBe("date_outside_horizon");
    expect(codeOf(() => simulatePurchase(f, { costVnd: 1n, buyNowDate: "2026-11-22", buyLater: later }))).toBe("date_outside_horizon");
    expect(simulatePurchase(f, { costVnd: 1n, buyLater: { kind: "date", date: "2027-01-06" } }).scenarios.later.purchaseDate).toBe("2027-01-06");
  });

  it("requires buy-later to be after buy-now", () => {
    expect(codeOf(() => simulatePurchase(f, { costVnd: 1n, buyLater: { kind: "date", date: "2026-11-23" } }))).toBe("buy_later_not_after_buy_now");
  });

  it("rejects non-positive costs and malformed dates", () => {
    expect(codeOf(() => simulatePurchase(f, { costVnd: 0n, buyLater: later }))).toBe("invalid_amount");
    expect(codeOf(() => simulatePurchase(f, { costVnd: -5n, buyLater: later }))).toBe("invalid_amount");
    expect(codeOf(() => simulatePurchase(f, { costVnd: 1n, buyLater: { kind: "date", date: "2026-02-30" } }))).toBe("invalid_date");
  });
});

describe("simulator properties", () => {
  it("safe <=> every daily balance >= max(0, reserve), for any cost and dates", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20_000_000 }),
        fc.integer({ min: 0, max: 43 }),
        fc.integer({ min: 1, max: 44 }),
        fc.integer({ min: 0, max: 2_000_000 }),
        (cost, nowOffset, gap, reserve) => {
          const f = forecastCashflow({
            ...paydayInput(),
            profile: profile({ balanceSnapshotVnd: 1_000_000n, minimumReserveVnd: BigInt(reserve), expectedDailyExpenseVnd: 50_000n }),
          });
          const nowDay = f.days[nowOffset]!.date;
          const laterIndex = Math.min(44, nowOffset + gap);
          if (laterIndex === nowOffset) return;
          const result = simulatePurchase(f, { costVnd: BigInt(cost), buyNowDate: nowDay, buyLater: { kind: "date", date: f.days[laterIndex]!.date } });
          for (const scenario of [result.scenarios.now, result.scenarios.later]) {
            const floor = BigInt(Math.max(0, reserve));
            expect(scenario.safe).toBe(scenario.closingBalances.every((p) => p.balanceVnd >= floor));
            expect(scenario.minimumVnd).toBe(scenario.closingBalances.reduce((m, p) => (p.balanceVnd < m ? p.balanceVnd : m), scenario.closingBalances[0]!.balanceVnd));
            expect(scenario.safe).toBe(scenario.violation === "none");
          }
          // Waiting never lowers any single day's balance versus buying earlier.
          result.scenarios.now.closingBalances.forEach((p, i) => {
            expect(result.scenarios.later.closingBalances[i]!.balanceVnd >= p.balanceVnd).toBe(true);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Keep a reference so unused-import lint does not hide intent.
void vn;
