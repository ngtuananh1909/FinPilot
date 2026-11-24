import type { OwnerContext } from "@/lib/auth/owner-context";
import type { DbClient } from "@/lib/db/repositories/shared";
import { getProfile } from "@/lib/db/repositories/profile";
import { listTransactionsForDuplicateCheck } from "@/lib/db/repositories/transactions";
import { getImportBatchByKey } from "@/lib/db/repositories/import-batches";
import type { RpcClient } from "@/lib/db/repositories/server-only/rpc";
import { commitCsvImportRpc } from "@/lib/db/repositories/server-only/csv-commit";
import type { ImportBatchRecord } from "@/lib/db/mappers";
import { compareLocalDates } from "@/lib/finance";
import {
  analyzeCsv,
  classifyRows,
  countHistoricalOnly,
  countRows,
  type Analysis,
  type AnalyzedRow,
  type PreviewCounts,
  type PreviewRow,
} from "./analyze";
import type { ColumnMapping, MappingIssueCode } from "./mapping";
import { ImportError } from "./errors";
import { DUPLICATE_SCAN_CAP, type CsvLimits } from "./limits";
import {
  commitRequestSchema,
  parseImportRequest,
  previewRequestSchema,
  type CommitRequest,
  type PreviewRequest,
} from "./schemas";

export interface CsvPreviewResult {
  readonly headers: readonly string[];
  readonly delimiter: string;
  /** Mapping actually used (suggestion + explicit overrides), as zero-based column indices. */
  readonly mapping: ColumnMapping;
  readonly suggestedMapping: ColumnMapping;
  /** Non-empty = the user must complete the mapping; `rows` is then empty. */
  readonly mappingIssues: readonly MappingIssueCode[];
  readonly kindSource: "column" | "debit_credit" | "sign";
  /** `options.dayFirst` as received (null = not chosen). */
  readonly dayFirst: boolean | null;
  /** True when at least one row has an ambiguous DD/MM vs MM/DD date: ask the user to choose. */
  readonly needsDateFormat: boolean;
  readonly rows: readonly PreviewRow[];
  readonly counts: PreviewCounts;
  /** Importable rows dated at or before the balance snapshot (history only). Null without a profile. */
  readonly historicalOnlyCount: number | null;
  readonly balanceSnapshotAt: string | null;
  /** True when the scan of stored transactions hit its cap, so duplicate review may be incomplete. */
  readonly duplicateCheckTruncated: boolean;
  readonly warnings: readonly string[];
}

interface Classified {
  readonly analysis: Analysis;
  readonly rows: readonly AnalyzedRow[];
  readonly truncated: boolean;
}

/**
 * Parse, normalise and classify. Reads the owner's stored transactions in the file's date range
 * (owner-scoped, capped) and writes nothing. Used by both preview and commit so commit never
 * trusts client-normalised rows.
 */
async function analyzeAndClassify(
  client: DbClient,
  owner: OwnerContext,
  request: PreviewRequest | CommitRequest,
  limits: CsvLimits,
): Promise<Classified> {
  const analysis = analyzeCsv({ csv: request.csv, mapping: request.mapping, options: request.options, limits });
  const dates = analysis.rows.flatMap((r) => (r.candidate ? [r.candidate.localDate] : []));
  if (dates.length === 0) return { analysis, rows: analysis.rows, truncated: false };

  const fromDate = dates.reduce((a, b) => (compareLocalDates(a, b) <= 0 ? a : b));
  const toDate = dates.reduce((a, b) => (compareLocalDates(a, b) >= 0 ? a : b));
  const existing = await listTransactionsForDuplicateCheck(
    client,
    owner,
    { fromDate, toDate },
    DUPLICATE_SCAN_CAP,
  );
  return { analysis, rows: classifyRows(analysis.rows, existing.items), truncated: existing.truncated };
}

export async function previewCsv(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
  limits: CsvLimits,
): Promise<CsvPreviewResult> {
  const request = parseImportRequest(previewRequestSchema, body);
  const { analysis, rows, truncated } = await analyzeAndClassify(client, owner, request, limits);
  const profile = await getProfile(client, owner);

  const warnings: string[] = [];
  if (analysis.kindSource === "sign") {
    warnings.push("kind_from_amount_sign");
    if (rows.length > 0 && rows.every((r) => r.candidate === null || r.candidate.kind === "income")) {
      warnings.push("all_amounts_positive_no_kind_column");
    }
  }
  if (truncated) warnings.push("duplicate_check_truncated");

  return {
    headers: analysis.parsed.headers,
    delimiter: analysis.parsed.delimiter,
    mapping: analysis.mapping,
    suggestedMapping: analysis.suggestedMapping,
    mappingIssues: analysis.mappingIssues,
    kindSource: analysis.kindSource,
    dayFirst: request.options?.dayFirst ?? null,
    needsDateFormat: rows.some((r) => r.view.reasons.some((x) => x.code === "ambiguous_date")),
    rows: rows.map((r) => r.view),
    counts: countRows(rows),
    historicalOnlyCount: profile ? countHistoricalOnly(rows, profile.balanceSnapshotAt) : null,
    balanceSnapshotAt: profile ? profile.balanceSnapshotAt.toISOString() : null,
    duplicateCheckTruncated: truncated,
    warnings,
  };
}

