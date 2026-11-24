import { describe, expect, it, vi } from "vitest";
import type { User } from "@supabase/supabase-js";
import { isAnonymousUser, requireUser, type AuthVerifier } from "@/lib/auth/require-user";
import { isProtectedPath } from "@/lib/auth/routes";
import { AppError } from "@/lib/errors";

const makeUser = (over: Partial<User> = {}) => ({ id: "verified-id", is_anonymous: false, ...over }) as User;
const client = (getUser: () => Promise<{ data: { user: User | null }; error: unknown }>) =>
  ({ auth: { getUser, getSession: vi.fn(() => { throw new Error("getSession must not be used"); }) } }) as unknown as AuthVerifier;

describe("requireUser", () => {
  it("returns the id verified by getUser", async () => {
    const result = await requireUser(client(async () => ({ data: { user: makeUser() }, error: null })));
    expect(result.userId).toBe("verified-id");
    expect(result.isAnonymous).toBe(false);
  });
  it("flags anonymous users", async () => {
    const result = await requireUser(client(async () => ({ data: { user: makeUser({ is_anonymous: true }) }, error: null })));
    expect(result.isAnonymous).toBe(true);
    expect(isAnonymousUser(makeUser({ is_anonymous: true }))).toBe(true);
    expect(isAnonymousUser(null)).toBe(false);
  });
  it.each([
    ["error", async () => ({ data: { user: makeUser() }, error: new Error("jwt expired") })],
    ["null user", async () => ({ data: { user: null }, error: null })],
    ["thrown", async () => { throw new Error("network"); }],
  ])("throws unauthenticated on %s", async (_n, getUser) => {
    await expect(requireUser(client(getUser))).rejects.toMatchObject({ code: "unauthenticated", httpStatus: 401 });
    await expect(requireUser(client(getUser))).rejects.toBeInstanceOf(AppError);
  });
  it("takes identity only from getUser, ignoring any other id source", async () => {
    // Attacker-controlled ids in extra arguments or on the client object are never read.
    const c = client(async () => ({ data: { user: makeUser({ id: "real" }) }, error: null }));
    const result = await (requireUser as (c: AuthVerifier, extra: unknown) => ReturnType<typeof requireUser>)(c, { user_id: "attacker" });
    expect(result.userId).toBe("real");
  });
});

describe("isProtectedPath", () => {
  it.each(["/dashboard", "/transactions", "/assistant", "/simulator", "/settings", "/settings/", "/dashboard/x"])("protects %s", (p) => {
    expect(isProtectedPath(p)).toBe(true);
  });
  it.each(["/", "/api/health", "/dashboardx", "/settingsfoo", "/_next/static/a.js", "/login"])("leaves %s public", (p) => {
    expect(isProtectedPath(p)).toBe(false);
  });
});
