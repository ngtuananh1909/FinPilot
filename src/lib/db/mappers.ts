import { z } from "zod";
import {
  parseLocalDate,
  type FinanceProfile,
  type FinanceTransaction,
  type LocalDate,
  type RecurringItem,
} from "@/lib/finance";
import { DbError } from "./errors";
import type {
  goalUpsertSchema,
  ProfileUpdateInput,
  RecurringCreateInput,
  RecurringUpdateInput,
  TransactionCreateInput,
  TransactionUpdateInput,
} from "./inputs";
import { parseDbVnd, vndForDb } from "./money";
import { parseInstant } from "./time";
import {
  IMPORT_SOURCES,
  IMPORT_STATUSES,
  PERSONA_CODES,
  RECURRING_KINDS,
  TRANSACTION_KINDS,
  TRANSACTION_SOURCES,
  type FinancialProfileUpdate,
  type ImportBatchInsert,
  type RecurringItemInsert,
  type RecurringItemUpdate,
  type SavingsGoalUpsert,
  type TransactionInsert,
  type TransactionUpdate,
} from "./schema";

// ---------------------------------------------------------------------------
// Domain records returned by repositories. They extend the pure-engine types so a
// record can be passed to the finance module directly.
// ---------------------------------------------------------------------------

export interface ProfileRecord extends FinanceProfile {
  displayName: string;
  personaCode: (typeof PERSONA_CODES)[number] | null;
  projectedMonthlyBudgetVnd: bigint;
  isDemo: boolean;
  updatedAt: Date;
}
export interface TransactionRecord extends FinanceTransaction {
  category: string;
  merchant: string | null;
  description: string | null;
  source: (typeof TRANSACTION_SOURCES)[number];
  fingerprint: string | null;
  importBatchId: string | null;
  createdAt: Date;
  updatedAt: Date;
}
export interface RecurringRecord extends RecurringItem {
  label: string;
  category: string;
  createdAt: Date;
  updatedAt: Date;
}
export interface GoalRecord {
  name: string;
  targetVnd: bigint;
  savedVnd: bigint;
  targetDate: LocalDate | null;
  updatedAt: Date;
}
export interface ImportBatchRecord {
  id: string;
  idempotencyKey: string;
  source: (typeof IMPORT_SOURCES)[number];
  filename: string | null;
  status: (typeof IMPORT_STATUSES)[number];
  acceptedCount: number;
  rejectedCount: number;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Row validation. Selected column lists are explicit, so extra keys are ignored.
// ---------------------------------------------------------------------------

const TIMESTAMPTZ = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;
const timestamptz = z.string().regex(TIMESTAMPTZ);
const dbDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dbBigint = z.union([z.number(), z.string(), z.bigint()]);
const uuid = z.uuid();
const nullableText = z.string().nullable();

const profileRow = z.object({
  persona_code: z.enum(PERSONA_CODES).nullable(),
  display_name: z.string(),
  balance_snapshot_vnd: dbBigint,
  balance_snapshot_at: timestamptz,
  expected_monthly_income_vnd: dbBigint,
  payday_day: z.number().int().min(1).max(31).nullable(),
  expected_daily_expense_vnd: dbBigint,
  projected_monthly_budget_vnd: dbBigint,
  minimum_reserve_vnd: dbBigint,
  is_demo: z.boolean(),
  updated_at: timestamptz,
});
const transactionRow = z.object({
  id: uuid,
  occurred_at: timestamptz,
  kind: z.enum(TRANSACTION_KINDS),
  amount_vnd: dbBigint,
  category: z.string(),
  merchant: nullableText,
  description: nullableText,
  source: z.enum(TRANSACTION_SOURCES),
  fingerprint: nullableText,
  import_batch_id: uuid.nullable(),
  recurring_item_id: uuid.nullable(),
  recurring_instance_date: dbDate.nullable(),
  created_at: timestamptz,
  updated_at: timestamptz,
});
const recurringRow = z.object({
  id: uuid,
  label: z.string(),
  kind: z.enum(RECURRING_KINDS),
  amount_vnd: dbBigint,
  day_of_month: z.number().int().min(1).max(31),
  category: z.string(),
  start_date: dbDate,
  end_date: dbDate.nullable(),
  active: z.boolean(),
  created_at: timestamptz,
  updated_at: timestamptz,
});
const goalRow = z.object({
  name: z.string(),
  target_vnd: dbBigint,
  saved_vnd: dbBigint,
  target_date: dbDate.nullable(),
  updated_at: timestamptz,
});
const importBatchRow = z.object({
  id: uuid,
  idempotency_key: z.string(),
  source: z.enum(IMPORT_SOURCES),
  filename: nullableText,
  status: z.enum(IMPORT_STATUSES),
  accepted_count: z.number().int().min(0),
  rejected_count: z.number().int().min(0),
  created_at: timestamptz,
});

/** Column lists used by repositories (no `select('*')`, no `user_id` leak to callers). */
export const COLUMNS = {
  profile:
    "persona_code,display_name,balance_snapshot_vnd,balance_snapshot_at,expected_monthly_income_vnd,payday_day,expected_daily_expense_vnd,projected_monthly_budget_vnd,minimum_reserve_vnd,is_demo,updated_at",
  transaction:
    "id,occurred_at,kind,amount_vnd,category,merchant,description,source,fingerprint,import_batch_id,recurring_item_id,recurring_instance_date,created_at,updated_at",
  recurring: "id,label,kind,amount_vnd,day_of_month,category,start_date,end_date,active,created_at,updated_at",
  goal: "name,target_vnd,saved_vnd,target_date,updated_at",
  importBatch: "id,idempotency_key,source,filename,status,accepted_count,rejected_count,created_at",
} as const;

/** Any malformed row becomes one DbError(db_row_invalid). No row content, stack or cause leaks. */
function rowInvalid(table: string, rule: string): DbError {
  return new DbError("db_row_invalid", { safeDetails: { table, rule } });
}

function guarded<T>(table: string, build: () => T): T {
  try {
    return build();
  } catch (error) {
    if (error instanceof DbError) throw error;
    const rule = error instanceof z.ZodError ? "shape" : "value";
    throw rowInvalid(table, rule);
  }
}

function toDate(table: string, value: string): Date {
  const date = parseInstant(value);
  if (!date) throw rowInvalid(table, "timestamp");
  return date;
}

/** `date` columns stay 'YYYY-MM-DD' strings (no Date round trip, no timezone shift). */
function toLocalDate(table: string, value: string): LocalDate {
  try {
    parseLocalDate(value);
  } catch {
    throw rowInvalid(table, "date");
  }
  return value;
}

function nonNegative(table: string, value: bigint): bigint {
  if (value < 0n) throw rowInvalid(table, "negative_amount");
  return value;
}

function positive(table: string, value: bigint): bigint {
  if (value <= 0n) throw rowInvalid(table, "non_positive_amount");
  return value;
}

export function mapProfileRow(row: unknown): ProfileRecord {
  return guarded("financial_profiles", () => {
    const r = profileRow.parse(row);
    const t = "financial_profiles";
    return {
      balanceSnapshotVnd: parseDbVnd(r.balance_snapshot_vnd),
      balanceSnapshotAt: toDate(t, r.balance_snapshot_at),
      minimumReserveVnd: nonNegative(t, parseDbVnd(r.minimum_reserve_vnd)),
      expectedDailyExpenseVnd: nonNegative(t, parseDbVnd(r.expected_daily_expense_vnd)),
      expectedMonthlyIncomeVnd: nonNegative(t, parseDbVnd(r.expected_monthly_income_vnd)),
      projectedMonthlyBudgetVnd: nonNegative(t, parseDbVnd(r.projected_monthly_budget_vnd)),
      paydayDay: r.payday_day,
      displayName: r.display_name,
      personaCode: r.persona_code,
      isDemo: r.is_demo,
      updatedAt: toDate(t, r.updated_at),
    };
  });
}

export function mapTransactionRow(row: unknown): TransactionRecord {
  return guarded("transactions", () => {
    const r = transactionRow.parse(row);
    const t = "transactions";
    if ((r.recurring_item_id === null) !== (r.recurring_instance_date === null)) {
      throw rowInvalid(t, "recurring_pair");
    }
    return {
      id: r.id,
      occurredAt: toDate(t, r.occurred_at),
      kind: r.kind,
      amountVnd: positive(t, parseDbVnd(r.amount_vnd)),
      recurringItemId: r.recurring_item_id,
      recurringInstanceDate: r.recurring_instance_date === null ? null : toLocalDate(t, r.recurring_instance_date),
      category: r.category,
      merchant: r.merchant,
      description: r.description,
      source: r.source,
      fingerprint: r.fingerprint,
      importBatchId: r.import_batch_id,
      createdAt: toDate(t, r.created_at),
      updatedAt: toDate(t, r.updated_at),
    };
  });
}

export function mapRecurringRow(row: unknown): RecurringRecord {
  return guarded("recurring_items", () => {
    const r = recurringRow.parse(row);
    const t = "recurring_items";
    const startDate = toLocalDate(t, r.start_date);
    const endDate = r.end_date === null ? null : toLocalDate(t, r.end_date);
    if (endDate !== null && endDate < startDate) throw rowInvalid(t, "date_range");
    return {
      id: r.id,
      kind: r.kind,
      amountVnd: positive(t, parseDbVnd(r.amount_vnd)),
      dayOfMonth: r.day_of_month,
      startDate,
      endDate,
      active: r.active,
      label: r.label,
      category: r.category,
      createdAt: toDate(t, r.created_at),
      updatedAt: toDate(t, r.updated_at),
    };
  });
}

export function mapGoalRow(row: unknown): GoalRecord {
  return guarded("savings_goals", () => {
    const r = goalRow.parse(row);
    const t = "savings_goals";
    return {
      name: r.name,
      targetVnd: positive(t, parseDbVnd(r.target_vnd)),
      savedVnd: nonNegative(t, parseDbVnd(r.saved_vnd)),
      targetDate: r.target_date === null ? null : toLocalDate(t, r.target_date),
      updatedAt: toDate(t, r.updated_at),
    };
  });
}

export function mapImportBatchRow(row: unknown): ImportBatchRecord {
  return guarded("import_batches", () => {
    const r = importBatchRow.parse(row);
    return {
      id: r.id,
      idempotencyKey: r.idempotency_key,
      source: r.source,
      filename: r.filename,
      status: r.status,
      acceptedCount: r.accepted_count,
      rejectedCount: r.rejected_count,
      createdAt: toDate("import_batches", r.created_at),
    };
  });
}

// ---------------------------------------------------------------------------
// Domain -> write payloads. `userId` always comes from the OwnerContext (caller passes it).
// Inputs are already validated by the zod schemas in ./inputs.
// ---------------------------------------------------------------------------

export function toTransactionInsert(userId: string, input: TransactionCreateInput): TransactionInsert {
  return {
    user_id: userId,
    occurred_at: input.occurredAt.toISOString(),
    kind: input.kind,
    amount_vnd: vndForDb(input.amountVnd),
    category: input.category,
    merchant: input.merchant || null,
    description: input.description || null,
    source: input.source,
    fingerprint: input.fingerprint ?? null,
    import_batch_id: input.importBatchId ?? null,
    recurring_item_id: input.recurringItemId ?? null,
    recurring_instance_date: input.recurringInstanceDate ?? null,
  };
}

export function toTransactionUpdate(input: TransactionUpdateInput): TransactionUpdate {
  const out: TransactionUpdate = {};
  if (input.occurredAt !== undefined) out.occurred_at = input.occurredAt.toISOString();
  if (input.kind !== undefined) out.kind = input.kind;
  if (input.amountVnd !== undefined) out.amount_vnd = vndForDb(input.amountVnd);
  if (input.category !== undefined) out.category = input.category;
  if (input.merchant !== undefined) out.merchant = input.merchant || null;
  if (input.description !== undefined) out.description = input.description || null;
  if (input.fingerprint !== undefined) out.fingerprint = input.fingerprint;
  if (input.recurringItemId !== undefined) out.recurring_item_id = input.recurringItemId;
  if (input.recurringInstanceDate !== undefined) out.recurring_instance_date = input.recurringInstanceDate;
  return out;
}

export function toRecurringInsert(userId: string, input: RecurringCreateInput): RecurringItemInsert {
  return {
    user_id: userId,
    label: input.label,
    kind: input.kind,
    amount_vnd: vndForDb(input.amountVnd),
    day_of_month: input.dayOfMonth,
    category: input.category,
    start_date: input.startDate,
    end_date: input.endDate ?? null,
    active: true,
  };
}

export function toRecurringUpdate(input: RecurringUpdateInput): RecurringItemUpdate {
  const out: RecurringItemUpdate = {};
  if (input.label !== undefined) out.label = input.label;
  if (input.kind !== undefined) out.kind = input.kind;
  if (input.amountVnd !== undefined) out.amount_vnd = vndForDb(input.amountVnd);
  if (input.dayOfMonth !== undefined) out.day_of_month = input.dayOfMonth;
  if (input.category !== undefined) out.category = input.category;
  if (input.startDate !== undefined) out.start_date = input.startDate;
  if (input.endDate !== undefined) out.end_date = input.endDate;
  if (input.active !== undefined) out.active = input.active;
  return out;
}

export function toProfileUpdate(input: ProfileUpdateInput): FinancialProfileUpdate {
  const out: FinancialProfileUpdate = {};
  if (input.displayName !== undefined) out.display_name = input.displayName;
  if (input.balanceSnapshotVnd !== undefined) out.balance_snapshot_vnd = vndForDb(input.balanceSnapshotVnd);
  if (input.balanceSnapshotAt !== undefined) out.balance_snapshot_at = input.balanceSnapshotAt.toISOString();
  if (input.expectedMonthlyIncomeVnd !== undefined) {
    out.expected_monthly_income_vnd = vndForDb(input.expectedMonthlyIncomeVnd);
  }
  if (input.paydayDay !== undefined) out.payday_day = input.paydayDay;
  if (input.expectedDailyExpenseVnd !== undefined) {
    out.expected_daily_expense_vnd = vndForDb(input.expectedDailyExpenseVnd);
  }
  if (input.projectedMonthlyBudgetVnd !== undefined) {
    out.projected_monthly_budget_vnd = vndForDb(input.projectedMonthlyBudgetVnd);
  }
  if (input.minimumReserveVnd !== undefined) out.minimum_reserve_vnd = vndForDb(input.minimumReserveVnd);
  return out;
}

export function toGoalUpsert(userId: string, input: z.output<typeof goalUpsertSchema>): SavingsGoalUpsert {
  return {
    user_id: userId,
    name: input.name,
    target_vnd: vndForDb(input.targetVnd),
    saved_vnd: vndForDb(input.savedVnd),
    target_date: input.targetDate ?? null,
  };
}

export function toImportBatchInsert(
  userId: string,
  input: {
    idempotencyKey: string;
    source: ImportBatchInsert["source"];
    filename?: string | null | undefined;
    status: NonNullable<ImportBatchInsert["status"]>;
    acceptedCount: number;
    rejectedCount: number;
  },
): ImportBatchInsert {
  return {
    user_id: userId,
    idempotency_key: input.idempotencyKey,
    source: input.source,
    filename: input.filename ?? null,
    status: input.status,
    accepted_count: input.acceptedCount,
    rejected_count: input.rejectedCount,
  };
}
