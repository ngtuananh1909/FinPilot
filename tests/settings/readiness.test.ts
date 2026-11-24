import { describe, expect, it } from "vitest";
import { assessForecastReadiness, type ReadinessInput } from "@/lib/settings/readiness";

const complete: ReadinessInput = {
  balanceSnapshotVnd: 2_500_000n,
  paydayDay: 5,
  expectedMonthlyIncomeVnd: 6_000_000n,
  expectedDailyExpenseVnd: 120_000n,
  activeRecurringCount: 2,
};

describe("assessForecastReadiness", () => {
  it("is complete when every input is set", () => {
    expect(assessForecastReadiness(complete)).toEqual({ complete: true, issues: [] });
  });

  const table: [string, Partial<ReadinessInput>, { field: string; problem: string }[]][] = [
    ["zero snapshot", { balanceSnapshotVnd: 0n }, [{ field: "balance_snapshot", problem: "zero" }]],
    ["negative snapshot is set (overdraft)", { balanceSnapshotVnd: -1n }, []],
    ["no payday", { paydayDay: null }, [{ field: "payday_day", problem: "missing" }]],
    ["no income", { expectedMonthlyIncomeVnd: 0n }, [{ field: "expected_monthly_income", problem: "zero" }]],
    ["no variable estimate", { expectedDailyExpenseVnd: 0n }, [{ field: "expected_daily_expense", problem: "zero" }]],
    ["no recurring items", { activeRecurringCount: 0 }, [{ field: "recurring_items", problem: "missing" }]],
    [
      "everything empty",
      { balanceSnapshotVnd: 0n, paydayDay: null, expectedMonthlyIncomeVnd: 0n, expectedDailyExpenseVnd: 0n, activeRecurringCount: 0 },
      [
        { field: "balance_snapshot", problem: "zero" },
        { field: "payday_day", problem: "missing" },
        { field: "expected_monthly_income", problem: "zero" },
        { field: "expected_daily_expense", problem: "zero" },
        { field: "recurring_items", problem: "missing" },
      ],
    ],
  ];

  it.each(table)("%s", (_name, over, issues) => {
    const result = assessForecastReadiness({ ...complete, ...over });
    expect(result.issues).toEqual(issues);
    expect(result.complete).toBe(issues.length === 0);
  });
});
