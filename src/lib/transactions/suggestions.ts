import {
  diffDays,
  localDateOf,
  type FinanceTransaction,
  type LocalDate,
  type RecurringKind,
  type UnreconciledOccurrence,
} from "@/lib/finance";

export interface MatchCandidate {
  transactionId: string;
  /** Local date (Asia/Ho_Chi_Minh) of the candidate transaction. */
  transactionDate: LocalDate;
  /** Whole days between the candidate and the occurrence date (absolute). */
  dayDistance: number;
  /** |candidate amount - expected amount| in VND. */
  amountDifferenceVnd: bigint;
}

export interface RecurringSuggestion {
  itemId: string;
  instanceDate: LocalDate;
  kind: RecurringKind;
  expectedAmountVnd: bigint;
  /** Best first. May be empty: the occurrence is still unreconciled and the user decides. */
  candidates: MatchCandidate[];
}

export interface SuggestionOptions {
  /** Candidate must be within this many calendar days of the occurrence. Default 5. */
  maxDayDistance?: number;
  /** Candidate amount must be within this percentage of the expected amount. Default 10. */
  amountTolerancePercent?: number;
  /** Candidates returned per occurrence. Default 3. */
  maxCandidates?: number;
}

const DEFAULTS = { maxDayDistance: 5, amountTolerancePercent: 10, maxCandidates: 3 } as const;

/**
 * Proposes (never applies) matches between unreconciled recurring occurrences and existing
 * transactions the user has not linked yet. A candidate must be unlinked, have the same kind
 * as the occurrence, sit within `maxDayDistance` days of it and within the amount tolerance.
 * Ranking: smaller day distance, then smaller amount difference, then id (deterministic).
 * The caller must ask the user to confirm; nothing here writes or links.
 */
export function suggestRecurringMatches(
  transactions: readonly FinanceTransaction[],
  occurrences: readonly UnreconciledOccurrence[],
  options: SuggestionOptions = {},
): RecurringSuggestion[] {
  const maxDay = options.maxDayDistance ?? DEFAULTS.maxDayDistance;
  const tolerance = BigInt(Math.max(0, Math.trunc(options.amountTolerancePercent ?? DEFAULTS.amountTolerancePercent)));
  const maxCandidates = Math.max(0, Math.trunc(options.maxCandidates ?? DEFAULTS.maxCandidates));

  const pool = transactions
    .filter((tx) => !tx.recurringItemId && tx.kind !== "excluded")
    .map((tx) => ({ tx, date: localDateOf(tx.occurredAt) }));

  return occurrences.map((occ) => {
    const candidates: MatchCandidate[] = [];
    for (const { tx, date } of pool) {
      if (tx.kind !== occ.kind) continue;
      const dayDistance = Math.abs(diffDays(date, occ.date));
      if (dayDistance > maxDay) continue;
      const difference = tx.amountVnd > occ.amountVnd ? tx.amountVnd - occ.amountVnd : occ.amountVnd - tx.amountVnd;
      if (difference * 100n > occ.amountVnd * tolerance) continue;
      candidates.push({ transactionId: tx.id, transactionDate: date, dayDistance, amountDifferenceVnd: difference });
    }
    candidates.sort(
      (a, b) =>
        a.dayDistance - b.dayDistance ||
        (a.amountDifferenceVnd < b.amountDifferenceVnd ? -1 : a.amountDifferenceVnd > b.amountDifferenceVnd ? 1 : 0) ||
        (a.transactionId < b.transactionId ? -1 : a.transactionId > b.transactionId ? 1 : 0),
    );
    return {
      itemId: occ.itemId,
      instanceDate: occ.date,
      kind: occ.kind,
      expectedAmountVnd: occ.amountVnd,
      candidates: candidates.slice(0, maxCandidates),
    };
  });
}
