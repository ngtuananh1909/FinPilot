import { localDateOf, vndToString, type RecurringKind, type TransactionKind } from "@/lib/finance";
import type { Page } from "@/lib/db/repositories/shared";
import type { RecurringRecord, TransactionRecord } from "@/lib/db/mappers";
import { IMPACT_MESSAGES_VI, type ImpactReason, type TransactionImpact } from "./impact";
import type { MatchCandidate, RecurringSuggestion } from "./suggestions";

/**
 * Wire shapes. Rules: amounts are decimal strings (bigint is never serialised, JSON.stringify
 * would throw), instants are ISO-8601 UTC strings, calendar dates are YYYY-MM-DD, and `user_id`
 * and `fingerprint` are never exposed.
 */

export interface TransactionDto {
  id: string;
  occurredAt: string;
  /** Asia/Ho_Chi_Minh calendar date of `occurredAt`. */
  localDate: string;
  kind: TransactionKind;
  amountVnd: string;
  category: string;
  merchant: string | null;
  description: string | null;
  source: string;
  importBatchId: string | null;
  recurringItemId: string | null;
  recurringInstanceDate: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ImpactDto {
  affectsCurrentBalance: boolean;
  isFuture: boolean;
  isHistoricalOnly: boolean;
  reason: ImpactReason;
  balanceDeltaVnd: string;
  messageVi: string;
}

export interface RecurringDto {
  id: string;
  label: string;
  kind: RecurringKind;
  amountVnd: string;
  dayOfMonth: number;
  category: string;
  startDate: string;
  endDate: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface MatchCandidateDto {
  transactionId: string;
  transactionDate: string;
  dayDistance: number;
  amountDifferenceVnd: string;
}

export interface RecurringSuggestionDto {
  itemId: string;
  instanceDate: string;
  kind: RecurringKind;
  expectedAmountVnd: string;
  candidates: MatchCandidateDto[];
}

export interface PageDto<T> {
  items: T[];
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function transactionToDto(record: TransactionRecord): TransactionDto {
  return {
    id: record.id,
    occurredAt: record.occurredAt.toISOString(),
    localDate: localDateOf(record.occurredAt),
    kind: record.kind,
    amountVnd: vndToString(record.amountVnd),
    category: record.category,
    merchant: record.merchant,
    description: record.description,
    source: record.source,
    importBatchId: record.importBatchId,
    recurringItemId: record.recurringItemId ?? null,
    recurringInstanceDate: record.recurringInstanceDate ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export function impactToDto(impact: TransactionImpact): ImpactDto {
  return {
    affectsCurrentBalance: impact.affectsCurrentBalance,
    isFuture: impact.isFuture,
    isHistoricalOnly: impact.isHistoricalOnly,
    reason: impact.reason,
    balanceDeltaVnd: vndToString(impact.balanceDeltaVnd),
    messageVi: IMPACT_MESSAGES_VI[impact.reason],
  };
}

export function recurringToDto(record: RecurringRecord): RecurringDto {
  return {
    id: record.id,
    label: record.label,
    kind: record.kind,
    amountVnd: vndToString(record.amountVnd),
    dayOfMonth: record.dayOfMonth,
    category: record.category,
    startDate: record.startDate,
    endDate: record.endDate ?? null,
    active: record.active,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

const candidateToDto = (c: MatchCandidate): MatchCandidateDto => ({
  transactionId: c.transactionId,
  transactionDate: c.transactionDate,
  dayDistance: c.dayDistance,
  amountDifferenceVnd: vndToString(c.amountDifferenceVnd),
});

export function suggestionToDto(s: RecurringSuggestion): RecurringSuggestionDto {
  return {
    itemId: s.itemId,
    instanceDate: s.instanceDate,
    kind: s.kind,
    expectedAmountVnd: vndToString(s.expectedAmountVnd),
    candidates: s.candidates.map(candidateToDto),
  };
}

export function pageToDto<T, D>(page: Page<T>, map: (item: T) => D): PageDto<D> {
  return { items: page.items.map(map), limit: page.limit, offset: page.offset, hasMore: page.hasMore };
}
