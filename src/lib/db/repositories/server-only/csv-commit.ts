import { z } from "zod";
import { assertOwnerContext, type OwnerContext } from "@/lib/auth/owner-context";
import { categorySchema, instantSchema, parseInput, positiveVnd } from "../../inputs";
import { TRANSACTION_KINDS, type DbJson } from "../../schema";
import { assertServerRuntime } from "./guard";
import { callRpc, type RpcClient } from "./rpc";

/**
 * Wrapper for public.commit_csv_import (migration 0003, applied 2026-11-24 under G2). Used by
 * src/lib/import/service.ts through the CSV commit route.
 *
 * Deliberately NOT exported from ./index: only the CSV commit path should reach it.
 * Owner rule: the user id is `owner.userId` (verified session), never part of the input.
 */

export const MAX_CSV_COMMIT_ROWS = 5000;

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const csvCommitRowSchema = z
  .object({
    occurredAt: instantSchema,
    kind: z.enum(TRANSACTION_KINDS),
    amountVnd: positiveVnd,
    category: categorySchema.default("other"),
    merchant: optionalText(200),
    description: optionalText(500),
    fingerprint: z.string().trim().min(1).max(128).nullable().optional(),
  })
  .strict();

const csvCommitSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128),
    filename: z.string().trim().min(1).max(255).nullable().optional(),
    rows: z.array(csvCommitRowSchema).min(1).max(MAX_CSV_COMMIT_ROWS),
    rejectedCount: z.number().int().min(0).max(MAX_CSV_COMMIT_ROWS),
  })
  .strict();

export type CsvCommitRpcInput = z.input<typeof csvCommitSchema>;

export interface CsvCommitRpcResult {
  readonly replayed: boolean;
  readonly batchId: string;
  readonly acceptedCount: number;
  readonly rejectedCount: number;
  readonly status: "committed" | "failed";
}

/**
 * Commits all rows of a CSV import plus its batch record in ONE database transaction.
 * All-or-nothing; a repeated (owner, idempotencyKey) returns the stored batch with
 * `replayed: true` and inserts nothing. Amounts are sent as decimal strings (no JSON bigint).
 */
export async function commitCsvImportRpc(
  client: RpcClient,
  owner: OwnerContext,
  input: unknown,
): Promise<CsvCommitRpcResult> {
  assertServerRuntime();
  assertOwnerContext(owner);
  const f = parseInput(csvCommitSchema, input);
  const result = await callRpc(client, "commit_csv_import", {
    p_user_id: owner.userId,
    p_idempotency_key: f.idempotencyKey,
    p_filename: f.filename ?? null,
    p_rows: f.rows.map(
      (r): DbJson => ({
        occurred_at: r.occurredAt.toISOString(),
        kind: r.kind,
        amount_vnd: r.amountVnd.toString(),
        category: r.category,
        merchant: r.merchant ?? null,
        description: r.description ?? null,
        fingerprint: r.fingerprint ?? null,
      }),
    ),
    p_rejected_count: f.rejectedCount,
  });
  return {
    replayed: result.replayed,
    batchId: result.batch_id,
    acceptedCount: result.accepted_count,
    rejectedCount: result.rejected_count,
    status: result.status,
  };
}
