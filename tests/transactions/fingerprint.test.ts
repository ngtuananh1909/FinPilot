import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { normalizeMerchantForFingerprint, transactionFingerprint } from "@/lib/transactions/fingerprint";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("transactionFingerprint", () => {
  const base = { occurredAt: new Date("2026-11-20T05:30:00Z"), kind: "expense" as const, amountVnd: 45000n, merchant: "Canteen" };

  it("hashes exactly `${localDate}|${kind}|${amountVnd}|${merchant.trim().toLowerCase()}` (shared with CSV import)", () => {
    expect(transactionFingerprint(base)).toBe(sha("2026-11-20|expense|45000|canteen"));
    expect(transactionFingerprint({ ...base, merchant: "  CanTeen \t" })).toBe(sha("2026-11-20|expense|45000|canteen"));
  });

  it("is stable: golden value and repeat calls", () => {
    expect(transactionFingerprint(base)).toBe(transactionFingerprint({ ...base }));
    expect(transactionFingerprint(base)).toMatch(/^[0-9a-f]{64}$/);
    expect(transactionFingerprint(base)).toBe(sha("2026-11-20|expense|45000|canteen"));
  });

  it("uses the Asia/Ho_Chi_Minh calendar date, not the UTC date", () => {
    // 2026-11-20T18:30Z is 2026-11-21 01:30 in Vietnam.
    const late = transactionFingerprint({ ...base, occurredAt: new Date("2026-11-20T18:30:00Z") });
    expect(late).toBe(sha("2026-11-21|expense|45000|canteen"));
    // Same local day, different time of day: identical.
    expect(transactionFingerprint({ ...base, occurredAt: new Date("2026-11-20T00:05:00+07:00") })).toBe(
      transactionFingerprint({ ...base, occurredAt: new Date("2026-11-20T23:55:00+07:00") }),
    );
  });

  it("uses the empty string for a missing merchant", () => {
    const expected = sha("2026-11-20|expense|45000|");
    expect(transactionFingerprint({ ...base, merchant: null })).toBe(expected);
    expect(transactionFingerprint({ ...base, merchant: undefined })).toBe(expected);
    expect(transactionFingerprint({ ...base, merchant: "   " })).toBe(expected);
  });

  it("changes when kind, amount or merchant changes", () => {
    const f = transactionFingerprint(base);
    expect(transactionFingerprint({ ...base, kind: "income" })).not.toBe(f);
    expect(transactionFingerprint({ ...base, amountVnd: 45001n })).not.toBe(f);
    expect(transactionFingerprint({ ...base, merchant: "Other" })).not.toBe(f);
  });

  it("normalises with trim + lowercase only", () => {
    expect(normalizeMerchantForFingerprint("  GRAB  Food ")).toBe("grab  food");
    expect(normalizeMerchantForFingerprint(null)).toBe("");
  });
});
