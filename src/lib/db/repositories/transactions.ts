import { addDays, type LocalDate } from "@/lib/finance";
import { DbError } from "../errors";
import type { OwnerContext } from "@/lib/auth/owner-context";
import { parseInput, transactionCreateSchema, transactionListSchema, transactionUpdateSchema } from "../inputs";
import { COLUMNS, mapTransactionRow, toTransactionInsert, toTransactionUpdate, type TransactionRecord } from "../mappers";
import { notFound, ownerIdOf, pageRange, rowId, throwIfError, toPage, type DbClient, type Page } from "./shared";

const TABLE = "transactions";
/** Asia/Ho_Chi_Minh has no DST: local midnight is always +07:00. */
const VN_MIDNIGHT = "T00:00:00+07:00";

/**
 * Lists the caller's transactions, newest first. Filters are validated; `search` is reduced
 * to an inert whitelist before it is placed into the PostgREST `or` expression.
 * `limit` defaults to 50 and is clamped to 200; `offset` is clamped to [0, 100000].
 */
export async function listTransactions(
  client: DbClient,
  owner: OwnerContext,
  query: unknown = {},
): Promise<Page<TransactionRecord>> {
  const userId = ownerIdOf(owner);
  const f = parseInput(transactionListSchema, query);
  let builder = client.from(TABLE).select(COLUMNS.transaction).eq("user_id", userId);
  if (f.kind) builder = builder.eq("kind", f.kind);
  if (f.category) builder = builder.eq("category", f.category);
  if (f.fromDate) builder = builder.gte("occurred_at", `${f.fromDate}${VN_MIDNIGHT}`);
  if (f.toDate) builder = builder.lt("occurred_at", `${addDays(f.toDate, 1)}${VN_MIDNIGHT}`);
  if (f.search) builder = builder.or(`merchant.ilike.%${f.search}%,description.ilike.%${f.search}%`);
  const [from, to] = pageRange(f.offset, f.limit);
  const { data, error } = await builder
    .order("occurred_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  throwIfError(error);
  return toPage((data ?? []).map(mapTransactionRow), f.limit, f.offset);
}

export async function getTransaction(client: DbClient, owner: OwnerContext, id: string): Promise<TransactionRecord> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS.transaction)
    .eq("id", targetId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw notFound(TABLE);
  return mapTransactionRow(data);
}

/**
 * Creates a transaction for the caller. `user_id` is set from the OwnerContext; an input
 * containing `user_id`/`userId` is rejected. The recurring link must be a pair.
 */
export async function createTransaction(
  client: DbClient,
  owner: OwnerContext,
  input: unknown,
): Promise<TransactionRecord> {
  const userId = ownerIdOf(owner);
  const payload = toTransactionInsert(userId, parseInput(transactionCreateSchema, input));
  const { data, error } = await client.from(TABLE).insert(payload).select(COLUMNS.transaction).single();
  throwIfError(error);
  return mapTransactionRow(data);
}

export async function updateTransaction(
  client: DbClient,
  owner: OwnerContext,
  id: string,
  input: unknown,
): Promise<TransactionRecord> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const payload = toTransactionUpdate(parseInput(transactionUpdateSchema, input));
  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq("id", targetId)
    .eq("user_id", userId)
    .select(COLUMNS.transaction)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw notFound(TABLE);
  return mapTransactionRow(data);
}

export async function deleteTransaction(client: DbClient, owner: OwnerContext, id: string): Promise<void> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const { data, error } = await client
    .from(TABLE)
    .delete()
    .eq("id", targetId)
    .eq("user_id", userId)
    .select("id");
  throwIfError(error);
  if (!data || data.length === 0) throw notFound(TABLE);
}

/**
 * True when at least one of the caller's transactions is posted against the recurring item.
 * Used to lock the item's `kind` once history references it.
 */
export async function hasLinkedTransactions(
  client: DbClient,
  owner: OwnerContext,
  recurringItemId: string,
): Promise<boolean> {
  const userId = ownerIdOf(owner);
  const itemId = rowId(recurringItemId);
  const { data, error } = await client
    .from(TABLE)
    .select("id")
    .eq("user_id", userId)
    .eq("recurring_item_id", itemId)
    .limit(1);
  throwIfError(error);
  return (data?.length ?? 0) > 0;
}

/** Rows written by a single bulk insert (CSV import). Matches the 5000-row CSV limit. */
export const BULK_INSERT_MAX = 5000;
const DUPLICATE_PAGE = 1000;

/**
 * Inserts all rows in ONE statement (PostgREST bulk insert), so the batch is all-or-nothing.
 * Every row goes through the same strict schema as `createTransaction`; `user_id` is taken from
 * the OwnerContext and any owner key in a row is rejected. Returns the number of rows stored.
 */
export async function createTransactionsBulk(
  client: DbClient,
  owner: OwnerContext,
  inputs: readonly unknown[],
): Promise<number> {
  const userId = ownerIdOf(owner);
  if (inputs.length === 0 || inputs.length > BULK_INSERT_MAX) {
    throw new DbError("invalid_input", { safeDetails: { field: "rows", rule: "bulk_size" } });
  }
  const payload = inputs.map((input) => toTransactionInsert(userId, parseInput(transactionCreateSchema, input)));
  const { data, error } = await client.from(TABLE).insert(payload).select("id");
  throwIfError(error);
  if (!data || data.length !== payload.length) throw new DbError("db_error");
  return data.length;
}

/**
 * The caller's transactions between two Asia/Ho_Chi_Minh dates (inclusive), oldest first, for
 * duplicate review. Reads in pages of 1000 (the PostgREST row cap) up to `cap` rows;
 * `truncated` is true when more rows existed than were read.
 */
export async function listTransactionsForDuplicateCheck(
  client: DbClient,
  owner: OwnerContext,
  range: { fromDate: LocalDate; toDate: LocalDate },
  cap = BULK_INSERT_MAX,
): Promise<{ items: TransactionRecord[]; truncated: boolean }> {
  const userId = ownerIdOf(owner);
  const items: TransactionRecord[] = [];
  let truncated = false;
  for (let offset = 0; ; offset += DUPLICATE_PAGE) {
    const { data, error } = await client
      .from(TABLE)
      .select(COLUMNS.transaction)
      .eq("user_id", userId)
      .gte("occurred_at", `${range.fromDate}${VN_MIDNIGHT}`)
      .lt("occurred_at", `${addDays(range.toDate, 1)}${VN_MIDNIGHT}`)
      .order("occurred_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + DUPLICATE_PAGE - 1);
    throwIfError(error);
    const page = (data ?? []).map(mapTransactionRow);
    items.push(...page);
    if (items.length >= cap) {
      truncated = page.length === DUPLICATE_PAGE;
      items.length = Math.min(items.length, cap);
      break;
    }
    if (page.length < DUPLICATE_PAGE) break;
  }
  return { items, truncated };
}
