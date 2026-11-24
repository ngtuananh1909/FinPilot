import { callApi, type ApiResult, type FetchLike } from "@/lib/http/api-call";
import type { PageDto, TransactionDto } from "@/lib/transactions/dto";
import type { RecurringListResult, TransactionWriteResult } from "@/lib/transactions/service";
import { buildListQuery, type TransactionFilters } from "./filters";
/** Typed wrappers over the existing /api/transactions and /api/recurring routes. */
export const listTransactionsApi = (
  fetchImpl: FetchLike,
  filters: TransactionFilters,
  page: { limit: number; offset: number },
): Promise<ApiResult<PageDto<TransactionDto>>> =>
  callApi(fetchImpl, "GET", `/api/transactions?${buildListQuery(filters, page)}`);
export const createTransactionApi = (
  fetchImpl: FetchLike,
  body: Record<string, unknown>,
): Promise<ApiResult<TransactionWriteResult>> => callApi(fetchImpl, "POST", "/api/transactions", body);
export const updateTransactionApi = (
  fetchImpl: FetchLike,
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResult<TransactionWriteResult>> =>
  callApi(fetchImpl, "PATCH", `/api/transactions/${encodeURIComponent(id)}`, body);
/** The API requires `{ confirm: true }` in the DELETE body. */
export const deleteTransactionApi = (
  fetchImpl: FetchLike,
  id: string,
): Promise<ApiResult<{ deleted: true; id: string }>> =>
  callApi(fetchImpl, "DELETE", `/api/transactions/${encodeURIComponent(id)}`, { confirm: true });
export const listRecurringApi = (fetchImpl: FetchLike): Promise<ApiResult<RecurringListResult>> =>
  callApi(fetchImpl, "GET", "/api/recurring?limit=200");
