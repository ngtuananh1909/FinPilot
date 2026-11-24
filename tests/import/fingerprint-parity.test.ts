import { describe, expect, it } from "vitest";
import { importFingerprint } from "@/lib/import/fingerprint";
import { transactionFingerprint } from "@/lib/transactions/fingerprint";

// Manual entry and CSV import must hash identical inputs identically, or duplicate review
// would miss matches between the two sources.
describe("fingerprint parity (manual vs CSV)", () => {
  const cases = [
    { occurredAt: new Date("2026-11-20T05:30:00Z"), kind: "expense" as const, amountVnd: 45_000n, merchant: "Canteen" },
    { occurredAt: new Date("2026-11-20T17:00:00Z"), kind: "income" as const, amountVnd: 5_000_000n, merchant: "  Học Bổng " },
    { occurredAt: new Date("2026-02-28T23:59:59+07:00"), kind: "expense" as const, amountVnd: 1n, merchant: null },
  ];
  it.each(cases)("same hash for %#", (c) => {
    expect(importFingerprint(c)).toBe(transactionFingerprint(c));
  });
  it("day boundary follows Vietnam time (17:00Z is already the next local day)", () => {
    const a = { kind: "expense" as const, amountVnd: 10n, merchant: "x" };
    expect(transactionFingerprint({ ...a, occurredAt: new Date("2026-11-20T16:59:59Z") })).not.toBe(
      transactionFingerprint({ ...a, occurredAt: new Date("2026-11-20T17:00:00Z") }),
    );
  });
});
