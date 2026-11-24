import { getPublicEnv } from "@/lib/config/public-env";
import { AppError } from "@/lib/errors";

const MAX_JSON_BYTES = 16 * 1024;

/**
 * CSRF guard for cookie-authenticated mutating routes: the browser-supplied Origin must be
 * the configured app origin. A missing Origin is rejected (browsers always send it on POST).
 */
export function assertSameOrigin(request: Request, appUrl: string = getPublicEnv().NEXT_PUBLIC_APP_URL): void {
  const origin = request.headers.get("origin");
  let allowed: string;
  try {
    allowed = new URL(appUrl).origin;
  } catch {
    throw new AppError("config_missing");
  }
  if (!origin || origin !== allowed) throw new AppError("forbidden");
}

/** Reads a small JSON object body. Rejects oversize, non-JSON and non-object payloads. */
export async function readJsonObject(request: Request, maxBytes: number = MAX_JSON_BYTES): Promise<unknown> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) throw new AppError("validation_failed");
  const text = await request.text();
  if (text.length > maxBytes) throw new AppError("validation_failed");
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new AppError("validation_failed");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new AppError("validation_failed");
  }
  return value;
}
