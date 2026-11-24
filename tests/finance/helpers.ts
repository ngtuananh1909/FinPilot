import type {
  FinanceProfile,
  FinanceTransaction,
  ForecastInput,
  RecurringItem,
} from "@/lib/finance";

/** Vietnam local time (+07:00) as an instant. */
export function vn(isoLocal: string): Date {
  return new Date(`${isoLocal}+07:00`);
}

export function profile(overrides: Partial<FinanceProfile> = {}): FinanceProfile {
  return {
    balanceSnapshotVnd: 3_000_000n,
    balanceSnapshotAt: vn("2026-11-23T09:00:00"),
    minimumReserveVnd: 0n,
    expectedDailyExpenseVnd: 0n,
    expectedMonthlyIncomeVnd: 0n,
    paydayDay: null,
    ...overrides,
  };
}

let counter = 0;
export function tx(
  kind: FinanceTransaction["kind"],
  amountVnd: bigint,
  occurredAtLocal: string,
  extra: Partial<FinanceTransaction> = {},
): FinanceTransaction {
  counter += 1;
  return { id: `tx-${counter}`, kind, amountVnd, occurredAt: vn(occurredAtLocal), ...extra };
}

export function recurring(overrides: Partial<RecurringItem> & Pick<RecurringItem, "id">): RecurringItem {
  return {
    kind: "expense",
    amountVnd: 1_000_000n,
    dayOfMonth: 1,
    startDate: "2026-01-01",
    endDate: null,
    active: true,
    ...overrides,
  };
}

export function input(overrides: Partial<ForecastInput> = {}): ForecastInput {
  return {
    profile: profile(),
    transactions: [],
    recurringItems: [],
    now: vn("2026-11-23T10:00:00"),
    ...overrides,
  };
}

/** JSON with bigint support, for deep-equality and determinism checks. */
export function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) => (typeof v === "bigint" ? `${v.toString()}n` : v));
}
