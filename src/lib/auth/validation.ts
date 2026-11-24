export const MIN_PASSWORD_LENGTH = 8;
const MAX_EMAIL_LENGTH = 254;
const MAX_PASSWORD_LENGTH = 128;
// Pragmatic check only; Supabase performs the authoritative validation.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface AuthFormValues {
  email: string;
  password: string;
}
export type AuthFieldErrors = Partial<Record<keyof AuthFormValues, string>>;

export function validateEmail(value: string): string | null {
  const email = value.trim();
  if (!email) return "Vui lòng nhập email.";
  if (email.length > MAX_EMAIL_LENGTH || !EMAIL_PATTERN.test(email)) return "Email chưa đúng định dạng, ví dụ ban@example.com.";
  return null;
}

export function validateLogin(values: AuthFormValues): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const email = validateEmail(values.email);
  if (email) errors.email = email;
  if (!values.password) errors.password = "Vui lòng nhập mật khẩu.";
  return errors;
}

export function validateSignup(values: AuthFormValues): AuthFieldErrors {
  const errors: AuthFieldErrors = {};
  const email = validateEmail(values.email);
  if (email) errors.email = email;
  if (!values.password) errors.password = "Vui lòng nhập mật khẩu.";
  else if (values.password.length < MIN_PASSWORD_LENGTH) errors.password = `Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`;
  else if (values.password.length > MAX_PASSWORD_LENGTH) errors.password = "Mật khẩu quá dài.";
  return errors;
}

export const hasErrors = (errors: object): boolean => Object.keys(errors).length > 0;
