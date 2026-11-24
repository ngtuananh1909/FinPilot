import { createHash } from "node:crypto";
import { localDateOf, type TransactionKind } from "@/lib/finance";

export interface FingerprintParts {
  occurredAt: Date;
  kind: TransactionKind;
  amountVnd: bigint;
  merchant?: string | null | undefined;
}

/**
 * Merchant normalisation: `trim()` then `toLowerCase()`; null/undefined become "".
 * No Unicode normalisation and no whitespace collapsing, on purpose: the CSV import
 * (src/lib/import/fingerprint.ts) uses the identical formula and both must stay byte-identical.
 */
export function normalizeMerchantForFingerprint(merchant: string | null | undefined): string {
  return (merchant ?? "").trim().toLowerCase();
}

/**
 * Stable duplicate-detection key. Preimage (UTF-8):
 *   `${localDate}|${kind}|${amountVnd}|${merchant.trim().toLowerCase()}`
 * - localDate: Asia/Ho_Chi_Minh calendar date of occurred_at (YYYY-MM-DD)
 * - amountVnd: decimal integer, no separators
 * - merchant: empty string when null
 * Output: lowercase sha-256 hex (64 chars).
 *
 * It is stored, never unique and never used to delete anything: a match only makes the UI
 * ask the user.
 */
export function transactionFingerprint(parts: FingerprintParts): string {
  const preimage = `${localDateOf(parts.occurredAt)}|${parts.kind}|${parts.amountVnd.toString()}|${normalizeMerchantForFingerprint(parts.merchant)}`;
  return createHash("sha256").update(preimage, "utf8").digest("hex");
}
