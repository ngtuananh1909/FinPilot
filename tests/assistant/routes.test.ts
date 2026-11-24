import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OTHER_ID, OWNER_ID, profileRow } from "../db/repositories/support/fake-client";
import { createMemoryDb, type MemoryDb } from "./support/memory-db";

const state = { user: null as null | { id: string; is_anonymous: boolean }, db: null as unknown as MemoryDb, admins: 0 };

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (t: string) => state.db.client.from(t),
  }),
}));
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => {
    state.admins += 1;
    return state.db.admin;
  },
}));

const ORIGIN = "http://localhost:3000";
const post = (path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  for (const k of ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_VISION_MODEL"]) vi.stubEnv(k, "");
  state.user = { id: OWNER_ID, is_anonymous: true };
  state.db = createMemoryDb({ financial_profiles: [{ ...profileRow(), user_id: OWNER_ID }] });
  state.admins = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const chatRoute = async () => (await import("@/app/api/assistant/chat/route")).POST;

describe("POST /api/assistant/chat", () => {
  it("runs on Node and is never cached", async () => {
    const mod = await import("@/app/api/assistant/chat/route");
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });

  it("401 without a session, 403 for a foreign origin; no admin client, no quota", async () => {
    state.user = null;
    expect((await (await chatRoute())(post("/api/assistant/chat", { message: "hi" }))).status).toBe(401);
    state.user = { id: OWNER_ID, is_anonymous: true };
    expect((await (await chatRoute())(post("/api/assistant/chat", { message: "hi" }, { origin: "https://evil.example" }))).status).toBe(403);
    expect(state.admins).toBe(0);
    expect(state.db.rpcLog).toHaveLength(0);
  });

  it("AC-15: without AI configuration answers 503 ai_not_configured, reserves no quota, fakes nothing", async () => {
    const res = await (await chatRoute())(post("/api/assistant/chat", { message: "Tôi có đủ tiền đóng trọ không?" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("ai_not_configured");
    expect(body).not.toHaveProperty("answer");
    expect(state.db.rpcLog).toHaveLength(0);
    expect(state.db.tables.ai_messages ?? []).toHaveLength(0);
  });
});

describe("GET /api/assistant/conversations", () => {
  it("reports aiConfigured as a boolean only, with quota", async () => {
    const { GET } = await import("@/app/api/assistant/conversations/route");
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.aiConfigured).toBe(false);
    expect(body.quota).toMatchObject({ kind: "chat", limit: 20, used: 0, remaining: 20 });
    expect(JSON.stringify(body)).not.toMatch(/AI_API_KEY|missing/);
  });

  it("does not show another user's conversation", async () => {
    state.db.tables.ai_conversations = [{ id: "99999999-9999-4999-8999-999999999999", user_id: OTHER_ID, title: "x", created_at: "a", updated_at: "a" }];
    const { GET } = await import("@/app/api/assistant/conversations/[id]/route");
    const res = await GET(new Request(`${ORIGIN}/api/assistant/conversations/x`), params("99999999-9999-4999-8999-999999999999"));
    expect(res.status).toBe(404);
  });
});

describe("POST /api/assistant/proposals/[id]/approve|reject", () => {
  it.each(["approve", "reject"])("%s requires exactly {confirm:true}", async (action) => {
    const mod = await import(`@/app/api/assistant/proposals/[id]/${action}/route`);
    for (const body of [{}, { confirm: false }, { confirm: "true" }, { confirm: true, user_id: OTHER_ID }]) {
      const res = await mod.POST(post(`/api/assistant/proposals/x/${action}`, body), params("11111111-2222-4333-8444-555555555555"));
      expect(res.status).toBe(400);
    }
    expect(state.admins).toBe(0);
  });

  it("404 for a proposal that is not the caller's", async () => {
    state.db.tables.ai_proposals = [
      {
        id: "11111111-2222-4333-8444-555555555555",
        user_id: OTHER_ID,
        kind: "budget_update",
        status: "pending",
        payload: { projectedMonthlyBudgetVnd: "1", reason: "x" },
        baseline: { projectedMonthlyBudgetVnd: "4000000" },
        expires_at: "2099-01-01T00:00:00Z",
        created_at: "2026-11-24T00:00:00Z",
      },
    ];
    const { POST } = await import("@/app/api/assistant/proposals/[id]/approve/route");
    const res = await POST(post("/api/assistant/proposals/x/approve", { confirm: true }), params("11111111-2222-4333-8444-555555555555"));
    expect(res.status).toBe(404);
    expect(state.db.tables.ai_proposals[0]!.status).toBe("pending");
  });
});
