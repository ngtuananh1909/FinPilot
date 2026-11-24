import { z } from "zod";
import { assertPositiveVnd, assertNonNegativeVnd, parseLocalDate, parseVndString } from "@/lib/finance";
import { DbError } from "./errors";
import { parseInstant } from "./time";
import { IMPORT_SOURCES, IMPORT_STATUSES, RECURRING_KINDS, TRANSACTION_KINDS } from "./schema";

/**
 * Input schemas for repository writes/queries. Every object is `.strict()`: unknown keys
 * (notably `user_id` / `userId` / `owner`) are REJECTED, never silently dropped. The owner
 * comes only from the OwnerContext.
 */

export const PAGE_DEFAULT = 50;
export const PAGE_MAX = 200;
export const OFFSET_MAX = 100_000;

const vnd = (check: (n: bigint) => void) =>
  z
    .string()
    .refine((s) => {
      try {
        check(parseVndString(s));
        return true;
      } catch {
        return false;
      }
    }, "invalid_amount")
    .transform((s) => parseVndString(s));

/** Positive VND decimal string within the safe-integer bound (transaction/recurring/goal target). */
export const positiveVnd = vnd(assertPositiveVnd);
/** Zero-or-positive VND decimal string (profile budget fields, saved amount). */
export const nonNegativeVnd = vnd(assertNonNegativeVnd);
/** Signed VND decimal string (balance snapshot may be negative). */
export const signedVnd = z
  .string()
  .refine((s) => {
    try {
      parseVndString(s, { allowNegative: true });
      return true;
    } catch {
      return false;
    }
  }, "invalid_amount")
  .transform((s) => parseVndString(s, { allowNegative: true }));

export const uuidSchema = z.uuid();

export const localDateSchema = z.string().refine((s) => {
  try {
    parseLocalDate(s);
    return true;
  } catch {
    return false;
  }
}, "invalid_date");

const MIN_INSTANT = Date.UTC(2000, 0, 1);
const MAX_INSTANT = Date.UTC(2101, 0, 1);

/** ISO-8601 instant WITH an explicit offset (so parsing never depends on the host timezone). */
export const instantSchema = z
  .string()
  .refine((s) => {
    const d = parseInstant(s);
    return d !== null && d.getTime() >= MIN_INSTANT && d.getTime() < MAX_INSTANT;
  }, "invalid_instant")
  .transform((s) => parseInstant(s) as Date);

const CATEGORY_PATTERN = /^[\p{L}\p{N}_ -]{1,50}$/u;
export const categorySchema = z.string().trim().regex(CATEGORY_PATTERN, "invalid_category");
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();

const transactionKindSchema = z.enum(TRANSACTION_KINDS);
const recurringKindSchema = z.enum(RECURRING_KINDS);

// ---------------------------------------------------------------------------
// Profile
// ---------------------------------------------------------------------------

