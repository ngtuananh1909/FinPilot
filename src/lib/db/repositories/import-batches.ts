import type { OwnerContext } from "@/lib/auth/owner-context";
import { importBatchCreateSchema, pageSchema, parseInput } from "../inputs";
import { COLUMNS, mapImportBatchRow, toImportBatchInsert, type ImportBatchRecord } from "../mappers";
import { mapDbError } from "../errors";
import { notFound, ownerIdOf, pageRange, rowId, throwIfError, toPage, type DbClient, type Page } from "./shared";

const TABLE = "import_batches";
const listSchema = pageSchema.extend({}).strict();

export async function listImportBatches(
  client: DbClient,
  owner: OwnerContext,
  query: unknown = {},
): Promise<Page<ImportBatchRecord>> {
  const userId = ownerIdOf(owner);
  const f = parseInput(listSchema, query);
  const [from, to] = pageRange(f.offset, f.limit);
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS.importBatch)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .range(from, to);
  throwIfError(error);
  return toPage((data ?? []).map(mapImportBatchRow), f.limit, f.offset);
}

export async function getImportBatch(client: DbClient, owner: OwnerContext, id: string): Promise<ImportBatchRecord> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS.importBatch)
    .eq("id", targetId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error);
  if (!data) throw notFound(TABLE);
  return mapImportBatchRow(data);
}

async function findByKey(client: DbClient, userId: string, key: string): Promise<ImportBatchRecord | null> {
  const { data, error } = await client
    .from(TABLE)
    .select(COLUMNS.importBatch)
    .eq("user_id", userId)
    .eq("idempotency_key", key)
    .maybeSingle();
  throwIfError(error);
  return data ? mapImportBatchRow(data) : null;
}

/**
 * Records an import batch (metadata only; committing transactions is a later task).
 * Idempotent per (owner, idempotencyKey): a repeat returns the existing record with
 * `created: false`.
 */
export async function createImportBatch(
  client: DbClient,
  owner: OwnerContext,
  input: unknown,
): Promise<{ batch: ImportBatchRecord; created: boolean }> {
  const userId = ownerIdOf(owner);
  const parsed = parseInput(importBatchCreateSchema, input);
  const existing = await findByKey(client, userId, parsed.idempotencyKey);
  if (existing) return { batch: existing, created: false };
  const { data, error } = await client
    .from(TABLE)
    .insert(toImportBatchInsert(userId, parsed))
    .select(COLUMNS.importBatch)
    .single();
  if (error) {
    const mapped = mapDbError(error);
    // Lost a race against a concurrent request with the same key: return the winner.
    if (mapped.reason === "db_conflict") {
      const winner = await findByKey(client, userId, parsed.idempotencyKey);
      if (winner) return { batch: winner, created: false };
    }
    throw mapped;
  }
  return { batch: mapImportBatchRow(data), created: true };
}

/** The caller's batch for an idempotency key, or null. */
export async function getImportBatchByKey(
  client: DbClient,
  owner: OwnerContext,
  idempotencyKey: string,
): Promise<ImportBatchRecord | null> {
  const key = parseInput(importBatchCreateSchema.shape.idempotencyKey, idempotencyKey);
  return findByKey(client, ownerIdOf(owner), key);
}

/**
 * Marks the caller's batch as failed with zero accepted rows (used when the transaction insert
 * did not happen). Owner-scoped; never touches transactions.
 */
export async function markImportBatchFailed(
  client: DbClient,
  owner: OwnerContext,
  id: string,
  rejectedCount: number,
): Promise<void> {
  const userId = ownerIdOf(owner);
  const targetId = rowId(id);
  const rejected = parseInput(importBatchCreateSchema.shape.rejectedCount, rejectedCount);
  const { error } = await client
    .from(TABLE)
    .update({ status: "failed", accepted_count: 0, rejected_count: rejected })
    .eq("id", targetId)
    .eq("user_id", userId);
  throwIfError(error);
}
