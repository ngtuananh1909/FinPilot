import { z } from "zod";
import { nonNegativeVnd, signedVnd } from "@/lib/db/inputs";

/**
 * Public request bodies for /api/settings/*. All strict: `user_id`, `owner`, `persona_code`,
 * `is_demo`, the balance snapshot (on the profile route) and any other unknown key are REJECTED
 * with a 400 rather than ignored. Amounts are decimal strings (JSON numbers are rejected).
 */
export const profilePatchBodySchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    expectedMonthlyIncomeVnd: nonNegativeVnd.optional(),
    paydayDay: z.number().int().min(1).max(31).nullable().optional(),
    expectedDailyExpenseVnd: nonNegativeVnd.optional(),
    projectedMonthlyBudgetVnd: nonNegativeVnd.optional(),
    minimumReserveVnd: nonNegativeVnd.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "empty_update");

/** The explicit rebase action. `confirm` must be the literal `true`. */
export const balanceSnapshotBodySchema = z
  .object({
    amountVnd: signedVnd,
    confirm: z.literal(true, { error: "confirm_required" }),
  })
  .strict();

export const goalDeleteBodySchema = z
  .object({ confirm: z.literal(true, { error: "confirm_required" }) })
  .strict();