export interface CsvCommitResult {
  /** True when the idempotency key already existed: nothing was inserted by this call. */
  readonly replayed: boolean;
  readonly batch: {
    readonly id: string;
    readonly status: "committed" | "failed";
    readonly acceptedCount: number;
    readonly rejectedCount: number;
    readonly filename: string | null;
    readonly createdAt: string;
  };
  /** Present only for a fresh commit. */
  readonly importedRowIds: readonly string[];
  readonly refused: readonly { readonly rowId: string; readonly reason: string }[];
  /** Rows of the file the user did not select. */
  readonly skippedCount: number;
}

const batchView = (b: ImportBatchRecord): CsvCommitResult["batch"] => ({
  id: b.id,
  status: b.status,
  acceptedCount: b.acceptedCount,
  rejectedCount: b.rejectedCount,
  filename: b.filename,
  createdAt: b.createdAt.toISOString(),
});

const replayResult = (b: ImportBatchRecord): CsvCommitResult => ({
  replayed: true,
  batch: batchView(b),
  importedRowIds: [],
  refused: [],
  skippedCount: 0,
});

/**
 * Commits the selected rows of a CSV.
 *
 * 1. Strict request validation (`confirmed: true`, idempotency key, row ids).
 * 2. An existing batch for (owner, key) is returned as-is: no parsing, no inserts.
 * 3. The CSV is re-parsed and re-classified server-side. Only rows that are `ok`, or duplicates
 *    the user listed in `includeDuplicateRowIds`, can be imported; `invalid` and `ambiguous` rows
 *    never can, even if their ids are sent.
 * 4. The batch row and ALL accepted rows are written by ONE database transaction
 *    (`public.commit_csv_import`, migration 0003). It is all-or-nothing, so a failure leaves no
 *    batch and no rows, and the same idempotency key can simply be retried. A concurrent request
 *    with the same key gets the stored batch (`replayed: true`).
 *
 * `rpc` is the service-role client, created by the route only AFTER the owner was verified; the
 * user id passed to the RPC is `owner.userId`, never request input.
 */
export async function commitCsv(
  client: DbClient,
  owner: OwnerContext,
  body: unknown,
  limits: CsvLimits,
  rpc: RpcClient,
): Promise<CsvCommitResult> {
  const request = parseImportRequest(commitRequestSchema, body);

  const prior = await getImportBatchByKey(client, owner, request.idempotencyKey);
  if (prior) return replayResult(prior);

  const { analysis, rows } = await analyzeAndClassify(client, owner, request, limits);
  if (analysis.mappingIssues.length > 0) throw new ImportError("mapping_incomplete");

  const byId = new Map(rows.map((r) => [r.view.rowId, r]));
  const selected = new Set(request.rowIds);
  const includeDuplicates = new Set(request.includeDuplicateRowIds ?? []);
  for (const id of selected) if (!byId.has(id)) throw new ImportError("unknown_row");
  for (const id of includeDuplicates) if (!selected.has(id)) throw new ImportError("duplicate_selection_not_selected");

  const accepted: AnalyzedRow[] = [];
  const refused: { rowId: string; reason: string }[] = [];
  for (const row of rows) {
    const { rowId, status } = row.view;
    if (!selected.has(rowId)) continue;
    if (status === "ok") {
      accepted.push(row);
    } else if (status === "possible_duplicate" || status === "exact_duplicate") {
      if (includeDuplicates.has(rowId) && row.candidate) accepted.push(row);
      else refused.push({ rowId, reason: "duplicate_not_confirmed" });
    } else {
      refused.push({ rowId, reason: status === "ambiguous" ? "ambiguous_row" : "invalid_row" });
    }
  }
  if (accepted.length === 0) throw new ImportError("no_rows_to_import");

  let outcome: Awaited<ReturnType<typeof commitCsvImportRpc>>;
  try {
    outcome = await commitCsvImportRpc(rpc, owner, {
      idempotencyKey: request.idempotencyKey,
      filename: request.filename ?? null,
      rejectedCount: rows.length - accepted.length,
      rows: accepted.map(({ candidate }) => {
        const c = candidate as NonNullable<AnalyzedRow["candidate"]>;
        return {
          occurredAt: c.occurredAt.toISOString(),
          kind: c.kind,
          amountVnd: c.amountVnd.toString(),
          category: c.category,
          merchant: c.merchant,
          description: c.description,
          fingerprint: c.fingerprint,
        };
      }),
    });
  } catch (cause) {
    throw new ImportError("import_commit_failed", { cause });
  }

  const batch = await getImportBatchByKey(client, owner, request.idempotencyKey);
  if (!batch || batch.id !== outcome.batchId) throw new ImportError("import_commit_failed");
  if (outcome.replayed) return replayResult(batch);

  return {
    replayed: false,
    batch: batchView(batch),
    importedRowIds: accepted.map((r) => r.view.rowId),
    refused,
    skippedCount: rows.length - selected.size,
  };
}
