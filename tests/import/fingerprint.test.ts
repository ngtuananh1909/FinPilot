import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { importFingerprint } from "@/lib/import/fingerprint";

const sha = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");

describe("importFingerprint", () => {
  it("is sha-256 hex of `${localDate}|${kind}|${amount}|${merchant.trim().toLowerCase()}`", () => {
    expect(
      importFingerprint({
        occurredAt: new Date("2026-11-01T12:30:00+07:00"),
        kind: "expense",
        amountVnd: 45000n,
        merchant: "  Canteen ",
      }),
    ).toBe(sha("2026-11-01|expense|45000|canteen"));
  });

  it("uses an empty merchant for null/blank", () => {
    const base = { occurredAt: new Date("2026-11-01T05:00:00Z"), kind: "income", amountVnd: 1n } as const;
    expect(importFingerprint({ ...base, merchant: null })).toBe(sha("2026-11-01|income|1|"));
    expect(importFingerprint({ ...base, merchant: undefined })).toBe(sha("2026-11-01|income|1|"));
    expect(importFingerprint({ ...base, merchant: "   " })).toBe(sha("2026-11-01|income|1|"));
  });

  it("buckets by the Asia/Ho_Chi_Minh calendar date, not UTC or the host zone", () => {
    const parts = { kind: "expense", amountVnd: 10n, merchant: "x" } as const;
    // 18:00Z on 1 Nov is 01:00 on 2 Nov in Vietnam.
    expect(importFingerprint({ ...parts, occurredAt: new Date("2026-11-01T18:00:00Z") })).toBe(
      sha("2026-11-02|expense|10|x"),
    );
    expect(importFingerprint({ ...parts, occurredAt: new Date("2026-11-01T16:59:59Z") })).toBe(
      sha("2026-11-01|expense|10|x"),
    );
  });

  it("differs by kind and amount", () => {
    const a = { occurredAt: new Date("2026-11-01T05:00:00Z"), merchant: "m" } as const;
    const set = new Set([
      importFingerprint({ ...a, kind: "expense", amountVnd: 5n }),
      importFingerprint({ ...a, kind: "income", amountVnd: 5n }),
      importFingerprint({ ...a, kind: "excluded", amountVnd: 5n }),
      importFingerprint({ ...a, kind: "expense", amountVnd: 6n }),
    ]);
    expect(set.size).toBe(4);
  });
});
