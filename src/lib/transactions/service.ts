import type { OwnerContext } from "@/lib/auth/owner-context";
import { forecastCashflow, FinanceError } from "@/lib/finance";
import { DbError } from "@/lib/db/errors";
import { parseInput, recurringUpdateSchema } from "@/lib/db/inputs";
import type { RecurringRecord, TransactionRecord } from "@/lib/db/mappers";
import { loadFinanceInputs } from "@/lib/db/repositories/load-inputs";
import { requireProfile } from "@/lib/db/repositories/profile";
import {
  createRecurringItem,
  getRecurringItem,
  listRecurringItems,
  updateRecurringItem,
} from "@/lib/db/repositories/recurring";
import type { DbClient, Page } from "@/lib/db/repositories/shared";
import {
  createTransaction,
  deleteTransaction,
  getTransaction,
  hasLinkedTransactions,
  listTransactions,
  updateTransaction,
} from "@/lib/db/repositories/transactions";
import {
  impactToDto,
  pageToDto,
  recurringToDto,
  suggestionToDto,
  transactionToDto,
  type ImpactDto,
  type PageDto,
  type RecurringDto,
  type RecurringSuggestionDto,
  type TransactionDto,
} from "./dto";
import { transactionFingerprint } from "./fingerprint";
import { computeTransactionImpact } from "./impact";
import { validateRecurringLink } from "./recurring-link";
import { transactionCreateBodySchema, transactionPatchBodySchema } from "./schemas";
import { suggestRecurringMatches } from "./suggestions";

/**
 * Orchestration for the transactions/recurring routes. Every function receives the user-scoped
 * client and a verified OwnerContext; `now` is injected so tests control the clock.
 */

export interface TransactionWriteResult {
  transaction: TransactionDto;
  impact: ImpactDto;
}

const asObject = (body: unknown): Record<string, unknown> => body as Record<string, unknown>;

/** A duplicate recurring posting is a typed 409 (`db_conflict`) with a specific message. */
async function withPostingConflict<T>(linked: boolean, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (linked && error instanceof DbError && error.reason === "db_conflict") {
      throw new DbError("db_conflict", {
        userMessage: "Khoản định kỳ này đã được ghi nhận cho ngày đó. Hãy sửa giao dịch đã có thay vì tạo mới.",
        safeDetails: { constraint: "recurring_posting" },
        cause: error,
      });
    }
    throw error;
  }
}

export async function listTransactionsForOwner(
  client: DbClient,
  owner: OwnerContext,
  query: unknown,
): Promise<PageDto<TransactionDto>> {
  const page: Page<TransactionRecord> = await listTransactions(client, owner, query);
  return pageToDto(page, transactionToDto);
}

export async function createTransactionForOwner(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
  now: Date,
): Promise<TransactionWriteResult> {
  const parsed = parseInput(transactionCreateBodySchema, body);
  const profile = await requireProfile(client, owner);
  const linkItemId = parsed.recurringItemId ?? null;
  const linkDate = parsed.recurringInstanceDate ?? null;
  await validateRecurringLink(client, owner, {
    kind: parsed.kind,
    recurringItemId: linkItemId,
    recurringInstanceDate: linkDate,
  });
  const fingerprint = transactionFingerprint({
    occurredAt: parsed.occurredAt,
    kind: parsed.kind,
    amountVnd: parsed.amountVnd,
    merchant: parsed.merchant,
  });
  const record = await withPostingConflict(linkItemId !== null, () =>
    createTransaction(client, owner, { ...asObject(body), fingerprint }),
  );
  return {
    transaction: transactionToDto(record),
    impact: impactToDto(computeTransactionImpact(record, profile.balanceSnapshotAt, now)),
  };
}

