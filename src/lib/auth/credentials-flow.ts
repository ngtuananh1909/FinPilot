import { mapAuthError } from "./auth-errors";
import { hasErrors, validateLogin, validateSignup, type AuthFieldErrors, type AuthFormValues } from "./validation";

type AuthResult<T> = { error: unknown; data?: T | null };

/** Minimal Supabase auth surface so the flows can be tested without a network. */
export interface CredentialsDeps {
  signInWithPassword(args: { email: string; password: string }): Promise<AuthResult<unknown>>;
  signUp(args: { email: string; password: string; emailRedirectTo: string }): Promise<
    AuthResult<{ session: unknown; user: { identities?: unknown[] | null } | null }>
  >;
}

export type LoginOutcome = { ok: true } | { ok: false; fieldErrors: AuthFieldErrors; message: string | null };
export type SignupOutcome =
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; fieldErrors: AuthFieldErrors; message: string | null };

export async function submitLogin(deps: CredentialsDeps, values: AuthFormValues): Promise<LoginOutcome> {
  const fieldErrors = validateLogin(values);
  if (hasErrors(fieldErrors)) return { ok: false, fieldErrors, message: null };
  try {
    const { error } = await deps.signInWithPassword({ email: values.email.trim(), password: values.password });
    if (error) return { ok: false, fieldErrors: {}, message: mapAuthError(error).message };
    return { ok: true };
  } catch (error) {
    return { ok: false, fieldErrors: {}, message: mapAuthError(error).message };
  }
}

/** `appUrl` is the configured public origin; the confirmation link returns to /auth/callback. */
export async function submitSignup(deps: CredentialsDeps, values: AuthFormValues, appUrl: string): Promise<SignupOutcome> {
  const fieldErrors = validateSignup(values);
  if (hasErrors(fieldErrors)) return { ok: false, fieldErrors, message: null };
  try {
    const redirect = `${new URL(appUrl).origin}/auth/callback?next=${encodeURIComponent("/onboarding")}`;
    const { data, error } = await deps.signUp({
      email: values.email.trim(),
      password: values.password,
      emailRedirectTo: redirect,
    });
    if (error) return { ok: false, fieldErrors: {}, message: mapAuthError(error).message };
    // Supabase hides an already-registered email by returning a user with no identities.
    if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
      return { ok: false, fieldErrors: {}, message: mapAuthError({ code: "user_already_exists" }).message };
    }
    return { ok: true, needsEmailConfirmation: !data?.session };
  } catch (error) {
    return { ok: false, fieldErrors: {}, message: mapAuthError(error).message };
  }
}
