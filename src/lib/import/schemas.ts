import { z } from "zod";
import { ImportError } from "./errors";
import { MAX_CSV_COLUMNS, MAX_CSV_ROWS } from "./limits";

/**
 * Request schemas for the CSV import routes. All objects are `.strict()`: a smuggled `user_id`,
 * `owner` or any other unknown key is rejected, never ignored. The owner comes only from the
 * verified session.
 */
const columnIndex = z.number().int().min(0).max(MAX_CSV_COLUMNS - 1).nullable();

const mappingSchema = z
  .object({
    occurred_at: columnIndex.optional(),
    kind: columnIndex.optional(),
    amount_vnd: columnIndex.optional(),
    debit_vnd: columnIndex.optional(),
    credit_vnd: columnIndex.optional(),
    category: columnIndex.optional(),
    merchant: columnIndex.optional(),
    description: columnIndex.optional(),
  })
  .strict();

const optionsSchema = z
  .object({
    /** true = DD/MM/YYYY, false = MM/DD/YYYY. Required to resolve ambiguous dates. */
    dayFirst: z.boolean().optional(),
    delimiter: z.enum([",", ";", "\t"]).optional(),
  })
  .strict();

const rowIdSchema = z.string().regex(/^r\d{1,5}-[0-9a-f]{8}$/);

export const previewRequestSchema = z
  .object({
    csv: z.string(),
    filename: z.string().trim().min(1).max(255).optional(),
    mapping: mappingSchema.optional(),
    options: optionsSchema.optional(),
  })
  .strict();
export type PreviewRequest = z.output<typeof previewRequestSchema>;

export const commitRequestSchema = z
  .object({
    confirmed: z.literal(true),
    idempotencyKey: z.string().trim().min(1).max(128),
    csv: z.string(),
    filename: z.string().trim().min(1).max(255).optional(),
    mapping: mappingSchema.optional(),
    options: optionsSchema.optional(),
    rowIds: z.array(rowIdSchema).min(1).max(MAX_CSV_ROWS),
    includeDuplicateRowIds: z.array(rowIdSchema).max(MAX_CSV_ROWS).optional(),
  })
  .strict();
export type CommitRequest = z.output<typeof commitRequestSchema>;

/** Parses an untrusted body. Only the first failing field path is exposed, never the value. */
export function parseImportRequest<S extends z.ZodType>(schema: S, body: unknown): z.output<S> {
  const result = schema.safeParse(body);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const keys = issue?.code === "unrecognized_keys" ? ((issue as { keys?: string[] }).keys ?? []).join(",") : "";
  const field = (issue?.path.map(String).join(".") || keys || "body").slice(0, 60);
  throw new ImportError("invalid_request", { detail: { field } });
}
