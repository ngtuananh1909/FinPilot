import { FinanceError } from "@/lib/finance";
import { EnvValidationError } from "@/lib/config/env-core";
import { AppError } from "./app-error";
import { financeErrorToAppError } from "./finance-errors";

export interface ErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Readonly<Record<string, string | number | boolean>>;
  };
}

/** Normalizes any thrown value into an AppError. Unknown errors become generic `internal`. */
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error;
  if (error instanceof FinanceError) return financeErrorToAppError(error);
  if (error instanceof EnvValidationError) return new AppError("config_missing", { cause: error });
  return new AppError("internal", { cause: error });
}

/**
 * Builds the JSON error response for route handlers. The body contains only the
 * code, the Vietnamese user message and explicitly safe details: no stack, no cause.
 */
export function toErrorResponse(error: unknown): Response {
  const appError = toAppError(error);
  // Log the error name only; messages may embed upstream data.
  console.error(`[api-error] ${appError.code} (${appError.httpStatus})`);
  const body: ErrorBody = {
    error: {
      code: appError.code,
      message: appError.userMessage,
      ...(appError.safeDetails ? { details: appError.safeDetails } : {}),
    },
  };
  return Response.json(body, { status: appError.httpStatus, headers: { "Cache-Control": "no-store" } });
}
