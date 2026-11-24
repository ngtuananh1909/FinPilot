import type { LocalDate } from "./dates";

export type TransactionKind = "income" | "expense" | "excluded";
export type RecurringKind = "income" | "expense";

/** Posted or future-dated transaction. `amountVnd` is always positive; `kind` gives the sign. */
export interface FinanceTransaction {
  id: string;
  occurredAt: Date;
  kind: TransactionKind;
  amountVnd: bigint;
  recurringItemId?: string | null;
  recurringInstanceDate?: LocalDate | null;
}

/** Monthly recurring item. Days 29-31 clamp to the last day of shorter months. */
export interface RecurringItem {
  id: string;
  kind: RecurringKind;
  amountVnd: bigint;
  dayOfMonth: number;
  startDate: LocalDate;
  endDate?: LocalDate | null;
  active: boolean;
}

export interface FinanceProfile {
  /** User-reported estimated balance at `balanceSnapshotAt`. Anchor for all balances. */
  balanceSnapshotVnd: bigint;
  balanceSnapshotAt: Date;
  minimumReserveVnd: bigint;
  /** Fallback variable spending per day when history is too sparse. */
  expectedDailyExpenseVnd: bigint;
  /** Used only when no active recurring income exists. */
  expectedMonthlyIncomeVnd: bigint;
  paydayDay: number | null;
}

export interface ForecastInput {
  profile: FinanceProfile;
  transactions: readonly FinanceTransaction[];
  recurringItems: readonly RecurringItem[];
  /** Injected clock. The engine never reads the system time. */
  now: Date;
  /** Defaults to 45 (inclusive of today). */
  horizonDays?: number;
}

export type ForecastEventSource = "recurring" | "profile_income" | "transaction";

export interface ForecastEvent {
  date: LocalDate;
  source: ForecastEventSource;
  /** Recurring item id or transaction id. Synthetic profile income uses "profile-income". */
  refId: string;
  kind: RecurringKind;
  amountVnd: bigint;
}

export interface DailyPoint {
  date: LocalDate;
  incomeVnd: bigint;
  /** Known expenses: recurring, future-dated transactions. */
  knownExpenseVnd: bigint;
  /** Estimated variable spending for the day. */
  variableExpenseVnd: bigint;
  closingBalanceVnd: bigint;
  belowZero: boolean;
  belowReserve: boolean;
}

export type Assumption =
  | {
      code: "variable_expense_history";
      dailyVnd: bigint;
      sampleTransactionCount: number;
      sampleDayCount: number;
      windowDays: number;
    }
  | {
      code: "variable_expense_profile_fallback";
      dailyVnd: bigint;
      sampleTransactionCount: number;
      sampleDayCount: number;
    }
  | { code: "variable_expense_missing" }
  | { code: "income_from_profile"; monthlyVnd: bigint; paydayDay: number };

/** Recurring occurrence after the snapshot date that has no matching posted transaction. */
export interface UnreconciledOccurrence {
  itemId: string;
  date: LocalDate;
  kind: RecurringKind;
  amountVnd: bigint;
}

export interface ForecastSummary {
  minimumVnd: bigint;
  minimumDate: LocalDate;
  endBalanceVnd: bigint;
  firstBelowZeroDate: LocalDate | null;
  firstBelowReserveDate: LocalDate | null;
  reserveBreachDays: number;
  /** True only when every daily closing balance is >= max(0, reserve). */
  safe: boolean;
}

export interface Forecast {
  horizonDays: number;
  /** First day of the horizon (today in Asia/Ho_Chi_Minh). */
  startDate: LocalDate;
  /** Last day of the horizon, inclusive. */
  endDate: LocalDate;
  startingBalanceVnd: bigint;
  /** Effective reserve: max(0, profile reserve). */
  reserveVnd: bigint;
  days: DailyPoint[];
  events: ForecastEvent[];
  summary: ForecastSummary;
  assumptions: Assumption[];
  unreconciledOccurrences: UnreconciledOccurrence[];
}
