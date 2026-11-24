import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OWNER_ID, createFakeDb, profileRow, type FakeDb } from "./support/fake-db";

const state = {
  user: null as null | { id: string; is_anonymous: boolean },
  db: null as unknown as FakeDb,
  clients: 0,
};

vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: async () => {
    state.clients += 1;
    return {
      auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
      from: (t: string) => (state.db.client as unknown as { from: (t: string) => unknown }).from(t),
    };
  },
}));
const admin = { created: 0 };
vi.mock("@/lib/db/admin", () => ({
  // Only the commit route may create it, and only after the session was verified.
  createSupabaseAdminClient: () => {
    admin.created += 1;
    return state.db.rpc;
  },
}));

const ORIGIN = "http://localhost:3000";
const HEAD = "occurred_at,kind,amount_vnd,category,merchant,description";
const CSV = `${HEAD}\n2026-11-01T12:30:00+07:00,expense,45000,food,Canteen,Lunch\n2026-11-02,income,5000000,salary,Company,Pay`;

const post = (path: string, body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
  new Request(`${ORIGIN}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const PREVIEW = "/api/imports/csv/preview";
const COMMIT = "/api/imports/csv/commit";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  state.user = { id: OWNER_ID, is_anonymous: true };
  state.db = createFakeDb({ financial_profiles: [profileRow()] });
  state.clients = 0;
  admin.created = 0;
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const previewRoute = async () => (await import("@/app/api/imports/csv/preview/route")).POST;
const commitRoute = async () => (await import("@/app/api/imports/csv/commit/route")).POST;

describe("route configuration", () => {
  it("runs on the Node runtime and is never cached", async () => {
    for (const mod of [
      await import("@/app/api/imports/csv/preview/route"),
      await import("@/app/api/imports/csv/commit/route"),
    ]) {
      expect(mod.runtime).toBe("nodejs");
      expect(mod.dynamic).toBe("force-dynamic");
    }
  });
});

describe("POST /api/imports/csv/preview", () => {
  it("returns a preview without writing", async () => {
    const res = await (await previewRoute())(post(PREVIEW, { csv: CSV }));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await res.json();
    expect(body.counts).toMatchObject({ total: 2, ok: 2 });
    expect(body.rows[0].values.amountVnd).toBe("45000");
    expect(state.db.writes).toEqual([]);
  });

  it("401 without a verified session, before reading the body", async () => {
    state.user = null;
    const res = await (await previewRoute())(post(PREVIEW, { csv: CSV }));
    expect(res.status).toBe(401);
    expect(state.db.selects).toEqual([]);
  });

  it("403 for a missing or foreign Origin, without creating a client", async () => {
    const route = await previewRoute();
    expect((await route(post(PREVIEW, { csv: CSV }, {}))).status).toBe(403);
    expect((await route(post(PREVIEW, { csv: CSV }, { origin: "https://evil.example.com" }))).status).toBe(403);
    expect(state.clients).toBe(0);
  });

  it("400 for malformed JSON, non-object bodies, unknown keys and missing csv", async () => {
    const route = await previewRoute();
    for (const body of ["{not json", "[]", "null", "42", JSON.stringify({ csv: CSV, user_id: OWNER_ID }), "{}"]) {
      const res = await route(post(PREVIEW, body));
      expect(res.status).toBe(400);
      expect((await res.json()).error.details.reason).toBe("invalid_request");
    }
  });

  it("400 for empty, header-only, binary and mis-quoted CSV", async () => {
    const route = await previewRoute();
    const cases: [string, string][] = [
      ["", "empty_file"],
      ["a,b\n", "no_data_rows"],
      ["a,b\n1,\u00002", "binary_content"],
      ['a,b\n"x', "unterminated_quote"],
    ];
    for (const [csv, reason] of cases) {
      const res = await route(post(PREVIEW, { csv }));
      expect(res.status).toBe(400);
      expect((await res.json()).error.details.reason).toBe(reason);
    }
  });

  it("413 when the CSV exceeds CSV_MAX_BYTES (checked before parsing)", async () => {
    vi.stubEnv("CSV_MAX_BYTES", "64");
    const res = await (await previewRoute())(post(PREVIEW, { csv: `${HEAD}\n${"1,".repeat(100)}` }));
    expect(res.status).toBe(413);
    expect((await res.json()).error.details.reason).toBe("payload_too_large");
  });

  it("413 from a declared Content-Length, and from a streamed body without one", async () => {
    vi.stubEnv("CSV_MAX_BYTES", "1000");
    const route = await previewRoute();
    expect(
      (await route(post(PREVIEW, { csv: CSV }, { origin: ORIGIN, "content-length": "9999999" }))).status,
    ).toBe(413);

    const huge = new TextEncoder().encode(JSON.stringify({ csv: "x".repeat(600_000) }));
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < huge.length; i += 50_000) controller.enqueue(huge.slice(i, i + 50_000));
        controller.close();
      },
    });
    const req = new Request(`${ORIGIN}${PREVIEW}`, {
      method: "POST",
      headers: { origin: ORIGIN },
      body: stream,
      duplex: "half",
    } as RequestInit);
    // No Content-Length: the reader aborts once the body exceeds 2 x CSV_MAX_BYTES + 512 KiB.
    const res = await route(req);
    expect(res.status).toBe(413);
    expect((await res.json()).error.details.reason).toBe("payload_too_large");
  });

  it("does not leak internals", async () => {
    state.user = null;
    const text = await (await (await previewRoute())(post(PREVIEW, { csv: CSV }))).text();
    expect(text).not.toMatch(/stack|supabase\.co|test-publishable/i);
  });
});

describe("POST /api/imports/csv/commit", () => {
  const rowIdsOf = async () => {
    const res = await (await previewRoute())(post(PREVIEW, { csv: CSV }));
    return ((await res.json()).rows as { rowId: string }[]).map((r) => r.rowId);
  };
  const body = (rowIds: string[], extra: Record<string, unknown> = {}) => ({
    confirmed: true,
    idempotencyKey: "route-key-0001",
    csv: CSV,
    rowIds,
    ...extra,
  });

  it("commits for the VERIFIED owner and replays idempotently", async () => {
    const route = await commitRoute();
    const rowIds = await rowIdsOf();
    const res = await route(post(COMMIT, body(rowIds)));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ replayed: false, batch: { status: "committed", acceptedCount: 2 } });
    expect(state.db.tables.transactions.every((t) => t.user_id === OWNER_ID)).toBe(true);

    const again = await route(post(COMMIT, body(rowIds)));
    expect((await again.json()).replayed).toBe(true);
    expect(state.db.tables.transactions).toHaveLength(2);
  });

  it("401 / 403 / 400 guards write nothing", async () => {
    const route = await commitRoute();
    const rowIds = await rowIdsOf();
    state.user = null;
    expect((await route(post(COMMIT, body(rowIds)))).status).toBe(401);
    state.user = { id: OWNER_ID, is_anonymous: true };
    expect((await route(post(COMMIT, body(rowIds), {}))).status).toBe(403);
    expect((await route(post(COMMIT, body(rowIds, { confirmed: false })))).status).toBe(400);
    expect((await route(post(COMMIT, body(rowIds, { user_id: "someone-else" })))).status).toBe(400);
    expect((await route(post(COMMIT, body([])))).status).toBe(400);
    expect(state.db.writes).toEqual([]);
  });

  it("413 for an oversize CSV", async () => {
    vi.stubEnv("CSV_MAX_BYTES", "64");
    const res = await (await commitRoute())(post(COMMIT, body(["r1-00000000"], { csv: `${HEAD}\n${"1,".repeat(100)}` })));
    expect(res.status).toBe(413);
    expect(state.db.writes).toEqual([]);
  });

  it("500 with a typed reason when the atomic commit fails, and nothing is stored", async () => {
    const route = await commitRoute();
    const rowIds = await rowIdsOf();
    state.db.failNext = { table: "transactions", op: "insert", error: { code: "23514" } };
    const res = await route(post(COMMIT, body(rowIds)));
    expect(res.status).toBe(500);
    expect((await res.json()).error.details.reason).toBe("import_commit_failed");
    expect(state.db.tables.transactions).toEqual([]);
    expect(state.db.tables.import_batches).toEqual([]);
  });

  it("creates the service-role client only on commit, only after verification, and passes the session user id", async () => {
    const rowIds = await rowIdsOf();
    expect(admin.created).toBe(0); // preview never creates it
    state.user = null;
    expect((await (await commitRoute())(post(COMMIT, body(rowIds)))).status).toBe(401);
    expect(admin.created).toBe(0);
    state.user = { id: OWNER_ID, is_anonymous: true };
    expect((await (await commitRoute())(post(COMMIT, { ...body(rowIds), user_id: "22222222-2222-4222-8222-222222222222" }))).status).toBe(400);
    expect(state.db.rpcCalls).toHaveLength(0);
    const ok = await (await commitRoute())(post(COMMIT, body(rowIds)));
    expect(ok.status).toBe(200);
    expect(state.db.rpcCalls).toHaveLength(1);
    expect(state.db.rpcCalls[0]!.args.p_user_id).toBe(OWNER_ID);
  });
});
