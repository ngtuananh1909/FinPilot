import { z } from "zod";
import { assertOwnerContext, type OwnerContext } from "@/lib/auth/owner-context";
import { DbError } from "../../errors";
import { parseInput } from "../../inputs";
import { PERSONA_CODES, type DbJson } from "../../schema";
import { assertServerRuntime } from "./guard";
import { callRpc, type RpcClient } from "./rpc";

const bootstrapSchema = z
  .object({
    personaCode: z.enum(PERSONA_CODES).nullable().optional(),
    displayName: z.string().trim().min(1).max(80).nullable().optional(),
  })
  .strict();

/** Creates the caller's default profile if missing. Returns true only if it created one. */
export async function bootstrapProfile(client: RpcClient, owner: OwnerContext, input: unknown = {}): Promise<boolean> {
  assertServerRuntime();
  assertOwnerContext(owner);
  const f = parseInput(bootstrapSchema, input);
  return callRpc(client, "bootstrap_profile", {
    p_user_id: owner.userId,
    p_persona_code: f.personaCode ?? null,
    p_display_name: f.displayName ?? null,
  });
}

const MAX_TEMPLATE_BYTES = 1_000_000;
const resetSchema = z
  .object({
    template: z.record(z.string(), z.unknown()),
    idempotencyKey: z.string().trim().min(1).max(128),
  })
  .strict();

/**
 * Resets the CALLER's data to a persona template (one transaction in SQL, owner-scoped).
 * Template amounts must be decimal strings (JSON has no bigint). The SQL validates the
 * template again; this wrapper only bounds its size and shape.
 */
export async function resetUserToPersona(
  client: RpcClient,
  owner: OwnerContext,
  input: unknown,
): Promise<{ applied: boolean; replay: boolean }> {
  assertServerRuntime();
  assertOwnerContext(owner);
  const f = parseInput(resetSchema, input);
  let size: number;
  try {
    size = JSON.stringify(f.template).length;
  } catch {
    throw new DbError("invalid_input", { safeDetails: { field: "template" } });
  }
  if (size > MAX_TEMPLATE_BYTES) throw new DbError("invalid_input", { safeDetails: { field: "template" } });
  const result = await callRpc(client, "reset_user_to_persona", {
    p_user_id: owner.userId,
    p_template: f.template as DbJson,
    p_idempotency_key: f.idempotencyKey,
  });
  return { applied: result.applied, replay: result.replay === true };
}
