import { signedAmount, balanceAt, validateProfile, validateTransactions } from "./balance";
import { addDays, compareLocalDates, diffDays, localDateOf, type LocalDate } from "./dates";
import { FinanceError } from "./errors";
import { assertPositiveVnd, divideRoundHalfUp } from "./money";
import { isInForce, recurringKey, recurringOccurrences } from "./recurrence";
import { summarizeBalances } from "./summary";
import type {
  Assumption,
  DailyPoint,
  FinanceProfile,
  FinanceTransaction,
  Forecast,
  ForecastEvent,
  ForecastInput,
  RecurringItem,
  UnreconciledOccurrence,
} from "./types";

export const FORECAST_HORIZON_DAYS = 45;
const MAX_HORIZON_DAYS = 366;
const HISTORY_WINDOW_DAYS = 30;
const MIN_HISTORY_TRANSACTIONS = 5;
const MIN_HISTORY_DISTINCT_DAYS = 7;
const PROFILE_INCOME_ID = "profile-income";

interface VariableEstimate {
  dailyVnd: bigint;
  assumption: Assumption;
}

/**
 * Daily variable spending: 30-day history of non-recurring expenses when it has
 * >= 5 transactions on >= 7 distinct days, otherwise the profile fallback.
 * Today is excluded from history because it is only partly observed.
 */
export function estimateVariableExpense(
  profile: Pick<FinanceProfile, "expectedDailyExpenseVnd">,
  transactions: readonly FinanceTransaction[],
  today: LocalDate,
): VariableEstimate {
  const windowStart = addDays(today, -HISTORY_WINDOW_DAYS);
  const windowEnd = addDays(today, -1);
  const eligible: Array<{ date: LocalDate; amountVnd: bigint }> = [];
  for (const tx of transactions) {
    if (tx.kind !== "expense" || tx.recurringItemId) continue;
    const date = localDateOf(tx.occurredAt);
    if (compareLocalDates(date, windowStart) >= 0 && compareLocalDates(date, windowEnd) <= 0) {
      eligible.push({ date, amountVnd: tx.amountVnd });
    }
  }
  const distinctDays = new Set(eligible.map((row) => row.date)).size;

  if (eligible.length >= MIN_HISTORY_TRANSACTIONS && distinctDays >= MIN_HISTORY_DISTINCT_DAYS) {
    const earliest = eligible.reduce((min, row) => (compareLocalDates(row.date, min) < 0 ? row.date : min), eligible[0]!.date);
    // Average over the observed span (earliest..yesterday), capped at 30 days.
    const windowDays = diffDays(today, earliest);
    const total = eligible.reduce((sum, row) => sum + row.amountVnd, 0n);
    const dailyVnd = divideRoundHalfUp(total, BigInt(windowDays));
    return {
      dailyVnd,
      assumption: {
        code: "variable_expense_history",
        dailyVnd,
        sampleTransactionCount: eligible.length,
        sampleDayCount: distinctDays,
        windowDays,
      },
    };
  }

  const dailyVnd = profile.expectedDailyExpenseVnd;
  return {
    dailyVnd,
    assumption:
      dailyVnd > 0n
        ? {
            code: "variable_expense_profile_fallback",
            dailyVnd,
            sampleTransactionCount: eligible.length,
            sampleDayCount: distinctDays,
          }
        : { code: "variable_expense_missing" },
  };
}

function validateRecurringItems(items: readonly RecurringItem[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    assertPositiveVnd(item.amountVnd);
    if (seen.has(item.id)) {
      throw new FinanceError("duplicate_transaction_id", `Recurring item ${item.id} appears twice.`);
    }
    seen.add(item.id);
  }
}

/**
 * Deterministic 45-day forecast (D0..D0+44, inclusive) in Asia/Ho_Chi_Minh.
 *
 * Per day: closing = previous closing + known income - known expenses - variable estimate.
 * Known items are future-dated transactions and recurring occurrences with no
 * matching posted transaction (matched by item id + instance date), each counted once.
 * Today's variable estimate is reduced by variable spending already posted today.
 */
