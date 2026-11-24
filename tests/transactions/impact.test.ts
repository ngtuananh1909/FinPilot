import { describe, expect, it } from "vitest";
import { balanceAt, type FinanceTransaction } from "@/lib/finance";
import { computeTransactionImpact } from "@/lib/transactions/impact";

const SNAPSHOT = new Date("2026-11-15T03:00:00Z");
const NOW = new Date("2026-11-24T05:00:00Z");
const profile = { balanceSnapshotVnd: 2_500_000n, balanceSnapshotAt: SNAPSHOT };

const tx = (over: Partial<FinanceTransaction> & { occurredAt: Date }): FinanceTransaction => ({
  id: "t-new",
  kind: "expense",
  amountVnd: 45_000n,
  category: "food",
  ...over,
}) as FinanceTransaction;

describe("computeTransactionImpact", () => {
  it("counts a row strictly after the snapshot and not after now", () => {
    const i = computeTransactionImpact({ occurredAt: new Date("2026-11-20T05:00:00Z"), kind: "expense", amountVnd: 45_000n }, SNAPSHOT, NOW);
    expect(i).toMatchObject({ affectsCurrentBalance: true, isFuture: false, isHistoricalOnly: false, reason: "counted_in_balance", balanceDeltaVnd: -45_000n });
  });

  it("signs income positive", () => {
    const i = computeTransactionImpact({ occurredAt: new Date("2026-11-20T05:00:00Z"), kind: "income", amountVnd: 1_000n }, SNAPSHOT, NOW);
    expect(i.balanceDeltaVnd).toBe(1_000n);
  });

  it("a row EQUAL to the snapshot instant is historical and not counted", () => {
    const i = computeTransactionImpact({ occurredAt: SNAPSHOT, kind: "expense", amountVnd: 45_000n }, SNAPSHOT, NOW);
    expect(i).toMatchObject({ affectsCurrentBalance: false, isHistoricalOnly: true, reason: "before_snapshot", balanceDeltaVnd: 0n });
  });

  it("one millisecond after the snapshot is counted; one millisecond before is not", () => {
    const after = computeTransactionImpact({ occurredAt: new Date(SNAPSHOT.getTime() + 1), kind: "expense", amountVnd: 1n }, SNAPSHOT, NOW);
    const before = computeTransactionImpact({ occurredAt: new Date(SNAPSHOT.getTime() - 1), kind: "expense", amountVnd: 1n }, SNAPSHOT, NOW);
    expect(after.affectsCurrentBalance).toBe(true);
    expect(before.affectsCurrentBalance).toBe(false);
  });

  it("a row equal to now is counted; after now is future and not counted", () => {
    expect(computeTransactionImpact({ occurredAt: NOW, kind: "expense", amountVnd: 1n }, SNAPSHOT, NOW).affectsCurrentBalance).toBe(true);
    const future = computeTransactionImpact({ occurredAt: new Date(NOW.getTime() + 1), kind: "expense", amountVnd: 1n }, SNAPSHOT, NOW);
    expect(future).toMatchObject({ affectsCurrentBalance: false, isFuture: true, isHistoricalOnly: false, reason: "future_dated", balanceDeltaVnd: 0n });
  });

  it("excluded kind has zero cash effect even inside the counted window", () => {
    const i = computeTransactionImpact({ occurredAt: new Date("2026-11-20T05:00:00Z"), kind: "excluded", amountVnd: 500_000n }, SNAPSHOT, NOW);
    expect(i).toMatchObject({ affectsCurrentBalance: false, reason: "excluded", balanceDeltaVnd: 0n });
  });

  describe("agrees with the finance engine (AC-04 / AC-05)", () => {
    const existing = [tx({ id: "t-old", occurredAt: new Date("2026-11-18T05:00:00Z"), amountVnd: 100_000n })];
    const before = balanceAt(profile, existing, NOW);

    const cases: Array<[string, Date, "income" | "expense" | "excluded"]> = [
      ["pre-snapshot expense", new Date("2026-11-10T05:00:00Z"), "expense"],
      ["pre-snapshot income", new Date("2026-11-01T05:00:00Z"), "income"],
      ["exactly at snapshot", SNAPSHOT, "expense"],
      ["post-snapshot expense", new Date("2026-11-20T05:00:00Z"), "expense"],
      ["post-snapshot income", new Date("2026-11-21T05:00:00Z"), "income"],
      ["future expense", new Date("2026-12-01T05:00:00Z"), "expense"],
      ["excluded in window", new Date("2026-11-20T05:00:00Z"), "excluded"],
    ];
    it.each(cases)("%s: balance delta equals impact.balanceDeltaVnd", (_name, at, kind) => {
      const added = tx({ id: "t-added", occurredAt: at, kind, amountVnd: 70_000n });
      const after = balanceAt(profile, [...existing, added], NOW);
      const impact = computeTransactionImpact(added, SNAPSHOT, NOW);
      expect(after - before).toBe(impact.balanceDeltaVnd);
      expect(impact.affectsCurrentBalance).toBe(after !== before);
    });

    it("saving a pre-snapshot transaction does not change the computed balance", () => {
      const added = tx({ id: "t-added", occurredAt: new Date("2026-11-10T05:00:00Z"), amountVnd: 9_999_999n });
      expect(balanceAt(profile, [...existing, added], NOW)).toBe(before);
      expect(computeTransactionImpact(added, SNAPSHOT, NOW).isHistoricalOnly).toBe(true);
    });
  });
});
