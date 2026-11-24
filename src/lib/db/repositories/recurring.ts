import type { OwnerContext } from "@/lib/auth/owner-context";
import { DbError } from "../errors";
import { pageSchema, parseInput, recurringCreateSchema, recurringUpdateSchema } from "../inputs";
import { COLUMNS, mapRecurringRow, toRecurringInsert, toRecurringUpdate, type RecurringRecord } from "../mappers";
import { notFound, ownerIdOf, pageRange, rowId, throwIfError, toPage, type DbClient, type Page } from "./shared";
import { z } from "zod";

const TABLE = "recurring_items";

const listSchema = pageSchema.extend({ activeOnly: z.boolean().optional() }).strict();

export async function listRecurringItems(
  client: DbClient,
  owner: OwnerContext,
  query: unknown = {},
): Promise<Page<RecurringRecord>> {
  const userId = ownerIdOf(owner);
  const f = parseInput(listSchema, query);
  let builder = client.from(TABLE).select(COLUMNS.recurring).eq("user_id", userId);
  if (f.activeOnly) builder = builder.eq("active", true);
  const [from, to] = pageRange(f.offset, f.limit);
  const { data, error } = await builder.order("created_at", { ascending: true }).order("id").range(from, to);
  throwIfError(error);
  return toPage((data ?? []).map(mapRecurringRow), f.limit, f.offset);
}

export async function getRecurringItem(client: DbClient, owner: OwnerContext, id: string): Promise<RecurringRecord> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS.recurring)
    .eq("id", targetId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw notFound(TABLE);
  return mapRecurringRow(data);
}

export async function createRecurringItem(
  client: DbClient,
  owner: OwnerContext,
  input: unknown,
): Promise<RecurringRecord> {
  const userId = ownerIdOf(owner);
  const payload = toRecurringInsert(userId, parseInput(recurringCreateSchema, input));
  const { data, error } = await client.from(TABLE).insert(payload).select(COLUMNS.recurring).single();
  throwIfError(error);
  return mapRecurringRow(data);
}

export async function updateRecurringItem(
  client: DbClient,
  owner: OwnerContext,
  id: string,
  input: unknown,
): Promise<RecurringRecord> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const payload = toRecurringUpdate(parseInput(recurringUpdateSchema, input));
  const { data, error } = await client
    .from(TABLE)
    .update(payload)
    .eq("id", targetId)
    .eq("user_id", userId)
    .select(COLUMNS.recurring)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw notFound(TABLE);
  return mapRecurringRow(data);
}

/** Soft deactivation (docs/14 F02): idempotent, keeps rows that transactions reference. */
export async function deactivateRecurringItem(
  client: DbClient,
  owner: OwnerContext,
  id: string,
): Promise<RecurringRecord> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const { data, error } = await client
    .from(TABLE)
    .update({ active: false })
    .eq("id", targetId)
    .eq("user_id", userId)
    .select(COLUMNS.recurring)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw notFound(TABLE);
  return mapRecurringRow(data);
}

/**
 * Deliberately unavailable. A recurring item that transactions reference must never be
 * deleted (FK is NO ACTION after the proposed migration). Use `deactivateRecurringItem`.
 * Issues NO database call.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- signature mirrors the other repositories
export async function deleteRecurringItem(_client: DbClient, _owner: OwnerContext, _id: string): Promise<never> {
  throw new DbError("recurring_delete_not_allowed");
}
