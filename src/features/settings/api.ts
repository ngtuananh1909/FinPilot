import { callApi, type ApiResult, type FetchLike } from "@/lib/http/api-call";
import type { GoalDto } from "@/lib/settings/dto";
import type { BalanceSnapshotResult, ProfileWriteResult, SettingsDocument } from "@/lib/settings/service";
import type { RecurringDto } from "@/lib/transactions/dto";
import type { ProfilePatch } from "./profile-form";
/** Typed wrappers over the existing settings, recurring and demo routes. */
export const getSettingsApi = (f: FetchLike): Promise<ApiResult<SettingsDocument>> =>
  callApi(f, "GET", "/api/settings");
export const patchProfileApi = (f: FetchLike, patch: ProfilePatch): Promise<ApiResult<ProfileWriteResult>> =>
  callApi(f, "PATCH", "/api/settings/profile", patch);
export const setBalanceSnapshotApi = (
  f: FetchLike,
  body: { amountVnd: string; confirm: true },
): Promise<ApiResult<BalanceSnapshotResult>> => callApi(f, "POST", "/api/settings/balance-snapshot", body);
export const createRecurringApi = (f: FetchLike, body: Record<string, unknown>): Promise<ApiResult<{ item: RecurringDto }>> =>
  callApi(f, "POST", "/api/recurring", body);
/** There is deliberately no delete: deactivate with `{ active: false }`. */
export const updateRecurringApi = (
  f: FetchLike,
  id: string,
  body: Record<string, unknown>,
): Promise<ApiResult<{ item: RecurringDto }>> => callApi(f, "PATCH", `/api/recurring/${encodeURIComponent(id)}`, body);
export const putGoalApi = (f: FetchLike, body: Record<string, unknown>): Promise<ApiResult<{ goal: GoalDto }>> =>
  callApi(f, "PUT", "/api/settings/goal", body);
export const deleteGoalApi = (f: FetchLike): Promise<ApiResult<{ goal: null }>> =>
  callApi(f, "DELETE", "/api/settings/goal", { confirm: true });
/** The reset route also requires an idempotency key (8 to 120 chars); reuse it when retrying one confirmation. */
export const resetDemoApi = (f: FetchLike, idempotencyKey: string): Promise<ApiResult<{ status: "reset"; replay: boolean }>> =>
  callApi(f, "POST", "/api/demo/reset", { confirm: true, idempotencyKey });
