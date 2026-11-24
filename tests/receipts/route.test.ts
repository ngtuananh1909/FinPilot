import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_RECEIPT_BYTES } from "@/lib/receipts/upload";
import { OWNER_ID } from "../db/repositories/support/fake-client";
import { createMemoryDb, type MemoryDb } from "../assistant/support/memory-db";

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
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, ...new Array(MIN_RECEIPT_BYTES).fill(1)]);
const post = (body: Uint8Array, headers: Record<string, string>) =>
  new Request(`${ORIGIN}/api/receipts/extract`, { method: "POST", headers: { origin: ORIGIN, ...headers }, body: body as unknown as BodyInit });
const route = async () => (await import("@/app/api/receipts/extract/route")).POST;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.stubEnv("RECEIPT_MAX_BYTES", "5242880");
  for (const k of ["AI_PROVIDER", "AI_BASE_URL", "AI_API_KEY", "AI_MODEL", "AI_VISION_MODEL"]) vi.stubEnv(k, "");
  state.user = { id: OWNER_ID, is_anonymous: true };
  state.db = createMemoryDb();
  state.admins = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/receipts/extract", () => {
  it("runs on Node and is never cached", async () => {
    const mod = await import("@/app/api/receipts/extract/route");
    expect([mod.runtime, mod.dynamic]).toEqual(["nodejs", "force-dynamic"]);
  });

  it("401 without a session and 403 for a foreign origin, before reading the image", async () => {
    state.user = null;
    expect((await (await route())(post(JPEG, { "content-type": "image/jpeg" }))).status).toBe(401);
    state.user = { id: OWNER_ID, is_anonymous: true };
    const foreign = new Request(`${ORIGIN}/api/receipts/extract`, { method: "POST", headers: { origin: "https://evil.example", "content-type": "image/jpeg" }, body: JPEG as unknown as BodyInit });
    expect((await (await route())(foreign)).status).toBe(403);
    expect(state.db.rpcLog).toHaveLength(0);
  });

  it("413 for an oversize image and 415 for a mismatched type, with no quota used", async () => {
    vi.stubEnv("RECEIPT_MAX_BYTES", "100");
    expect((await (await route())(post(new Uint8Array(500).fill(0xff), { "content-type": "image/jpeg" }))).status).toBe(413);
    vi.stubEnv("RECEIPT_MAX_BYTES", "5242880");
    expect((await (await route())(post(JPEG, { "content-type": "image/png" }))).status).toBe(415);
    expect(state.db.rpcLog).toHaveLength(0);
  });

  it("AC-15: AI not configured -> 503, no quota reserved, no fake OCR", async () => {
    const res = await (await route())(post(JPEG, { "content-type": "image/jpeg" }));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error.code).toBe("ai_not_configured");
    expect(body).not.toHaveProperty("draft");
    expect(state.db.rpcLog).toHaveLength(0);
    expect(state.admins).toBe(0);
  });
});
