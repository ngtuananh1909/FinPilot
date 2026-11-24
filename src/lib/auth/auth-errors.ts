/** Safe Vietnamese messages for Supabase Auth failures. Raw provider messages are never shown. */
export type AuthErrorKind =
  | "invalid_credentials"
  | "email_not_confirmed"
  | "rate_limited"
  | "user_exists"
  | "weak_password"
  | "signup_disabled"
  | "network"
  | "unknown";

export interface MappedAuthError {
  kind: AuthErrorKind;
  message: string;
}

const MESSAGES: Record<AuthErrorKind, string> = {
  invalid_credentials: "Email hoặc mật khẩu chưa đúng. Vui lòng kiểm tra và thử lại.",
  email_not_confirmed: "Email này chưa được xác nhận. Hãy mở thư xác nhận trong hộp thư của bạn rồi đăng nhập lại.",
  rate_limited: "Bạn thao tác quá nhiều lần. Vui lòng đợi vài phút rồi thử lại.",
  user_exists: "Không thể tạo tài khoản với email này. Hãy đăng nhập hoặc dùng email khác.",
  weak_password: "Mật khẩu chưa đủ mạnh. Hãy dùng ít nhất 8 ký tự, kết hợp chữ và số.",
  signup_disabled: "Hiện chưa thể đăng ký tài khoản mới. Bạn vẫn có thể trải nghiệm demo.",
  network: "Không thể kết nối. Vui lòng kiểm tra mạng và thử lại.",
  unknown: "Đã có lỗi xảy ra. Vui lòng thử lại.",
};

const CODE_TO_KIND: Record<string, AuthErrorKind> = {
  invalid_credentials: "invalid_credentials",
  email_not_confirmed: "email_not_confirmed",
  over_request_rate_limit: "rate_limited",
  over_email_send_rate_limit: "rate_limited",
  over_sms_send_rate_limit: "rate_limited",
  user_already_exists: "user_exists",
  email_exists: "user_exists",
  weak_password: "weak_password",
  signup_disabled: "signup_disabled",
  email_provider_disabled: "signup_disabled",
  validation_failed: "unknown",
};

/** Maps by stable error `code`, then HTTP `status`, then known legacy messages. Never echoes input. */
export function mapAuthError(error: unknown): MappedAuthError {
  const make = (kind: AuthErrorKind): MappedAuthError => ({ kind, message: MESSAGES[kind] });
  if (typeof error !== "object" || error === null) return make("unknown");
  const { code, status, name, message } = error as { code?: unknown; status?: unknown; name?: unknown; message?: unknown };
  if (typeof code === "string" && code in CODE_TO_KIND) return make(CODE_TO_KIND[code] as AuthErrorKind);
  if (status === 429) return make("rate_limited");
  if (name === "AuthRetryableFetchError" || status === 0) return make("network");
  if (typeof message === "string") {
    const text = message.toLowerCase();
    if (text.includes("invalid login credentials")) return make("invalid_credentials");
    if (text.includes("email not confirmed")) return make("email_not_confirmed");
    if (text.includes("rate limit")) return make("rate_limited");
    if (text.includes("already registered")) return make("user_exists");
    if (text.includes("failed to fetch") || text.includes("network")) return make("network");
  }
  return make("unknown");
}
