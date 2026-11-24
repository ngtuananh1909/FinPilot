import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DbError, isMissingFunctionError, mapDbError } from "../../errors";
import type { ProposedRpcContracts, ProposedRpcName } from "../../schema";
import { assertServerRuntime } from "./guard";

export type RpcClient = Pick<SupabaseClient, "rpc">;

const RESULT_SCHEMAS = {
  reserve_ai_quota: z.boolean(),
  release_ai_quota: z.boolean(),
  commit_ai_quota: z.boolean(),
  bootstrap_profile: z.boolean(),
  reset_user_to_persona: z.looseObject({ applied: z.boolean(), replay: z.boolean().optional() }),
  commit_csv_import: z.looseObject({
    replayed: z.boolean(),
    batch_id: z.uuid(),
    accepted_count: z.number().int().min(0),
    rejected_count: z.number().int().min(0),
    status: z.enum(["committed", "failed"]),
  }),
} as const satisfies Record<ProposedRpcName, z.ZodType>;

/**
 * Calls one of the PROPOSED service-role RPCs. They do not exist until the hardening
 * migration is applied (G2). A missing function surfaces as DbError("rpc_unavailable");
 * nothing is simulated or defaulted to success.
 */
export async function callRpc<N extends ProposedRpcName>(
  client: RpcClient,
  name: N,
  args: ProposedRpcContracts[N]["args"],
): Promise<ProposedRpcContracts[N]["returns"]> {
  assertServerRuntime();
  const { data, error } = await client.rpc(name, args);
  if (error) {
    if (isMissingFunctionError(error)) {
      throw new DbError("rpc_unavailable", { safeDetails: { rpc: name }, cause: new Error(`rpc_missing:${name}`) });
    }
    throw mapDbError(error);
  }
  const parsed = RESULT_SCHEMAS[name].safeParse(data);
  if (!parsed.success) throw new DbError("db_row_invalid", { safeDetails: { rpc: name, rule: "shape" } });
  return parsed.data as ProposedRpcContracts[N]["returns"];
}