export function forecastCashflow(input: ForecastInput): Forecast {
  const horizonDays = input.horizonDays ?? FORECAST_HORIZON_DAYS;
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > MAX_HORIZON_DAYS) {
    throw new FinanceError("invalid_horizon", `Horizon must be 1-${MAX_HORIZON_DAYS} days.`);
  }
  const { profile, transactions, recurringItems, now } = input;
  validateProfile(profile);
  validateTransactions(transactions);
  validateRecurringItems(recurringItems);

  const today = localDateOf(now);
  const endDate = addDays(today, horizonDays - 1);
  const nowMs = now.getTime();
  const snapshotMs = profile.balanceSnapshotAt.getTime();
  const startingBalanceVnd = balanceAt(profile, transactions, now);
  const reserveVnd = profile.minimumReserveVnd > 0n ? profile.minimumReserveVnd : 0n;

  const income: bigint[] = Array.from({ length: horizonDays }, () => 0n);
  const expense: bigint[] = Array.from({ length: horizonDays }, () => 0n);
  const events: ForecastEvent[] = [];
  const assumptions: Assumption[] = [];

  const settled = new Set<string>();
  for (const tx of transactions) {
    if (tx.recurringItemId && tx.recurringInstanceDate) {
      settled.add(recurringKey(tx.recurringItemId, tx.recurringInstanceDate));
    }
  }

  const addKnown = (event: ForecastEvent): void => {
    const index = diffDays(event.date, today);
    if (index < 0 || index >= horizonDays) return;
    const bucket = event.kind === "income" ? income : expense;
    bucket[index] = (bucket[index] ?? 0n) + event.amountVnd;
    events.push(event);
  };

  // Future-dated transactions land on their own local day, exactly once.
  let spentVariableToday = 0n;
  for (const tx of transactions) {
    const ms = tx.occurredAt.getTime();
    if (ms > nowMs) {
      if (tx.kind !== "excluded") {
        addKnown({
          date: localDateOf(tx.occurredAt),
          source: "transaction",
          refId: tx.id,
          kind: tx.kind,
          amountVnd: tx.amountVnd,
        });
      }
    } else if (
      ms > snapshotMs &&
      tx.kind === "expense" &&
      !tx.recurringItemId &&
      localDateOf(tx.occurredAt) === today
    ) {
      spentVariableToday += signedAmount(tx) * -1n;
    }
  }

  // Recurring schedule. Profile income is a fallback only when no recurring income is in force.
  const scheduleItems: Array<{ item: RecurringItem; source: "recurring" | "profile_income" }> =
    recurringItems.map((item) => ({ item, source: "recurring" as const }));
  const hasIncomeInForce = recurringItems.some((item) => item.kind === "income" && isInForce(item, today));
  if (!hasIncomeInForce && profile.expectedMonthlyIncomeVnd > 0n && profile.paydayDay !== null) {
    scheduleItems.push({
      source: "profile_income",
      item: {
        id: PROFILE_INCOME_ID,
        kind: "income",
        amountVnd: profile.expectedMonthlyIncomeVnd,
        dayOfMonth: profile.paydayDay,
        startDate: "1970-01-01",
        endDate: null,
        active: true,
      },
    });
    assumptions.push({
      code: "income_from_profile",
      monthlyVnd: profile.expectedMonthlyIncomeVnd,
      paydayDay: profile.paydayDay,
    });
  }

  for (const { item, source } of scheduleItems) {
    for (const date of recurringOccurrences(item, today, endDate)) {
      if (settled.has(recurringKey(item.id, date))) continue;
      addKnown({ date, source, refId: item.id, kind: item.kind, amountVnd: item.amountVnd });
    }
  }

  // Occurrences after the snapshot day that were never posted: report, never guess.
  const unreconciledOccurrences: UnreconciledOccurrence[] = [];
  const reconcileFrom = addDays(localDateOf(profile.balanceSnapshotAt), 1);
  const reconcileTo = addDays(today, -1);
  for (const item of recurringItems) {
    for (const date of recurringOccurrences(item, reconcileFrom, reconcileTo)) {
      if (!settled.has(recurringKey(item.id, date))) {
        unreconciledOccurrences.push({ itemId: item.id, date, kind: item.kind, amountVnd: item.amountVnd });
      }
    }
  }
  unreconciledOccurrences.sort(
    (a, b) => compareLocalDates(a.date, b.date) || (a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0),
  );

  const variable = estimateVariableExpense(profile, transactions, today);
  assumptions.unshift(variable.assumption);

  const days: DailyPoint[] = [];
  let balance = startingBalanceVnd;
  for (let index = 0; index < horizonDays; index += 1) {
    const dayIncome = income[index] ?? 0n;
    const dayKnownExpense = expense[index] ?? 0n;
    let dayVariable = variable.dailyVnd;
    if (index === 0) {
      dayVariable = dayVariable > spentVariableToday ? dayVariable - spentVariableToday : 0n;
    }
    balance = balance + dayIncome - dayKnownExpense - dayVariable;
    days.push({
      date: addDays(today, index),
      incomeVnd: dayIncome,
      knownExpenseVnd: dayKnownExpense,
      variableExpenseVnd: dayVariable,
      closingBalanceVnd: balance,
      belowZero: balance < 0n,
      belowReserve: balance < reserveVnd,
    });
  }

  events.sort((a, b) => {
    const byDate = compareLocalDates(a.date, b.date);
    if (byDate !== 0) return byDate;
    const bySource = a.source < b.source ? -1 : a.source > b.source ? 1 : 0;
    if (bySource !== 0) return bySource;
    return a.refId < b.refId ? -1 : a.refId > b.refId ? 1 : 0;
  });

  return {
    horizonDays,
    startDate: today,
    endDate,
    startingBalanceVnd,
    reserveVnd,
    days,
    events,
    summary: summarizeBalances(
      days.map((day) => ({ date: day.date, balanceVnd: day.closingBalanceVnd })),
      reserveVnd,
    ),
    assumptions,
    unreconciledOccurrences,
  };
}
