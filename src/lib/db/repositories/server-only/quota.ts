import { assertOwnerContext, type OwnerContext } from "@/lib/auth/owner-context";
import { getServerEnv } from "@/lib/config/server-env";
import { ProviderPreResultError } from "@/lib/ai/errors";
import { createSupabaseAdminClient } from "../../admin";
import { DbError } from "../../errors";
import type { DbAiQuotaKind } from "../../schema";
import { assertServerRuntime } from "./guard";
import { callRpc, type RpcClient } from "./rpc";

/** Upper bound enforced by the proposed SQL (`p_limit > 100000` raises). */
export const MAX_QUOTA_LIMIT = 100_000;

const KIND_LABEL: Record<DbAiQuotaKind, string> = {
  chat: "trò chuyện với trợ lý AI",
  scan: "quét hóa đơn",
};

/**
 * Daily limits come from server env (GUEST_CHAT_DAILY_LIMIT / GUEST_SCAN_DAILY_LIMIT).
 * The "guest" budget applies to EVERY user, including the 3 email demo accounts.
 */
export function quotaLimitFor(kind: DbAiQuotaKind, env = getServerEnv()): number {
  const limit = kind === "chat" ? env.GUEST_CHAT_DAILY_LIMIT : env.GUEST_SCAN_DAILY_LIMIT;
  return Math.min(Math.max(0, Math.trunc(limit)), MAX_QUOTA_LIMIT);
}

export function quotaExceededError(kind: DbAiQuotaKind, limit: number): DbError {
  return new DbError("quota_exceeded", {
    userMessage: `Bạn đã dùng hết ${limit} lượt ${KIND_LABEL[kind]} hôm nay. Vui lòng thử lại vào ngày mai.`,
    safeDetails: { kind, limit, remaining: 0 },
  });
}

/** Reserves one unit. Returns false when the daily limit is reached (or the request id was already released). */
export async function reserveAiQuota(
  client: RpcClient,
  owner: OwnerContext,
  args: { requestId: string; kind: DbAiQuotaKind; limit: number },
): Promise<boolean> {
  assertServerRuntime();
  assertOwnerContext(owner);
  return callRpc(client, "reserve_ai_quota", {
    p_user_id: owner.userId,
    p_request_id: args.requestId,
    p_kind: args.kind,
    p_limit: args.limit,
  });
}

/** Idempotent: true only for the first call that flips a 'reserved' row to 'released'. */
export async function releaseAiQuota(client: RpcClient, owner: OwnerContext, requestId: string): Promise<boolean> {
  assertServerRuntime();
  assertOwnerContext(owner);
  return callRpc(client, "release_ai_quota", { p_user_id: owner.userId, p_request_id: requestId });
}

export async function commitAiQuota(client: RpcClient, owner: OwnerContext, requestId: string): Promise<boolean> {
  assertServerRuntime();
  assertOwnerContext(owner);
  return callRpc(client, "commit_ai_quota", { p_user_id: owner.userId, p_request_id: requestId });
}

export interface WithAiQuotaDeps {
  /** Defaults to the service-role admin client, created lazily after the guards pass. */
  client?: RpcClient;
  limitFor?: (kind: DbAiQuotaKind) => number;
  newRequestId?: () => string;
}

/**
 * Approved policy (tasks.md G1):
 *  1. reserve atomically BEFORE the provider call (exceeded -> `quota_exceeded`, run() never called);
 *  2. ProviderPreResultError (invalid config / definitive rejection) -> release once, rethrow;
 *  3. success -> commit (a commit failure is swallowed: the unit stays counted and the
 *     user's result is real; the reservation simply stays 'reserved');
 *  4. any other error, including ProviderAmbiguousError (timeout) -> keep the single
 *     reservation: no release, no retry.
 * Each call uses one fresh request id, so a request is never reserved twice.
 */
export async function withAiQuota<T>(
  owner: OwnerContext,
  kind: DbAiQuotaKind,
  run: (context: { requestId: string }) => Promise<T>,
  deps: WithAiQuotaDeps = {},
): Promise<T> {
  assertServerRuntime();
  assertOwnerContext(owner);
  const limit = (deps.limitFor ?? quotaLimitFor)(kind);
  if (!Number.isInteger(limit) || limit <= 0) throw quotaExceededError(kind, Math.max(0, limit || 0));
  const client = deps.client ?? createSupabaseAdminClient();
  const requestId = (deps.newRequestId ?? (() => crypto.randomUUID()))();

  const granted = await reserveAiQuota(client, owner, { requestId, kind, limit });
  if (!granted) throw quotaExceededError(kind, limit);

  let result: T;
  try {
    result = await run({ requestId });
  } catch (error) {
    if (error instanceof ProviderPreResultError) {
      try {
        await releaseAiQuota(client, owner, requestId);
      } catch {
        // Best effort: the provider error is the actionable one; the unit stays counted.
      }
    }
    throw error;
  }
  try {
    await commitAiQuota(client, owner, requestId);
  } catch {
    // See policy note 3.
  }
  return result;
}
