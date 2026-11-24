import { AppError, type AppErrorCode } from "@/lib/errors";

/**
 * Repository-level failure reasons. They ride on existing AppError codes (the shared
 * error module is frozen), and the reason is exposed to clients via `safeDetails.reason`.
 */
export type DbErrorReason =
  | "db_row_invalid"
  | "db_error"
  | "db_conflict"
  | "db_constraint"
  | "db_forbidden"
  | "not_found"
  | "rpc_unavailable"
  | "quota_exceeded"
  | "recurring_delete_not_allowed"
  | "server_only"
  | "profile_missing"
  | "invalid_input";

interface ReasonDefaults {
  code: AppErrorCode;
  httpStatus?: number;
  userMessage: string;
}

const REASONS: Record<DbErrorReason, ReasonDefaults> = {
  db_row_invalid: { code: "internal", userMessage: "Dữ liệu lưu trữ không hợp lệ. Vui lòng thử lại sau." },
  db_error: { code: "internal", userMessage: "Không thể truy cập dữ liệu lúc này. Vui lòng thử lại." },
  db_conflict: { code: "validation_failed", httpStatus: 409, userMessage: "Dữ liệu này đã tồn tại." },
  db_constraint: { code: "validation_failed", userMessage: "Dữ liệu không đáp ứng ràng buộc của hệ thống." },
  not_found: { code: "not_found", userMessage: "Không tìm thấy nội dung yêu cầu." },
  db_forbidden: { code: "forbidden", userMessage: "Bạn không có quyền thực hiện thao tác này." },
  rpc_unavailable: {
    code: "config_missing",
    userMessage: "Tính năng này chưa sẵn sàng trên hệ thống. Vui lòng thử lại sau.",
  },
  quota_exceeded: { code: "rate_limited", userMessage: "Bạn đã dùng hết lượt hôm nay. Vui lòng thử lại vào ngày mai." },
  recurring_delete_not_allowed: {
    code: "forbidden",
    userMessage: "Không thể xóa khoản định kỳ. Hãy tắt (ngừng áp dụng) khoản này thay vì xóa.",
  },
  server_only: { code: "forbidden", userMessage: "Thao tác này chỉ được thực hiện trên máy chủ." },
  profile_missing: { code: "not_found", userMessage: "Chưa có hồ sơ tài chính. Vui lòng bắt đầu phiên Demo hoặc thiết lập hồ sơ." },
  invalid_input: { code: "validation_failed", userMessage: "Dữ liệu gửi lên chưa hợp lệ. Vui lòng kiểm tra và thử lại." },
};

export interface DbErrorOptions {
  readonly userMessage?: string;
  readonly safeDetails?: Readonly<Record<string, string | number | boolean>>;
  readonly cause?: unknown;
}

/** AppError carrying a stable `reason`. Never carries raw database messages or row data. */
export class DbError extends AppError {
  readonly reason: DbErrorReason;
  constructor(reason: DbErrorReason, options: DbErrorOptions = {}) {
    const defaults = REASONS[reason];
    super(defaults.code, {
      userMessage: options.userMessage ?? defaults.userMessage,
      ...(defaults.httpStatus === undefined ? {} : { httpStatus: defaults.httpStatus }),
      safeDetails: { ...options.safeDetails, reason },
      ...(options.cause === undefined ? {} : { cause: options.cause }),
    });
    this.name = "DbError";
    this.reason = reason;
  }
}

export const isDbError = (value: unknown): value is DbError => value instanceof DbError;

/** Minimal shape of a PostgREST/Postgres error; only `code` and `status` are ever read. */
export interface PostgrestLikeError {
  readonly code?: string;
  readonly message?: string;
  readonly status?: number;
}

/** Function-not-found: PostgREST PGRST202 / PGRST204-ish, Postgres 42883, or HTTP 404. */
export function isMissingFunctionError(error: PostgrestLikeError | null | undefined): boolean {
  if (!error) return false;
  return error.code === "PGRST202" || error.code === "42883" || error.status === 404;
}

/**
 * Maps a database error to a DbError. Only the SQLSTATE/PostgREST code survives (inside a
 * fresh Error used as `cause`); the raw message is dropped because it can embed row data.
 */
export function mapDbError(error: PostgrestLikeError): DbError {
  const code = typeof error.code === "string" ? error.code : "unknown";
  const cause = new Error(`db_error:${code}`);
  if (code === "23505") return new DbError("db_conflict", { cause });
  if (code === "23503" || code === "23514" || code === "23502" || code.startsWith("22")) {
    return new DbError("db_constraint", { cause });
  }
  if (code === "42501") return new DbError("db_forbidden", { cause });
  return new DbError("db_error", { cause });
}
