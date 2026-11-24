import type { OwnerContext } from "@/lib/auth/owner-context";
import type { AiRuntimeConfig } from "@/lib/ai/config";
import { createProvider, type AIProvider, type ReceiptMimeType } from "@/lib/ai/provider";
import type { ReceiptDraft } from "@/lib/ai/receipt";
import type { DbClient } from "@/lib/db/repositories/shared";
import { getAiUsage } from "@/lib/db/repositories/server-only/ai-data";
import { quotaLimitFor, withAiQuota } from "@/lib/db/repositories/server-only/quota";
import type { RpcClient } from "@/lib/db/repositories/server-only/rpc";
import { localDateOf } from "@/lib/finance";

export interface ReceiptDeps {
  readonly client: DbClient;
  readonly admin: RpcClient;
  readonly config: AiRuntimeConfig;
  readonly provider?: AIProvider;
}

export interface ScanQuotaDto {
  kind: "scan";
  limit: number;
  used: number;
  remaining: number;
}

export interface ReceiptExtractResponse {
  draft: ReceiptDraft;
  quota: ScanQuotaDto;
  /** Always true: the draft is not saved. The user edits and confirms it through the transactions API. */
  requiresConfirmation: true;
}

export async function readScanQuota(client: DbClient, owner: OwnerContext, now: Date): Promise<ScanQuotaDto> {
  const limit = quotaLimitFor("scan");
  const usage = await getAiUsage(client, owner, localDateOf(now));
  return { kind: "scan", limit, used: usage.scanCalls, remaining: Math.max(0, limit - usage.scanCalls) };
}

/**
 * One receipt scan for the verified owner: one 'scan' quota unit reserved before the vision
 * call (released on a definitive provider rejection, kept on an ambiguous timeout). The image
 * is passed in memory and never stored or logged. Nothing is written except the quota counter.
 */
export async function extractReceiptForOwner(
  deps: ReceiptDeps,
  owner: OwnerContext,
  image: Uint8Array,
  mimeType: ReceiptMimeType,
  now: Date,
): Promise<ReceiptExtractResponse> {
  const provider = deps.provider ?? createProvider(deps.config);
  const draft = await withAiQuota(owner, "scan", () => provider.extractReceipt({ image, mimeType, now }), { client: deps.admin });
  return { draft, quota: await readScanQuota(deps.client, owner, now), requiresConfirmation: true };
}
