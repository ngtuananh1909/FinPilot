import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { balanceAt, FinanceError, signedAmount } from "@/lib/finance";
import { profile, tx, vn } from "./helpers";

const NOW = vn("2026-11-23T10:00:00");

describe("balance at time T", () => {
  it("ignores transactions before the snapshot (3,000,000 stays 3,000,000)", () => {
    const history = [tx("expense", 100_000n, "2026-11-22T12:00:00")];
    expect(balanceAt(profile(), history, NOW)).toBe(3_000_000n);
  });

  it("applies an expense after the snapshot exactly once (2,800,000)", () => {
    const history = [tx("expense", 200_000n, "2026-11-23T09:30:00")];
    expect(balanceAt(profile(), history, NOW)).toBe(2_800_000n);
  });

  it("excludes a transaction at exactly the snapshot instant", () => {
    const history = [tx("expense", 200_000n, "2026-11-23T09:00:00")];
    expect(balanceAt(profile(), history, NOW)).toBe(3_000_000n);
  });

  it("includes a transaction at exactly T", () => {
    const history = [tx("income", 500_000n, "2026-11-23T10:00:00")];
    expect(balanceAt(profile(), history, NOW)).toBe(3_500_000n);
  });

  it("excludes future-dated transactions from today's balance", () => {
    const history = [tx("expense", 400_000n, "2026-11-24T08:00:00"), tx("expense", 1n, "2026-11-23T10:00:01")];
    expect(balanceAt(profile(), history, NOW)).toBe(3_000_000n);
  });

  it("treats excluded transactions as zero cash effect", () => {
    const history = [tx("excluded", 900_000n, "2026-11-23T09:30:00")];
    expect(signedAmount(history[0]!)).toBe(0n);
    expect(balanceAt(profile(), history, NOW)).toBe(3_000_000n);
  });

  it("supports a negative snapshot (overdraft)", () => {
    expect(balanceAt(profile({ balanceSnapshotVnd: -100_000n }), [], NOW)).toBe(-100_000n);
  });

  it("rejects duplicate ids, bad amounts, and snapshot after T", () => {
    const a = tx("expense", 1n, "2026-11-23T09:30:00");
    expect(() => balanceAt(profile(), [a, { ...a }], NOW)).toThrow(FinanceError);
    expect(() => balanceAt(profile(), [{ ...a, id: "z", amountVnd: 0n }], NOW)).toThrow(FinanceError);
    expect(() => balanceAt(profile(), [{ ...a, id: "y", amountVnd: -5n }], NOW)).toThrow(FinanceError);
    expect(() => balanceAt(profile(), [], vn("2026-11-23T08:00:00"))).toThrow(FinanceError);
  });

  it("rejects half-set recurring links", () => {
    const bad = tx("expense", 5n, "2026-11-23T09:30:00", { recurringItemId: "r1", recurringInstanceDate: null });
    expect(() => balanceAt(profile(), [bad], NOW)).toThrow(FinanceError);
  });

  it("property: pre-snapshot rows never change the balance; post-snapshot rows sum exactly", () => {
    const kinds = fc.constantFrom<"income" | "expense" | "excluded">("income", "expense", "excluded");
    fc.assert(
      fc.property(
        fc.array(fc.tuple(kinds, fc.integer({ min: 1, max: 5_000_000 }), fc.integer({ min: -40, max: 40 })), {
          maxLength: 30,
        }),
        (rows) => {
          const snapshotMs = profile().balanceSnapshotAt.getTime();
          let expected = 3_000_000n;
          const txs = rows.map(([kind, amount, minutesFromSnapshot], index) => {
            const offsetMinutes = minutesFromSnapshot === 0 ? -1 : minutesFromSnapshot;
            const occurredAt = new Date(snapshotMs + offsetMinutes * 60_000);
            const transaction = { id: `p-${index}`, kind, amountVnd: BigInt(amount), occurredAt };
            if (offsetMinutes > 0 && occurredAt.getTime() <= NOW.getTime()) expected += signedAmount(transaction);
            return transaction;
          });
          expect(balanceAt(profile(), txs, NOW)).toBe(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
