import { z } from "zod";
import { DbError } from "../../errors";
import type { DbJson } from "../../schema";
import { assertServerRuntime } from "./guard";
import { callRpc, type RpcClient } from "./rpc";

/**
 * SCRIPT-ONLY. Never import this file from app code, route handlers or other library code.
 *
 * It is the one place that calls `reset_user_to_persona` for a RAW user id instead of a verified
 * OwnerContext, because the demo-account seed script (src/lib/demo/seed-cli.ts) runs outside a
 * request and has no session. It is deliberately NOT re-exported from ./index.ts.
 * tests/demo/seed-import-restriction.test.ts fails if anything else imports it.
 */

const MAX_TEMPLATE_BYTES = 1_000_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const inputSchema = z
  .object({
    template: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

export async function resetPersonaForSeededUser(
  client: RpcClient,
  userId: string,
  input: unknown,
): Promise<{ applied: boolean; replay: boolean }> {
  assertServerRuntime();
  if (typeof userId !== "string" || !UUID.test(userId)) throw new DbError("invalid_input", { safeDetails: { field: "userId" } });
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new DbError("invalid_input", { safeDetails: { field: "input" } });
  const f = parsed.data;
  let size: number;
  try {
    size = JSON.stringify(f.template).length;
  } catch {
    throw new DbError("invalid_input", { safeDetails: { field: "template" } });
  }
  if (size > MAX_TEMPLATE_BYTES) throw new DbError("invalid_input", { safeDetails: { field: "template" } });
  const result = await callRpc(client, "reset_user_to_persona", {
    p_user_id: userId.toLowerCase(),
    // JSON-serialisable by construction (checked above); the SQL validates the template again.
    p_template: f.template as DbJson,
    p_idempotency_key: f.idempotencyKey,
  });
  return { applied: result.applied, replay: result.replay === true };
}
