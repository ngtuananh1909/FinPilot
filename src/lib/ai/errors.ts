import { AppError } from "@/lib/errors";

export type ProviderPreResultReason =
  | "invalid_config"
  | "provider_rejected"
  | "rate_limited"
  | "provider_overloaded"
  | "unsupported_capability";

const PRE_RESULT_MESSAGE: Partial<Record<ProviderPreResultReason, string>> = {
  rate_limited: "Nhà cung cấp AI đang giới hạn số lượt hoặc đã hết hạn mức. Vui lòng thử lại sau.",
  provider_overloaded: "Mô hình AI đang quá tải. Lượt này không bị tính, vui lòng thử lại sau ít phút.",
  unsupported_capability: "Mô hình AI đã cấu hình không hỗ trợ tính năng này.",
};

/**
 * The provider failed BEFORE producing any usable result and the failure is definitive:
 * invalid/missing configuration, an explicit provider rejection (auth, bad request, unknown
 * model), a provider rate limit (HTTP 429: the request was refused, not processed), an explicit
 * overload refusal (HTTP 503 UNAVAILABLE) or a model that lacks tools/vision. Quota reserved for the request is released (idempotently).
 */
export class ProviderPreResultError extends AppError {
  readonly reason: ProviderPreResultReason;
  /** Upstream HTTP status when there was one. Safe to log; never the body. */
  readonly providerStatus: number | null;

  constructor(reason: ProviderPreResultReason, options: { cause?: unknown; providerStatus?: number } = {}) {
    const message = PRE_RESULT_MESSAGE[reason];
    super(reason === "invalid_config" ? "ai_not_configured" : "ai_unavailable", {
      safeDetails: {
        providerFailure: reason,
        ...(options.providerStatus === undefined ? {} : { providerStatus: options.providerStatus }),
      },
      ...(message ? { userMessage: message } : {}),
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "ProviderPreResultError";
    this.reason = reason;
    this.providerStatus = options.providerStatus ?? null;
  }
}

export type ProviderAmbiguousReason = "ambiguous_timeout" | "network" | "server_error" | "invalid_response";

/**
 * Outcome unknown (timeout, connection reset after the request was sent, 5xx, truncated or
 * malformed body). The provider may have processed and billed the call, so the quota
 * reservation is KEPT and the request is NOT retried automatically.
 */
export class ProviderAmbiguousError extends AppError {
  readonly reason: ProviderAmbiguousReason;

  constructor(options: { cause?: unknown; reason?: ProviderAmbiguousReason; providerStatus?: number } = {}) {
    const reason = options.reason ?? "ambiguous_timeout";
    super("ai_unavailable", {
      safeDetails: {
        providerFailure: reason,
        ...(options.providerStatus === undefined ? {} : { providerStatus: options.providerStatus }),
      },
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "ProviderAmbiguousError";
    this.reason = reason;
  }
}
