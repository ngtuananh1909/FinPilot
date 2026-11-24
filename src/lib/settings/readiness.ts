/**
 * Forecast readiness (docs/02 "Settings": when onboarding inputs are skipped the forecast must
 * show an explicit incomplete state instead of fabricated numbers). Pure: no I/O, no clock.
 *
 * The profile columns are NOT NULL with default 0, so "not set" cannot be told apart from a
 * deliberate zero. A zero amount is therefore reported as `zero` and the UI should phrase it as
 * "chưa thiết lập / đang bằng 0", never as an error.
 */
export const READINESS_FIELDS = [
  "balance_snapshot",
  "payday_day",
  "expected_monthly_income",
  "expected_daily_expense",
  "recurring_items",
] as const;

export type ReadinessField = (typeof READINESS_FIELDS)[number];
export type ReadinessProblem = "missing" | "zero";

export interface ReadinessIssue {
  readonly field: ReadinessField;
  readonly problem: ReadinessProblem;
}

export interface ReadinessInput {
  readonly balanceSnapshotVnd: bigint;
  readonly paydayDay: number | null;
  readonly expectedMonthlyIncomeVnd: bigint;
  readonly expectedDailyExpenseVnd: bigint;
  /** Number of ACTIVE recurring items. */
  readonly activeRecurringCount: number;
}

export interface ForecastReadiness {
  /** True only when no input is missing or zero. */
  readonly complete: boolean;
  readonly issues: readonly ReadinessIssue[];
}

export function assessForecastReadiness(input: ReadinessInput): ForecastReadiness {
  const issues: ReadinessIssue[] = [];
  if (input.balanceSnapshotVnd === 0n) issues.push({ field: "balance_snapshot", problem: "zero" });
  if (input.paydayDay === null) issues.push({ field: "payday_day", problem: "missing" });
  if (input.expectedMonthlyIncomeVnd === 0n) issues.push({ field: "expected_monthly_income", problem: "zero" });
  if (input.expectedDailyExpenseVnd === 0n) issues.push({ field: "expected_daily_expense", problem: "zero" });
  if (input.activeRecurringCount === 0) issues.push({ field: "recurring_items", problem: "missing" });
  return { complete: issues.length === 0, issues };
}
