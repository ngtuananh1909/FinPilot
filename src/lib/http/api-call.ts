/**
 * Browser-side JSON client with an injectable fetch, so UI logic can be tested with fakes.
 * Same-origin only. It never throws: every outcome is an ApiResult. The API's error envelope
 * `{ error: { code, message, details? } }` is mapped to a typed failure.
 */
export interface FetchResponseLike {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}
export type FetchLike = (input: string, init?: RequestInit) => Promise<FetchResponseLike>;
export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
export interface ApiSuccess<T> {
  ok: true;
  status: number;
  data: T;
}
export interface ApiFailure {
  ok: false;
  /** 0 when the request never reached the server. */
  status: number;
  code: string;
  message: string;
  /** `details.field` of the envelope (the first failing request field), if any. */
  field: string | null;
  /** `details.rule` of the envelope, if any. */
  rule: string | null;
  /** `details.reason` of the envelope (stable machine-readable reason), if any. */
  reason: string | null;
}
export type ApiResult<T> = ApiSuccess<T> | ApiFailure;
export const NETWORK_ERROR_MESSAGE = "Không thể kết nối tới máy chủ. Vui lòng kiểm tra mạng và thử lại.";
const DEFAULT_ERROR_MESSAGE = "Đã có lỗi xảy ra. Vui lòng thử lại.";
const MAX_MESSAGE = 300;
export const browserFetch: FetchLike = (input, init) =>
  fetch(input, { credentials: "same-origin", cache: "no-store", ...init });
const asText = (value: unknown, max: number): string | null =>
  typeof value === "string" && value.trim() ? value.trim().slice(0, max) : null;
export function toApiFailure(status: number, json: unknown): ApiFailure {
  const envelope = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
  const error = typeof envelope === "object" && envelope !== null ? (envelope as Record<string, unknown>) : {};
  const details =
    typeof error.details === "object" && error.details !== null ? (error.details as Record<string, unknown>) : {};
  return {
    ok: false,
    status,
    code: asText(error.code, 60) ?? "internal",
    message: asText(error.message, MAX_MESSAGE) ?? DEFAULT_ERROR_MESSAGE,
    field: asText(details.field, 60),
    rule: asText(details.rule, 60),
    reason: asText(details.reason, 60),
  };
}
export const networkFailure = (): ApiFailure => ({
  ok: false,
  status: 0,
  code: "network",
  message: NETWORK_ERROR_MESSAGE,
  field: null,
  rule: null,
  reason: null,
});
export async function callApi<T>(
  fetchImpl: FetchLike,
  method: HttpMethod,
  url: string,
  body?: unknown,
): Promise<ApiResult<T>> {
  let response: FetchResponseLike;
  try {
    response = await fetchImpl(url, {
      method,
      ...(body === undefined
        ? {}
        : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
    });
  } catch {
    return networkFailure();
  }
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) return toApiFailure(response.status, json);
  if (typeof json !== "object" || json === null) return toApiFailure(502, null);
  return { ok: true, status: response.status, data: json as T };
}
