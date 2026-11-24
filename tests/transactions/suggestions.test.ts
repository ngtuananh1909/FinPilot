import { describe, expect, it } from "vitest";
import type { FinanceTransaction, UnreconciledOccurrence } from "@/lib/finance";
import { suggestRecurringMatches } from "@/lib/transactions/suggestions";

const occ = (over: Partial<UnreconciledOccurrence> = {}): UnreconciledOccurrence => ({
  itemId: "item-1",
  date: "2026-11-05",
  kind: "expense",
  amountVnd: 1_500_000n,
  ...over,
});
// 05:00Z = 12:00 Vietnam, same calendar day.
const tx = (id: string, date: string, amountVnd: bigint, over: Partial<FinanceTransaction> = {}): FinanceTransaction =>
  ({ id, occurredAt: new Date(`${date}T05:00:00Z`), kind: "expense", amountVnd, category: "rent", ...over }) as FinanceTransaction;

describe("suggestRecurringMatches", () => {
  it("proposes close unlinked transactions, best first, and does not link anything", () => {
    const txs = [tx("far", "2026-11-09", 1_500_000n), tx("exact", "2026-11-05", 1_500_000n), tx("near", "2026-11-06", 1_450_000n)];
    const [s] = suggestRecurringMatches(txs, [occ()]);
    expect(s!.candidates.map((c) => c.transactionId)).toEqual(["exact", "near", "far"]);
    expect(s!.candidates[1]).toMatchObject({ dayDistance: 1, amountDifferenceVnd: 50_000n, transactionDate: "2026-11-06" });
    expect(txs.every((t) => !t.recurringItemId)).toBe(true);
  });

  it("returns the occurrence with no candidates when nothing is close (user decides)", () => {
    const [s] = suggestRecurringMatches([tx("a", "2026-11-20", 1_500_000n)], [occ()]);
    expect(s!.candidates).toEqual([]);
    expect(s!.itemId).toBe("item-1");
  });

  it("excludes wrong kind, excluded kind, already linked rows and out-of-tolerance amounts", () => {
    const txs = [
      tx("income", "2026-11-05", 1_500_000n, { kind: "income" }),
      tx("excl", "2026-11-05", 1_500_000n, { kind: "excluded" }),
      tx("linked", "2026-11-05", 1_500_000n, { recurringItemId: "other", recurringInstanceDate: "2026-10-05" }),
      tx("expensive", "2026-11-05", 2_000_000n),
    ];
    expect(suggestRecurringMatches(txs, [occ()])[0]!.candidates).toEqual([]);
  });

  it("respects day and amount options and maxCandidates", () => {
    const txs = [tx("a", "2026-11-07", 1_500_000n), tx("b", "2026-11-08", 1_500_000n)];
    expect(suggestRecurringMatches(txs, [occ()], { maxDayDistance: 2 })[0]!.candidates.map((c) => c.transactionId)).toEqual(["a"]);
    expect(suggestRecurringMatches(txs, [occ()], { maxCandidates: 1 })[0]!.candidates).toHaveLength(1);
    expect(suggestRecurringMatches([tx("c", "2026-11-05", 1_400_000n)], [occ()], { amountTolerancePercent: 5 })[0]!.candidates).toEqual([]);
  });

  it("breaks ties deterministically by id", () => {
    const txs = [tx("b", "2026-11-05", 1_500_000n), tx("a", "2026-11-05", 1_500_000n)];
    expect(suggestRecurringMatches(txs, [occ()])[0]!.candidates.map((c) => c.transactionId)).toEqual(["a", "b"]);
  });

  it("uses the Vietnam calendar date of the transaction", () => {
    // 2026-11-04T18:00Z = 2026-11-05 01:00 in Vietnam: distance 0 from Nov 5.
    const t = tx("late", "2026-11-04", 1_500_000n, { occurredAt: new Date("2026-11-04T18:00:00Z") });
    expect(suggestRecurringMatches([t], [occ()])[0]!.candidates[0]).toMatchObject({ dayDistance: 0, transactionDate: "2026-11-05" });
  });

  it("handles empty inputs", () => {
    expect(suggestRecurringMatches([], [])).toEqual([]);
  });
});
