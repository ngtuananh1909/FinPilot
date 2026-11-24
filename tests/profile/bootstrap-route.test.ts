import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID } from "../db/repositories/support/fake-client";

const state = {
  user: null as null | { id: string; is_anonymous: boolean },
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  adminCreated: 0,
  rpcResult: { data: true, error: null } as { data: unknown; error: unknown },
};

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: async () => ({ auth: { getUser: async () => ({ data: { user: state.user }, error: null }) } }),
}));
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => {
    state.adminCreated += 1;
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpc.push({ fn, args });
        return state.rpcResult;
      },
    };
  },
}));

const ORIGIN = "http://localhost:3000";
const post = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}/api/profile/bootstrap`, { method: "POST", headers, body: typeof body === "string" ? body : JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  state.user = { id: OWNER_ID, is_anonymous: false };
  state.rpc = [];
  state.adminCreated = 0;
  state.rpcResult = { data: true, error: null };
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/profile/bootstrap", () => {
  it("bootstraps the VERIFIED user's profile with no persona or name", async () => {
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    const res = await POST(post({}));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ created: true });
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(state.rpc).toEqual([
      { fn: "bootstrap_profile", args: { p_user_id: OWNER_ID, p_persona_code: null, p_display_name: null } },
    ]);
  });

  it("is idempotent: reports created:false when the profile already exists", async () => {
    state.rpcResult = { data: false, error: null };
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    const res = await POST(post({}));
    expect(await res.json()).toEqual({ created: false });
  });

  it.each([{ user_id: "other" }, { personaCode: "student" }, { displayName: "x" }])("rejects body fields %j before any privileged call", async (body) => {
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    const res = await POST(post(body));
    expect(res.status).toBe(400);
    expect(state.adminCreated).toBe(0);
  });

  it("rejects non-JSON bodies", async () => {
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    expect((await POST(post("not json"))).status).toBe(400);
    expect(state.adminCreated).toBe(0);
  });

  it("rejects a missing or foreign origin without creating the admin client", async () => {
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    expect((await POST(post({}, {}))).status).toBe(403);
    expect((await POST(post({}, { origin: "https://evil.example.com" }))).status).toBe(403);
    expect(state.adminCreated).toBe(0);
  });

  it("returns 401 without a verified session", async () => {
    state.user = null;
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    expect((await POST(post({}))).status).toBe(401);
    expect(state.adminCreated).toBe(0);
  });

  it("rejects anonymous guests (their profile comes from /api/demo/start)", async () => {
    state.user = { id: OWNER_ID, is_anonymous: true };
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    expect((await POST(post({}))).status).toBe(403);
    expect(state.adminCreated).toBe(0);
  });

  it("does not leak internals when the RPC fails", async () => {
    state.rpcResult = { data: null, error: { code: "XX000", message: "relation secret_table at 10.0.0.1" } };
    const { POST } = await import("@/app/api/profile/bootstrap/route");
    const res = await POST(post({}));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(await res.text()).not.toMatch(/secret_table|10\.0\.0\.1|stack/);
  });
});
