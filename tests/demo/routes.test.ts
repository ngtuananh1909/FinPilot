import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID, createFakeClient, profileRow } from "../db/repositories/support/fake-client";

const state = {
  user: null as null | { id: string; is_anonymous: boolean },
  profile: null as null | Record<string, unknown>,
  rpc: [] as Array<{ fn: string; args: Record<string, unknown> }>,
  adminCreated: 0,
};

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: async () => {
    const fake = createFakeClient(() => ({ data: state.profile }));
    return {
      auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
      from: (t: string) => (fake.client as unknown as { from: (t: string) => unknown }).from(t),
    };
  },
}));
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => {
    state.adminCreated += 1;
    return {
      rpc: async (fn: string, args: Record<string, unknown>) => {
        state.rpc.push({ fn, args });
        return { data: { applied: true, replay: false }, error: null };
      },
    };
  },
}));

const ORIGIN = "http://localhost:3000";
const post = (path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers, body: JSON.stringify(body) });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  state.user = { id: OWNER_ID, is_anonymous: true };
  state.profile = null;
  state.rpc = [];
  state.adminCreated = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => vi.unstubAllEnvs());

const KEY = "idem-key-0001";

describe("POST /api/demo/start", () => {
  it("clones the persona for the VERIFIED user and ignores any owner id in the body", async () => {
    const { POST } = await import("@/app/api/demo/start/route");
    const res = await POST(post("/api/demo/start", { personaCode: "student", idempotencyKey: KEY }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ status: "started", personaCode: "student" });
    expect(state.rpc).toHaveLength(1);
    expect(state.rpc[0]!.args.p_user_id).toBe(OWNER_ID);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects a body carrying user_id before any privileged call", async () => {
    const { POST } = await import("@/app/api/demo/start/route");
    const res = await POST(post("/api/demo/start", { personaCode: "student", idempotencyKey: KEY, user_id: "other" }));
    expect(res.status).toBe(400);
    expect(state.rpc).toHaveLength(0);
  });

  it("rejects missing/foreign origin without creating the admin client", async () => {
    const { POST } = await import("@/app/api/demo/start/route");
    expect((await POST(post("/api/demo/start", {}, {}))).status).toBe(403);
    expect((await POST(post("/api/demo/start", {}, { origin: "https://evil.example.com" }))).status).toBe(403);
    expect(state.adminCreated).toBe(0);
  });

  it("returns 401 when there is no verified session", async () => {
    state.user = null;
    const { POST } = await import("@/app/api/demo/start/route");
    const res = await POST(post("/api/demo/start", { personaCode: "student", idempotencyKey: KEY }));
    expect(res.status).toBe(401);
    expect(state.rpc).toHaveLength(0);
  });

  it("returns 403 for a signed-in (non anonymous) user", async () => {
    state.user = { id: OWNER_ID, is_anonymous: false };
    const { POST } = await import("@/app/api/demo/start/route");
    const res = await POST(post("/api/demo/start", { personaCode: "student", idempotencyKey: KEY }));
    expect(res.status).toBe(403);
    expect(state.rpc).toHaveLength(0);
  });

  it("never exposes internals on failure", async () => {
    state.user = null;
    const { POST } = await import("@/app/api/demo/start/route");
    const text = await (await POST(post("/api/demo/start", { personaCode: "student", idempotencyKey: KEY }))).text();
    expect(text).not.toMatch(/stack|supabase\.co|test-publishable/i);
  });
});

describe("POST /api/demo/reset", () => {
  it("resets only the verified caller after confirmation", async () => {
    state.profile = profileRow({ persona_code: "student" });
    const { POST } = await import("@/app/api/demo/reset/route");
    const res = await POST(post("/api/demo/reset", { confirm: true, idempotencyKey: KEY }));
    expect(res.status).toBe(200);
    expect(state.rpc[0]!.args.p_user_id).toBe(OWNER_ID);
  });

  it("requires confirm: true", async () => {
    state.profile = profileRow();
    const { POST } = await import("@/app/api/demo/reset/route");
    expect((await POST(post("/api/demo/reset", { idempotencyKey: KEY }))).status).toBe(400);
    expect(state.rpc).toHaveLength(0);
  });

  it("refuses to reset a real account", async () => {
    state.user = { id: OWNER_ID, is_anonymous: false };
    state.profile = profileRow({ is_demo: false });
    const { POST } = await import("@/app/api/demo/reset/route");
    const res = await POST(post("/api/demo/reset", { confirm: true, idempotencyKey: KEY }));
    expect(res.status).toBe(403);
    expect(state.rpc).toHaveLength(0);
  });
});
