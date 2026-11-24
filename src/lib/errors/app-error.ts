export type AppErrorCode =
  | "unauthenticated"
  | "forbidden"
  | "validation_failed"
  | "finance_invalid_input"
  | "not_found"
  | "rate_limited"
  | "config_missing"
  | "ai_not_configured"
  | "ai_unavailable"
  | "internal";

const DEFAULTS: Record<AppErrorCode, { httpStatus: number; userMessage: string }> = {
  unauthenticated: { httpStatus: 401, userMessage: "Bạn cần bắt đầu phiên Demo hoặc đăng nhập để tiếp tục." },
  forbidden: { httpStatus: 403, userMessage: "Bạn không có quyền thực hiện thao tác này." },
  validation_failed: { httpStatus: 400, userMessage: "Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra và thử lại." },
  finance_invalid_input: { httpStatus: 422, userMessage: "Dữ liệu tài chính chưa hợp lệ." },
  not_found: { httpStatus: 404, userMessage: "Không tìm thấy nội dung yêu cầu." },
  rate_limited: { httpStatus: 429, userMessage: "Bạn đã dùng hết lượt hôm nay. Vui lòng thử lại vào ngày mai." },
  config_missing: { httpStatus: 503, userMessage: "Hệ thống chưa được cấu hình đầy đủ. Vui lòng thử lại sau." },
  ai_not_configured: { httpStatus: 503, userMessage: "Trợ lý AI hiện chưa được cấu hình." },
  ai_unavailable: { httpStatus: 502, userMessage: "Trợ lý AI tạm thời không phản hồi. Vui lòng thử lại." },
  internal: { httpStatus: 500, userMessage: "Đã có lỗi xảy ra. Vui lòng thử lại." },
};

export interface AppErrorOptions {
  readonly userMessage?: string;
  readonly httpStatus?: number;
  /** Must be safe to show to the client (no secrets, no stack, no raw upstream bodies). */
  readonly safeDetails?: Readonly<Record<string, string | number | boolean>>;
  readonly cause?: unknown;
}

/** Typed application error with a Vietnamese, user-facing message. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly httpStatus: number;
  readonly userMessage: string;
  readonly safeDetails?: Readonly<Record<string, string | number | boolean>>;

  constructor(code: AppErrorCode, options: AppErrorOptions = {}) {
    const defaults = DEFAULTS[code];
    super(code, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = "AppError";
    this.code = code;
    this.httpStatus = options.httpStatus ?? defaults.httpStatus;
    this.userMessage = options.userMessage ?? defaults.userMessage;
    if (options.safeDetails) this.safeDetails = options.safeDetails;
  }
}

export const isAppError = (value: unknown): value is AppError => value instanceof AppError;
