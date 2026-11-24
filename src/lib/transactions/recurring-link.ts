import type { OwnerContext } from "@/lib/auth/owner-context";
import { recurringOccurrences, type LocalDate, type TransactionKind } from "@/lib/finance";
import { DbError } from "@/lib/db/errors";
import { getRecurringItem } from "@/lib/db/repositories/recurring";
import type { DbClient } from "@/lib/db/repositories/shared";
import type { RecurringRecord } from "@/lib/db/mappers";

function invalid(field: string, rule: string): DbError {
  return new DbError("invalid_input", { safeDetails: { field, rule } });
}

export interface RecurringLinkCheck {
  kind: TransactionKind;
  recurringItemId: string | null;
  recurringInstanceDate: LocalDate | null;
}

/**
 * Validates a transaction's recurring link before it is written. Returns the item, or null when
 * there is no link. Rules:
 *  (a) item id and instance date are both set or both null;
 *  (b) the item is loaded through the owner-scoped repository, so another user's id is
 *      indistinguishable from a missing one (same `recurring_item_not_found` answer);
 *  (c) the instance date is a real occurrence of the item (day-of-month clamp, leap February,
 *      start/end dates). The item's `active` flag is ignored on purpose: posting a past
 *      occurrence of a since-deactivated item is legitimate;
 *  (d) the transaction kind equals the item kind (`excluded` can never be a recurring posting).
 */
export async function validateRecurringLink(
  client: DbClient,
  owner: OwnerContext,
  check: RecurringLinkCheck,
): Promise<RecurringRecord | null> {
  const { recurringItemId, recurringInstanceDate } = check;
  if ((recurringItemId == null) !== (recurringInstanceDate == null)) {
    throw invalid("recurringItemId", "recurring_link_pair");
  }
  if (recurringItemId == null || recurringInstanceDate == null) return null;

  let item: RecurringRecord;
  try {
    item = await getRecurringItem(client, owner, recurringItemId);
  } catch (error) {
    if (error instanceof DbError && error.reason === "not_found") {
      throw invalid("recurringItemId", "recurring_item_not_found");
    }
    throw error;
  }
  const occurrences = recurringOccurrences({ ...item, active: true }, recurringInstanceDate, recurringInstanceDate);
  if (occurrences.length !== 1) throw invalid("recurringInstanceDate", "not_an_occurrence");
  if (check.kind !== item.kind) throw invalid("kind", "recurring_kind_mismatch");
  return item;
}
