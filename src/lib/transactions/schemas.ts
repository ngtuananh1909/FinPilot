import { z } from "zod";
import {
  categorySchema,
  instantSchema,
  localDateSchema,
  parseInput,
  positiveVnd,
  uuidSchema,
} from "@/lib/db/inputs";
import { TRANSACTION_KINDS } from "@/lib/db/schema";
import { DbError } from "@/lib/db/errors";

/**
 * Public request bodies. Every object is strict: `user_id`, `owner_id`, `fingerprint`,
 * `importBatchId`, `source: "csv"` and any other unknown key are rejected with a 400, never ignored.
 * Amounts are decimal strings. The fingerprint is always computed on the server.
 */

const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const kindSchema = z.enum(TRANSACTION_KINDS);

const linkPair = (v: { recurringItemId?: string | null | undefined; recurringInstanceDate?: string | null | undefined }) =>
  (v.recurringItemId == null) === (v.recurringInstanceDate == null);

export const transactionCreateBodySchema = z
  .object({
    occurredAt: instantSchema,
    kind: kindSchema,
    amountVnd: positiveVnd,
    category: categorySchema.default("other"),
    merchant: optionalText(200),
    description: optionalText(500),
    /** "csv" is reserved for the import path; "seed" is server-only. */
    source: z.enum(["manual", "receipt"]).default("manual"),
    recurringItemId: uuidSchema.nullable().optional(),
    recurringInstanceDate: localDateSchema.nullable().optional(),
  })
  .strict()
  .refine(linkPair, { message: "recurring_link_pair", path: ["recurringItemId"] });
export type TransactionCreateBody = z.infer<typeof transactionCreateBodySchema>;

export const transactionPatchBodySchema = z
  .object({
    occurredAt: instantSchema.optional(),
    kind: kindSchema.optional(),
    amountVnd: positiveVnd.optional(),
    category: categorySchema.optional(),
    merchant: optionalText(200),
    description: optionalText(500),
    recurringItemId: uuidSchema.nullable().optional(),
    recurringInstanceDate: localDateSchema.nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), "empty_update")
  .refine(
    (v) => (v.recurringItemId === undefined) === (v.recurringInstanceDate === undefined) && linkPair(v),
    { message: "recurring_link_pair", path: ["recurringItemId"] },
  );
export type TransactionPatchBody = z.infer<typeof transactionPatchBodySchema>;

/** DELETE body: explicit confirmation is required. */
export const deleteBodySchema = z.object({ confirm: z.literal(true) }).strict();

/**
 * Turns URLSearchParams into a plain object for schema validation. Empty values are dropped;
 * digit-only values in `numeric` keys become numbers; `true`/`false` in `booleans` keys become
 * booleans; anything else stays a string so the schema rejects it (400). Repeated keys become arrays.
 */
export function searchParamsToObject(
  params: URLSearchParams,
  opts: { numeric?: readonly string[]; booleans?: readonly string[] } = {},
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key).filter((v) => v !== "");
    if (values.length === 0) continue;
    const convert = (value: string): unknown => {
      if (opts.numeric?.includes(key) && /^\d{1,9}$/.test(value)) return Number(value);
      if (opts.booleans?.includes(key) && (value === "true" || value === "false")) return value === "true";
      return value;
    };
    out[key] = values.length === 1 ? convert(values[0]!) : values;
  }
  return out;
}

export function parseDeleteConfirmation(body: unknown): void {
  try {
    parseInput(deleteBodySchema, body);
  } catch (error) {
    if (error instanceof DbError) {
      throw new DbError("invalid_input", {
        userMessage: "Cần xác nhận xóa: gửi {\"confirm\": true} trong nội dung yêu cầu.",
        safeDetails: { field: "confirm", rule: "confirmation_required" },
      });
    }
    throw error;
  }
}
