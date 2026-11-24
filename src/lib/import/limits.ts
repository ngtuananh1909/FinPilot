/** Hard limits applied to every uploaded CSV. `maxBytes` comes from CSV_MAX_BYTES (default 2 MiB). */
export interface CsvLimits {
  readonly maxBytes: number;
  readonly maxRows: number;
  readonly maxColumns: number;
  readonly maxCellLength: number;
}

export const DEFAULT_CSV_MAX_BYTES = 2_097_152;
export const MAX_CSV_ROWS = 5000;
export const MAX_CSV_COLUMNS = 30;
export const MAX_CELL_LENGTH = 1000;

export function csvLimits(maxBytes: number = DEFAULT_CSV_MAX_BYTES): CsvLimits {
  return { maxBytes, maxRows: MAX_CSV_ROWS, maxColumns: MAX_CSV_COLUMNS, maxCellLength: MAX_CELL_LENGTH };
}

/** Existing-transaction rows scanned for duplicate review per request. */
export const DUPLICATE_SCAN_CAP = 5000;
