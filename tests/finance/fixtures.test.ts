import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  forecastCashflow,
  simulatePurchase,
  type FinanceTransaction,
  type ForecastInput,
  type RecurringItem,
  type TransactionKind,
} from "@/lib/finance";
import { stable } from "./helpers";

// Reads the synthetic seed SOURCE files (never a runtime database) to sanity-check
// that the engine behaves sensibly on the data the demo personas will be seeded with.
const dataDir = join(process.cwd(), "mock-data");
const personas = JSON.parse(readFileSync(join(dataDir, "personas.json"), "utf8")).personas as Array<Record<string, string | number>>;
const recurringRows = JSON.parse(readFileSync(join(dataDir, "recurring-items.json"), "utf8")) as Array<Record<string, string | number | boolean>>;
const transactionRows = readFileSync(join(dataDir, "transactions.csv"), "utf8")
  .trim()
  .split("\n")
  .slice(1)
  .map((line) => line.split(","));

function inputFor(code: string): ForecastInput {
  const p = personas.find((row) => row.code === code)!;
  const recurringItems: RecurringItem[] = recurringRows
    .filter((row) => row.persona_code === code)
    .map((row, i) => ({
      id: `${code}-recurring-${i}`,
      kind: row.kind as "income" | "expense",
      amountVnd: BigInt(row.amount_vnd as number),
      dayOfMonth: row.day_of_month as number,
      startDate: row.start_date as string,
      endDate: null,
      active: row.active as boolean,
    }));
  const transactions: FinanceTransaction[] = transactionRows
    .filter((row) => row[0] === code)
    .map((row, i) => ({
      id: `${code}-tx-${i}`,
      occurredAt: new Date(row[1]!),
      kind: row[2] as TransactionKind,
      amountVnd: BigInt(row[3]!),
    }));
  return {
    now: new Date("2026-11-23T10:00:00+07:00"),
    profile: {
      balanceSnapshotVnd: BigInt(p.balance_snapshot_vnd as number),
      balanceSnapshotAt: new Date(p.balance_snapshot_at as string),
      minimumReserveVnd: BigInt(p.minimum_reserve_vnd as number),
      expectedDailyExpenseVnd: BigInt(p.expected_daily_expense_vnd as number),
      expectedMonthlyIncomeVnd: BigInt(p.expected_monthly_income_vnd as number),
      paydayDay: p.payday_day as number,
    },
    recurringItems,
    transactions,
  };
}

describe.each(["student", "worker", "at_risk"])("persona fixture: %s", (code) => {
  it("produces a deterministic 45-day forecast from history-based spending", () => {
    const first = forecastCashflow(inputFor(code));
    expect(first.days).toHaveLength(45);
    expect(first.assumptions[0]?.code).toBe("variable_expense_history");
    expect(first.unreconciledOccurrences).toEqual([]);
    expect(first.startingBalanceVnd).toBe(inputFor(code).profile.balanceSnapshotVnd);
    expect(stable(forecastCashflow(inputFor(code)))).toBe(stable(first));
  });

  it("compares buy now vs next payday on the same baseline", () => {
    const forecast = forecastCashflow(inputFor(code));
    const result = simulatePurchase(forecast, { costVnd: 1_500_000n, buyLater: { kind: "next_payday" } });
    expect(result.scenarios.later.purchaseDate > result.scenarios.now.purchaseDate).toBe(true);
    expect(result.scenarios.now.closingBalances).toHaveLength(45);
  });
});

describe("persona fixture characterization (detects fixture or engine drift)", () => {
  it("student dips below the reserve between rent (12-01) and allowance (12-05)", () => {
    const f = forecastCashflow(inputFor("student"));
    expect(f.summary.firstBelowReserveDate).toBe("2026-12-02");
    expect(f.summary.reserveBreachDays).toBe(3);
    expect(f.summary.minimumVnd).toBe(202_304n);
    expect(f.summary.minimumDate).toBe("2026-12-04");
    expect(f.summary.firstBelowZeroDate).toBeNull();
  });

  it("worker stays safe for the whole horizon", () => {
    const f = forecastCashflow(inputFor("worker"));
    expect(f.summary.safe).toBe(true);
  });


  it("at_risk runs short before the 12-25 payday", () => {
    const f = forecastCashflow(inputFor("at_risk"));
    expect(f.assumptions[0]).toMatchObject({ code: "variable_expense_history", dailyVnd: 217_037n });
    expect(f.summary.firstBelowReserveDate).toBe("2026-12-17");
    expect(f.summary.firstBelowZeroDate).toBe("2026-12-20");
    expect(f.summary.minimumVnd).toBe(-995_184n);
    expect(f.summary.minimumDate).toBe("2026-12-24");
    expect(f.summary.safe).toBe(false);
  });
});
