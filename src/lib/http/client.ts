/** Browser-side helpers for calling our own JSON API. No secrets, same-origin only. */
export interface JsonResponse {
  ok: boolean;
  status: number;
  json: unknown;
}

export async function requestJson(method: "POST" | "PATCH", url: string, body: unknown): Promise<JsonResponse> {
  const response = await fetch(url, {
    method,
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  return { ok: response.ok, status: response.status, json };
}

export interface ApiErrorInfo {
  code: string;
  message: string;
}

const MAX_MESSAGE = 300;

/** Reads the API's `{ error: { code, message } }` envelope; falls back to a Vietnamese default. */
export function readApiError(json: unknown, fallbackMessage = "Đã có lỗi xảy ra. Vui lòng thử lại."): ApiErrorInfo {
  const error = typeof json === "object" && json !== null ? (json as { error?: unknown }).error : undefined;
  if (typeof error === "object" && error !== null) {
    const { code, message } = error as { code?: unknown; message?: unknown };
    return {
      code: typeof code === "string" ? code : "internal",
      message: typeof message === "string" && message.trim() ? message.trim().slice(0, MAX_MESSAGE) : fallbackMessage,
    };
  }
  return { code: "internal", message: fallbackMessage };
}
