import type { TransactionKind } from "./labels";
export interface TransactionFilters {
  search: string;
  kind: TransactionKind | "";
  category: string;
  /** YYYY-MM-DD, inclusive (Asia/Ho_Chi_Minh calendar date). */
  fromDate: string;
  toDate: string;
}
export const EMPTY_FILTERS: TransactionFilters = { search: "", kind: "", category: "", fromDate: "", toDate: "" };
export const PAGE_SIZE = 30;
/**
 * Mirror of the server's search whitelist (letters, digits, space, `.`, `'`, `-`). Everything else
 * is replaced by a space so the term cannot carry filter syntax, and an empty result is omitted
 * (the server answers 400 for an empty search).
 */
export function sanitizeSearch(raw: string): string {
  return raw
    .normalize("NFC")
    .replace(/[^\p{L}\p{N} .'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export function hasActiveFilters(f: TransactionFilters): boolean {
  return Boolean(sanitizeSearch(f.search) || f.kind || f.category || f.fromDate || f.toDate);
}
/** Returns a message when the date range is reversed or a date is malformed; null when fine. */
export function validateFilters(f: TransactionFilters): string | null {
  if (f.fromDate && !DATE.test(f.fromDate)) return "Ngày bắt đầu chưa hợp lệ.";
  if (f.toDate && !DATE.test(f.toDate)) return "Ngày kết thúc chưa hợp lệ.";
  if (f.fromDate && f.toDate && f.fromDate > f.toDate) return "Ngày bắt đầu phải trước hoặc trùng ngày kết thúc.";
  return null;
}
/**
 * Builds the `GET /api/transactions` query string. URLSearchParams percent-encodes every value, so
 * user text can never inject extra parameters. Empty filters are omitted.
 */
export function buildListQuery(filters: TransactionFilters, page: { limit: number; offset: number }): string {
  const params = new URLSearchParams();
  params.set("limit", String(page.limit));
  params.set("offset", String(page.offset));
  const search = sanitizeSearch(filters.search);
  if (search) params.set("search", search);
  if (filters.kind) params.set("kind", filters.kind);
  if (filters.category.trim()) params.set("category", filters.category.trim());
  if (filters.fromDate) params.set("fromDate", filters.fromDate);
  if (filters.toDate) params.set("toDate", filters.toDate);
  return params.toString();
}
