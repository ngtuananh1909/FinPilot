import { describe, expect, it, vi } from "vitest";
import { mapAuthError } from "@/lib/auth/auth-errors";
import { submitLogin, submitSignup, type CredentialsDeps } from "@/lib/auth/credentials-flow";
import { validateEmail, validateLogin, validateSignup } from "@/lib/auth/validation";

describe("validation", () => {
  it("validates email format", () => {
    expect(validateEmail("ban@example.com")).toBeNull();
    expect(validateEmail("  ban@example.com ")).toBeNull();
    for (const bad of ["", "ban", "ban@", "@example.com", "ban@example", "a b@example.com"]) {
      expect(validateEmail(bad)).toEqual(expect.any(String));
    }
  });
  it("requires a password for login but no length rule", () => {
    expect(validateLogin({ email: "a@b.co", password: "x" })).toEqual({});
    expect(validateLogin({ email: "", password: "" })).toEqual({ email: expect.any(String), password: expect.any(String) });
  });
  it("requires >= 8 chars for signup", () => {
    expect(validateSignup({ email: "a@b.co", password: "1234567" }).password).toMatch(/8/);
    expect(validateSignup({ email: "a@b.co", password: "12345678" })).toEqual({});
  });
});

describe("mapAuthError", () => {
  const secret = "database error at 10.0.0.5 user=alice@example.com";
  it.each([
    [{ code: "invalid_credentials", message: secret }, "invalid_credentials"],
    [{ code: "email_not_confirmed", message: secret }, "email_not_confirmed"],
    [{ code: "over_request_rate_limit", message: secret }, "rate_limited"],
    [{ code: "over_email_send_rate_limit" }, "rate_limited"],
    [{ status: 429, message: secret }, "rate_limited"],
    [{ message: "Invalid login credentials" }, "invalid_credentials"],
    [{ message: "Email not confirmed" }, "email_not_confirmed"],
    [{ code: "user_already_exists" }, "user_exists"],
    [{ code: "weak_password" }, "weak_password"],
    [{ name: "AuthRetryableFetchError", status: 0, message: "fetch failed" }, "network"],
    [{ message: secret }, "unknown"],
    [new Error(secret), "unknown"],
    ["boom", "unknown"],
    [null, "unknown"],
  ])("maps %j to %s without echoing details", (input, kind) => {
    const mapped = mapAuthError(input);
    expect(mapped.kind).toBe(kind);
    expect(mapped.message).not.toContain("10.0.0.5");
    expect(mapped.message).not.toContain("alice");
    expect(mapped.message).toMatch(/[ăâđêôơưáàạảãéèẹẻẽíìịỉĩóòọỏõúùụủũýỳỵỷỹ]|vui lòng|Bạn|Email/i);
  });
});

const makeDeps = (overrides: Partial<CredentialsDeps> = {}): CredentialsDeps => ({
  signInWithPassword: vi.fn(async () => ({ error: null })),
  signUp: vi.fn(async () => ({ error: null, data: { session: {}, user: { identities: [{}] } } })),
  ...overrides,
});

describe("submitLogin", () => {
  it("does not call the provider when invalid", async () => {
    const deps = makeDeps();
    const out = await submitLogin(deps, { email: "bad", password: "" });
    expect(out).toMatchObject({ ok: false, fieldErrors: { email: expect.any(String), password: expect.any(String) } });
    expect(deps.signInWithPassword).not.toHaveBeenCalled();
  });
  it("trims the email and succeeds", async () => {
    const deps = makeDeps();
    expect(await submitLogin(deps, { email: " a@b.co ", password: "secret" })).toEqual({ ok: true });
    expect(deps.signInWithPassword).toHaveBeenCalledWith({ email: "a@b.co", password: "secret" });
  });
  it("maps provider errors and thrown errors to safe messages", async () => {
    const bad = makeDeps({ signInWithPassword: async () => ({ error: { code: "invalid_credentials" } }) });
    expect(await submitLogin(bad, { email: "a@b.co", password: "x" })).toMatchObject({ ok: false, message: expect.stringContaining("chưa đúng") });
    const thrown = makeDeps({
      signInWithPassword: async () => {
        throw new Error("secret-internal-detail");
      },
    });
    const out = await submitLogin(thrown, { email: "a@b.co", password: "x" });
    expect(JSON.stringify(out)).not.toContain("secret-internal-detail");
  });
});

describe("submitSignup", () => {
  it("rejects short passwords locally", async () => {
    const deps = makeDeps();
    const out = await submitSignup(deps, { email: "a@b.co", password: "short" }, "https://app.example.com");
    expect(out).toMatchObject({ ok: false, fieldErrors: { password: expect.any(String) } });
    expect(deps.signUp).not.toHaveBeenCalled();
  });
  it("sends a callback URL on the configured origin and reports a session", async () => {
    const deps = makeDeps();
    const out = await submitSignup(deps, { email: "a@b.co", password: "12345678" }, "https://app.example.com/ignored/path");
    expect(out).toEqual({ ok: true, needsEmailConfirmation: false });
    expect(deps.signUp).toHaveBeenCalledWith({
      email: "a@b.co",
      password: "12345678",
      emailRedirectTo: "https://app.example.com/auth/callback?next=%2Fonboarding",
    });
  });
  it("asks for email confirmation when no session is returned", async () => {
    const deps = makeDeps({ signUp: async () => ({ error: null, data: { session: null, user: { identities: [{}] } } }) });
    expect(await submitSignup(deps, { email: "a@b.co", password: "12345678" }, "https://x.test")).toEqual({
      ok: true,
      needsEmailConfirmation: true,
    });
  });
  it("treats an obfuscated existing user (no identities) as a failure", async () => {
    const deps = makeDeps({ signUp: async () => ({ error: null, data: { session: null, user: { identities: [] } } }) });
    expect(await submitSignup(deps, { email: "a@b.co", password: "12345678" }, "https://x.test")).toMatchObject({ ok: false });
  });
});