export const profileUpdateSchema = z
  .object({
    displayName: z.string().trim().min(1).max(80).optional(),
    balanceSnapshotVnd: signedVnd.optional(),
    balanceSnapshotAt: instantSchema.optional(),
    expectedMonthlyIncomeVnd: nonNegativeVnd.optional(),
    paydayDay: z.number().int().min(1).max(31).nullable().optional(),
    expectedDailyExpenseVnd: nonNegativeVnd.optional(),
    projectedMonthlyBudgetVnd: nonNegativeVnd.optional(),
    minimumReserveVnd: nonNegativeVnd.optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "empty_update");
export type ProfileUpdateInput = z.infer<typeof profileUpdateSchema>;

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export const transactionCreateSchema = z
  .object({
    occurredAt: instantSchema,
    kind: transactionKindSchema,
    amountVnd: positiveVnd,
    category: categorySchema.default("other"),
    merchant: optionalText(200),
    description: optionalText(500),
    /** 'seed' is server-only and intentionally absent. */
    source: z.enum(["manual", "csv", "receipt"]).default("manual"),
    fingerprint: z.string().trim().min(1).max(128).nullable().optional(),
    importBatchId: uuidSchema.nullable().optional(),
    recurringItemId: uuidSchema.nullable().optional(),
    recurringInstanceDate: localDateSchema.nullable().optional(),
  })
  .strict()
  .refine(
    (v) => (v.recurringItemId == null) === (v.recurringInstanceDate == null),
    { message: "recurring_link_pair", path: ["recurringItemId"] },
  );
export type TransactionCreateInput = z.infer<typeof transactionCreateSchema>;

export const transactionUpdateSchema = z
  .object({
    occurredAt: instantSchema.optional(),
    kind: transactionKindSchema.optional(),
    amountVnd: positiveVnd.optional(),
    category: categorySchema.optional(),
    merchant: optionalText(200),
    description: optionalText(500),
    /** Server-computed (see src/lib/transactions/fingerprint.ts); never taken from a public body. */
    fingerprint: z.string().trim().min(1).max(128).nullable().optional(),
    /** Link/unlink to a recurring occurrence. Both keys must be present together (pair rule). */
    recurringItemId: uuidSchema.nullable().optional(),
    recurringInstanceDate: localDateSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "empty_update")
  .refine(
    (v) =>
      (v.recurringItemId === undefined) === (v.recurringInstanceDate === undefined) &&
      (v.recurringItemId == null) === (v.recurringInstanceDate == null),
    { message: "recurring_link_pair", path: ["recurringItemId"] },
  );
export type TransactionUpdateInput = z.infer<typeof transactionUpdateSchema>;

/** Characters allowed in free-text search after sanitising. Excludes `% _ \ , ( ) " * = & :` etc. */
const SEARCH_DISALLOWED = /[^\p{L}\p{N} .'-]/gu;
export const SEARCH_MAX = 100;

/**
 * Reduces user text to a whitelist (letters, digits, space, `.`, `'`, `-`) that is inert inside
 * a PostgREST `or=(...)` filter and an ILIKE pattern: no commas, parentheses, quotes, `=`,
 * LIKE wildcards (`%`, `_`) or backslash can survive, so the term cannot add filters.
 */
export function sanitizeSearchTerm(raw: string): string {
  return raw.normalize("NFC").replace(SEARCH_DISALLOWED, " ").replace(/\s+/g, " ").trim().slice(0, SEARCH_MAX);
}

const searchSchema = z
  .string()
  .max(500)
  .transform(sanitizeSearchTerm)
  .refine((s) => s.length > 0, "invalid_search");

/** Clamp to [1, PAGE_MAX]; non-finite or missing -> default. */
export function clampLimit(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return PAGE_DEFAULT;
  return Math.min(PAGE_MAX, Math.max(1, Math.trunc(value)));
}
/** Clamp to [0, OFFSET_MAX]; non-finite or missing -> 0. */
export function clampOffset(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.min(OFFSET_MAX, Math.max(0, Math.trunc(value)));
}

export const pageSchema = z.object({
  limit: z.number().optional().transform(clampLimit),
  offset: z.number().optional().transform(clampOffset),
});

export const transactionListSchema = z
  .object({
    limit: z.number().optional().transform(clampLimit),
    offset: z.number().optional().transform(clampOffset),
    kind: transactionKindSchema.optional(),
    category: categorySchema.optional(),
    /** Inclusive, Asia/Ho_Chi_Minh calendar dates. */
    fromDate: localDateSchema.optional(),
    toDate: localDateSchema.optional(),
    search: searchSchema.optional(),
  })
  .strict()
  .refine((v) => !v.fromDate || !v.toDate || v.fromDate <= v.toDate, {
    message: "invalid_range",
    path: ["fromDate"],
  });
export type TransactionListInput = z.input<typeof transactionListSchema>;

// ---------------------------------------------------------------------------
// Recurring items
// ---------------------------------------------------------------------------

const recurringBase = {
  label: z.string().trim().min(1).max(100),
  kind: recurringKindSchema,
  amountVnd: positiveVnd,
  dayOfMonth: z.number().int().min(1).max(31),
  category: categorySchema.default("other"),
  startDate: localDateSchema,
  endDate: localDateSchema.nullable().optional(),
};

export const recurringCreateSchema = z
  .object(recurringBase)
  .strict()
  .refine((v) => v.endDate == null || v.endDate >= v.startDate, {
    message: "invalid_range",
    path: ["endDate"],
  });
export type RecurringCreateInput = z.infer<typeof recurringCreateSchema>;

export const recurringUpdateSchema = z
  .object({
    label: recurringBase.label.optional(),
    kind: recurringBase.kind.optional(),
    amountVnd: recurringBase.amountVnd.optional(),
    dayOfMonth: recurringBase.dayOfMonth.optional(),
    category: categorySchema.optional(),
    startDate: localDateSchema.optional(),
    endDate: localDateSchema.nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "empty_update")
  .refine((v) => !v.startDate || !v.endDate || v.endDate >= v.startDate, {
    message: "invalid_range",
    path: ["endDate"],
  });
export type RecurringUpdateInput = z.infer<typeof recurringUpdateSchema>;

// ---------------------------------------------------------------------------
// Goal (one per user: savings_goals.user_id is the primary key)
// ---------------------------------------------------------------------------

export const goalUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    targetVnd: positiveVnd,
    savedVnd: nonNegativeVnd.default(0n),
    targetDate: localDateSchema.nullable().optional(),
  })
  .strict();
export type GoalUpsertInput = z.input<typeof goalUpsertSchema>;

// ---------------------------------------------------------------------------
// Import batches (record only)
// ---------------------------------------------------------------------------

export const importBatchCreateSchema = z
  .object({
    idempotencyKey: z.string().trim().min(1).max(128),
    source: z.enum(IMPORT_SOURCES),
    filename: z.string().trim().min(1).max(255).nullable().optional(),
    status: z.enum(IMPORT_STATUSES).default("committed"),
    acceptedCount: z.number().int().min(0).max(100_000).default(0),
    rejectedCount: z.number().int().min(0).max(100_000).default(0),
  })
  .strict();
export type ImportBatchCreateInput = z.input<typeof importBatchCreateSchema>;

// ---------------------------------------------------------------------------
// Parse helper
// ---------------------------------------------------------------------------

/**
 * Parses untrusted input. On failure throws a DbError that exposes only the first failing
 * field path and the schema's message code (never the submitted value).
 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const path = issue?.path.map(String).join(".") ?? "";
  const key = issue?.code === "unrecognized_keys" ? ((issue as { keys?: string[] }).keys ?? []).join(",") : "";
  throw new DbError("invalid_input", {
    safeDetails: {
      field: (path || key || "input").slice(0, 60),
      rule: issue?.code === "unrecognized_keys" ? "unrecognized_keys" : (issue?.message ?? "invalid").slice(0, 60),
    },
  });
}
