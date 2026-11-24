/**
 * Hand-written row types for the FinPilot schema.
 *
 * SOURCES: supabase/migrations/202611230001_finpilot_initial.sql (applied-candidate base)
 * and supabase/proposed/202611230002_finpilot_hardening.sql (PROPOSED, NOT APPLIED).
 *
 * UNVERIFIED: these types were written from the SQL text only. They have NOT been compared
 * with the live database (no remote access in T01.4). Re-verify against the real schema at
 * G2 (e.g. `supabase gen types` against the approved target, then diff). Objects marked
 * "proposed" do not exist until the hardening migration is applied.
 *
 * Wire formats (what supabase-js returns/accepts over JSON):
 *  - bigint   -> `DbBigint` (number or decimal string). Parse with `parseDbVnd`, write with `vndForDb`.
 *  - timestamptz -> ISO-8601 string with offset.
 *  - date     -> 'YYYY-MM-DD' string.
 *  - jsonb    -> `DbJson`.
 */

export type DbBigint = number | string;
export type DbUuid = string;
export type DbTimestamptz = string;
export type DbDate = string;
export type DbJson = string | number | boolean | null | { [key: string]: DbJson } | DbJson[];

export const PERSONA_CODES = ["student", "worker", "at_risk"] as const;
export type PersonaCode = (typeof PERSONA_CODES)[number];
export const TRANSACTION_KINDS = ["income", "expense", "excluded"] as const;
export type DbTransactionKind = (typeof TRANSACTION_KINDS)[number];
export const RECURRING_KINDS = ["income", "expense"] as const;
export type DbRecurringKind = (typeof RECURRING_KINDS)[number];
/** 'seed' is written only by the server-side persona clone; clients may not set it. */
export const TRANSACTION_SOURCES = ["manual", "csv", "receipt", "seed"] as const;
export type DbTransactionSource = (typeof TRANSACTION_SOURCES)[number];
export const IMPORT_SOURCES = ["csv", "receipt"] as const;
export type DbImportSource = (typeof IMPORT_SOURCES)[number];
export const IMPORT_STATUSES = ["committed", "failed"] as const;
export type DbImportStatus = (typeof IMPORT_STATUSES)[number];
export const AI_MESSAGE_ROLES = ["user", "assistant", "tool"] as const;
export type DbAiMessageRole = (typeof AI_MESSAGE_ROLES)[number];
export const AI_PROPOSAL_KINDS = ["budget_update", "goal_update"] as const;
export type DbAiProposalKind = (typeof AI_PROPOSAL_KINDS)[number];
export const AI_PROPOSAL_STATUSES = ["pending", "approved", "rejected", "expired"] as const;
export type DbAiProposalStatus = (typeof AI_PROPOSAL_STATUSES)[number];
export const AI_QUOTA_KINDS = ["chat", "scan"] as const;
export type DbAiQuotaKind = (typeof AI_QUOTA_KINDS)[number];

// ---------------------------------------------------------------------------
// Client-writable tables (RLS owner policies for select/insert/update/delete)
// ---------------------------------------------------------------------------

export interface FinancialProfileRow {
  user_id: DbUuid;
  persona_code: PersonaCode | null;
  display_name: string;
  balance_snapshot_vnd: DbBigint;
  balance_snapshot_at: DbTimestamptz;
  expected_monthly_income_vnd: DbBigint;
  payday_day: number | null;
  expected_daily_expense_vnd: DbBigint;
  projected_monthly_budget_vnd: DbBigint;
  minimum_reserve_vnd: DbBigint;
  is_demo: boolean;
  created_at: DbTimestamptz;
  updated_at: DbTimestamptz;
}
/** Money columns are written as decimal strings (see `vndForDb`). persona_code/is_demo are server-set. */
export interface FinancialProfileUpdate {
  display_name?: string;
  balance_snapshot_vnd?: string;
  balance_snapshot_at?: DbTimestamptz;
  expected_monthly_income_vnd?: string;
  payday_day?: number | null;
  expected_daily_expense_vnd?: string;
  projected_monthly_budget_vnd?: string;
  minimum_reserve_vnd?: string;
}

export interface ImportBatchRow {
  id: DbUuid;
  user_id: DbUuid;
  idempotency_key: string;
  source: DbImportSource;
  filename: string | null;
  status: DbImportStatus;
  accepted_count: number;
  rejected_count: number;
  created_at: DbTimestamptz;
}
export interface ImportBatchInsert {
  user_id: DbUuid;
  idempotency_key: string;
  source: DbImportSource;
  filename?: string | null;
  status?: DbImportStatus;
  accepted_count?: number;
  rejected_count?: number;
}

export interface RecurringItemRow {
  id: DbUuid;
  user_id: DbUuid;
  label: string;
  kind: DbRecurringKind;
  amount_vnd: DbBigint;
  day_of_month: number;
  category: string;
  start_date: DbDate;
  end_date: DbDate | null;
  active: boolean;
  created_at: DbTimestamptz;
  updated_at: DbTimestamptz;
}
export interface RecurringItemInsert {
  user_id: DbUuid;
  label: string;
  kind: DbRecurringKind;
  amount_vnd: string;
  day_of_month: number;
  category?: string;
  start_date: DbDate;
  end_date?: DbDate | null;
  active?: boolean;
}
export type RecurringItemUpdate = Partial<Omit<RecurringItemInsert, "user_id">>;