export async function updateTransactionForOwner(
  client: DbClient,
  owner: OwnerContext,
  id: string,
  body: unknown,
  now: Date,
): Promise<TransactionWriteResult> {
  const parsed = parseInput(transactionPatchBodySchema, body);
  const profile = await requireProfile(client, owner);
  const existing = await getTransaction(client, owner, id); // 404 for missing OR not owned

  const kind = parsed.kind ?? existing.kind;
  const occurredAt = parsed.occurredAt ?? existing.occurredAt;
  const amountVnd = parsed.amountVnd ?? existing.amountVnd;
  const merchant = parsed.merchant !== undefined ? parsed.merchant || null : existing.merchant;

  const linkTouched = parsed.recurringItemId !== undefined;
  const finalItemId = linkTouched ? (parsed.recurringItemId ?? null) : (existing.recurringItemId ?? null);
  const finalDate = linkTouched ? (parsed.recurringInstanceDate ?? null) : (existing.recurringInstanceDate ?? null);
  if (finalItemId !== null && (linkTouched || parsed.kind !== undefined)) {
    await validateRecurringLink(client, owner, {
      kind,
      recurringItemId: finalItemId,
      recurringInstanceDate: finalDate,
    });
  }

  // Keep the stored fingerprint in step with user-entered rows. Imported (csv) rows keep the
  // fingerprint the import computed, so re-importing the same file is still detected.
  const identityChanged =
    parsed.occurredAt !== undefined || parsed.kind !== undefined || parsed.amountVnd !== undefined || parsed.merchant !== undefined;
  const recompute = identityChanged && (existing.source === "manual" || existing.source === "receipt");
  const patch = recompute
    ? { ...asObject(body), fingerprint: transactionFingerprint({ occurredAt, kind, amountVnd, merchant }) }
    : asObject(body);

  const record = await withPostingConflict(finalItemId !== null, () => updateTransaction(client, owner, id, patch));
  return {
    transaction: transactionToDto(record),
    impact: impactToDto(computeTransactionImpact(record, profile.balanceSnapshotAt, now)),
  };
}

export async function deleteTransactionForOwner(
  client: DbClient,
  owner: OwnerContext,
  id: string,
): Promise<{ deleted: true; id: string }> {
  await deleteTransaction(client, owner, id); // 404 for missing OR not owned
  return { deleted: true, id };
}

export interface RecurringListResult extends PageDto<RecurringDto> {
  /** Unreconciled past occurrences with proposed matches. Informational: nothing is linked automatically. */
  unreconciledSuggestions: RecurringSuggestionDto[];
  /** False when no suggestions could be computed (no profile, or inputs the engine rejects). */
  suggestionsAvailable: boolean;
  /** True when the input load hit a cap, so suggestions may be incomplete. */
  suggestionsMayBeIncomplete: boolean;
}

export async function listRecurringForOwner(
  client: DbClient,
  owner: OwnerContext,
  query: unknown,
  now: Date,
): Promise<RecurringListResult> {
  const page = await listRecurringItems(client, owner, query);
  const base = pageToDto(page, recurringToDto);
  try {
    const inputs = await loadFinanceInputs(client, owner, now);
    const forecast = forecastCashflow({
      profile: inputs.profile,
      transactions: inputs.transactions,
      recurringItems: inputs.recurringItems,
      now,
    });
    return {
      ...base,
      unreconciledSuggestions: suggestRecurringMatches(inputs.transactions, forecast.unreconciledOccurrences).map(
        suggestionToDto,
      ),
      suggestionsAvailable: true,
      suggestionsMayBeIncomplete: inputs.truncated,
    };
  } catch (error) {
    const expected =
      error instanceof FinanceError || (error instanceof DbError && error.reason === "profile_missing");
    if (!expected) throw error;
    return { ...base, unreconciledSuggestions: [], suggestionsAvailable: false, suggestionsMayBeIncomplete: false };
  }
}

export async function createRecurringForOwner(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
): Promise<RecurringDto> {
  const record: RecurringRecord = await createRecurringItem(client, owner, body);
  return recurringToDto(record);
}

export async function updateRecurringForOwner(
  client: DbClient,
  owner: OwnerContext,
  id: string,
  body: unknown,
): Promise<RecurringDto> {
  const parsed = parseInput(recurringUpdateSchema, body);
  const existing = await getRecurringItem(client, owner, id); // 404 for missing OR not owned
  if (parsed.kind !== undefined && parsed.kind !== existing.kind && (await hasLinkedTransactions(client, owner, id))) {
    throw new DbError("invalid_input", { safeDetails: { field: "kind", rule: "recurring_kind_locked" } });
  }
  return recurringToDto(await updateRecurringItem(client, owner, id, body));
}
