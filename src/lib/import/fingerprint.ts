import { createHash } from "node:crypto";
import { localDateOf } from "@/lib/finance";
import type { ImportKind } from "./normalize";

export interface ImportFingerprintParts {
  readonly occurredAt: Date;
  readonly kind: ImportKind;
  readonly amountVnd: bigint;
  readonly merchant: string | null | undefined;
}

/**
 * Duplicate-detection key. Lower-case sha-256 hex of
 * `${localDate}|${kind}|${amountVnd}|${merchant.trim().toLowerCase()}` where `localDate` is the
 * Asia/Ho_Chi_Minh calendar date of `occurredAt` and a null merchant is the empty string.
 * Stored, never unique, never used to delete: a match only makes the user review the row.
 */
export function importFingerprint(parts: ImportFingerprintParts): string {
  const merchant = (parts.merchant ?? "").trim().toLowerCase();
  const preimage = `${localDateOf(parts.occurredAt)}|${parts.kind}|${parts.amountVnd.toString()}|${merchant}`;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}