export interface TransactionRow {
  id: DbUuid;
  user_id: DbUuid;
  occurred_at: DbTimestamptz;
  kind: DbTransactionKind;
  amount_vnd: DbBigint;
  category: string;
  merchant: string | null;
  description: string | null;
  source: DbTransactionSource;
  fingerprint: string | null;
  import_batch_id: DbUuid | null;
  recurring_item_id: DbUuid | null;
  recurring_instance_date: DbDate | null;
  created_at: DbTimestamptz;
  updated_at: DbTimestamptz;
}
export interface TransactionInsert {
  user_id: DbUuid;
  occurred_at: DbTimestamptz;
  kind: DbTransactionKind;
  amount_vnd: string;
  category?: string;
  merchant?: string | null;
  description?: string | null;
  source?: DbTransactionSource;
  fingerprint?: string | null;
  import_batch_id?: DbUuid | null;
  /** DB check: recurring_item_id and recurring_instance_date are both null or both set. */
  recurring_item_id?: DbUuid | null;
  recurring_instance_date?: DbDate | null;
}
export type TransactionUpdate = Partial<
  Pick<
    TransactionInsert,
    | "occurred_at"
    | "kind"
    | "amount_vnd"
    | "category"
    | "merchant"
    | "description"
    | "fingerprint"
    | "recurring_item_id"
    | "recurring_instance_date"
  >
>;

export interface SavingsGoalRow {
  user_id: DbUuid;
  name: string;
  target_vnd: DbBigint;
  saved_vnd: DbBigint;
  target_date: DbDate | null;
  created_at: DbTimestamptz;
  updated_at: DbTimestamptz;
}
/** `user_id` is the primary key: at most one goal per user. */
export interface SavingsGoalUpsert {
  user_id: DbUuid;
  name: string;
  target_vnd: string;
  saved_vnd: string;
  target_date: DbDate | null;
}

// ---------------------------------------------------------------------------
// Server-written tables (clients have SELECT only; writes go through the service role)
// ---------------------------------------------------------------------------

export interface AiConversationRow {
  id: DbUuid;
  user_id: DbUuid;
  title: string;
  created_at: DbTimestamptz;
  updated_at: DbTimestamptz;
}
export interface AiMessageRow {
  id: DbUuid;
  user_id: DbUuid;
  conversation_id: DbUuid;
  role: DbAiMessageRole;
  content: string;
  tool_result: DbJson | null;
  created_at: DbTimestamptz;
}
export interface AiProposalRow {
  id: DbUuid;
  user_id: DbUuid;
  conversation_id: DbUuid | null;
  kind: DbAiProposalKind;
  payload: DbJson;
  baseline: DbJson;
  status: DbAiProposalStatus;
  expires_at: DbTimestamptz;
  resolved_at: DbTimestamptz | null;
  created_at: DbTimestamptz;
}
export interface AiProposalInsert {
  user_id: DbUuid;
  conversation_id?: DbUuid | null;
  kind: DbAiProposalKind;
  payload: DbJson;
  baseline?: DbJson;
  /** Always 'pending' on insert; approval is a separate, explicitly confirmed step. */
  status?: "pending";
  expires_at: DbTimestamptz;
}
export interface AiUsageDailyRow {
  user_id: DbUuid;
  /** Asia/Ho_Chi_Minh calendar date. */
  usage_date: DbDate;
  chat_calls: number;
  scan_calls: number;
}

// ---------------------------------------------------------------------------
// PROPOSED (hardening migration, not applied). Server-only; no client policies except
// SELECT on ai_quota_reservations.
// ---------------------------------------------------------------------------

export const QUOTA_RESERVATION_STATUSES = ["reserved", "released", "committed"] as const;
export type DbQuotaReservationStatus = (typeof QUOTA_RESERVATION_STATUSES)[number];
export interface AiQuotaReservationRow {
  request_id: DbUuid;
  user_id: DbUuid;
  usage_date: DbDate;
  kind: DbAiQuotaKind;
  status: DbQuotaReservationStatus;
  created_at: DbTimestamptz;
}
export interface ResetLogRow {
  user_id: DbUuid;
  idempotency_key: string;
  created_at: DbTimestamptz;
}

/** Argument/return contracts of the proposed service-role RPCs. */
export interface ProposedRpcContracts {
  reserve_ai_quota: {
    args: { p_user_id: DbUuid; p_request_id: DbUuid; p_kind: DbAiQuotaKind; p_limit: number };
    returns: boolean;
  };
  release_ai_quota: { args: { p_user_id: DbUuid; p_request_id: DbUuid }; returns: boolean };
  commit_ai_quota: { args: { p_user_id: DbUuid; p_request_id: DbUuid }; returns: boolean };
  bootstrap_profile: {
    args: { p_user_id: DbUuid; p_persona_code?: PersonaCode | null; p_display_name?: string | null };
    returns: boolean;
  };
  reset_user_to_persona: {
    args: { p_user_id: DbUuid; p_template: DbJson; p_idempotency_key: string };
    returns: { applied: boolean; replay?: boolean; [key: string]: DbJson | undefined };
  };
  /**
   * PROPOSED in supabase/proposed/202611230003_finpilot_profile_protection_and_csv_commit.sql
   * (migration 0003, not applied). `p_rows` elements use ONLY the keys occurred_at, kind,
   * amount_vnd (decimal string), category, merchant, description, fingerprint.
   */
  commit_csv_import: {
    args: {
      p_user_id: DbUuid;
      p_idempotency_key: string;
      p_filename: string | null;
      p_rows: DbJson;
      p_rejected_count: number;
    };
    returns: {
      replayed: boolean;
      batch_id: DbUuid;
      accepted_count: number;
      rejected_count: number;
      status: "committed" | "failed";
    };
  };
}
export type ProposedRpcName = keyof ProposedRpcContracts;
