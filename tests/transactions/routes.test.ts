import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balanceAt } from "@/lib/finance";
import { mapProfileRow, mapTransactionRow } from "@/lib/db/mappers";
import { profileRow } from "../db/repositories/support/fake-client";
import { transactionFingerprint } from "@/lib/transactions/fingerprint";
import { queriesOn, writesOf, type Row } from "./support/fake-db";
import {
  ITEM_ID,
  NOW,
  ORIGIN,
  OTHER_ID,
  OWNER_ID,
  TX_ID,
  foreign,
  harness,
  idContext,
  owned,
  request,
  resetHarness,
  seedItem,
  seedTx,
} from "./support/harness";

vi.mock("@/lib/db/server", async () => {
  const { harness: h } = await import("./support/harness");
  return {
    createSupabaseServerClient: async () => {
      const client = h.db.fake.client as unknown as { from: (t: string) => unknown };
      return {
        auth: { getUser: async () => ({ data: { user: h.user }, error: null }) },
        from: (t: string) => client.from(t),
      };
    },
  };
});
// The service-role client must never be used by these routes.
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => {
    throw new Error("admin client must not be used by transactions/recurring routes");
  },
}));

const FOREIGN_TX_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const FOREIGN_ITEM_ID = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const MISSING_ID = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";

const validTx = (over: Record<string, unknown> = {}) => ({
  occurredAt: "2026-11-20T05:30:00Z",
  kind: "expense",
  amountVnd: "45000",
  category: "food",
  merchant: "  Canteen ",
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted structurally
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, any>;

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", ORIGIN);
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  resetHarness();
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("GET /api/transactions", () => {
  it("returns 401 without a verified session and reads nothing", async () => {
    resetHarness({}, null);
    const { GET } = await import("@/app/api/transactions/route");
    const res = await GET(request("GET", "/api/transactions"));
    expect(res.status).toBe(401);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it("lists only the caller's rows, newest first, with string amounts", async () => {
    resetHarness({
      transactions: [
        seedTx({ id: TX_ID, occurred_at: "2026-11-20T05:30:00+00:00" }),
        owned(seedTx({ id: "ffffffff-ffff-4fff-8fff-ffffffffffff", occurred_at: "2026-11-21T05:30:00+00:00", amount_vnd: "9007199254740991" })),
        foreign(seedTx({ id: FOREIGN_TX_ID })),
      ],
    });
    const { GET } = await import("@/app/api/transactions/route");
    const res = await GET(request("GET", "/api/transactions"));
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(["ffffffff-ffff-4fff-8fff-ffffffffffff", TX_ID]);
    expect(body.items[0].amountVnd).toBe("9007199254740991");
    expect(typeof body.items[1].amountVnd).toBe("string");
    expect(JSON.stringify(body)).not.toContain(OTHER_ID);
    expect(JSON.stringify(body)).not.toContain("user_id");
    for (const q of queriesOn(harness.db, "transactions")) {
      expect(q.calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === OWNER_ID)).toBe(true);
    }
  });

  it("uses the session user, not any id in the URL", async () => {
    resetHarness({ transactions: [seedTx(), foreign(seedTx({ id: FOREIGN_TX_ID }))] }, { id: OTHER_ID, is_anonymous: false });
    harness.db.tables.financial_profiles!.push(foreign(profileRow()));
    const { GET } = await import("@/app/api/transactions/route");
    const res = await GET(request("GET", `/api/transactions?user_id=${OWNER_ID}`));
    expect(res.status).toBe(400); // unknown query key rejected
    const ok = await json(await GET(request("GET", "/api/transactions")));
    expect(ok.items.map((i: { id: string }) => i.id)).toEqual([FOREIGN_TX_ID]);
  });

  it("applies filters and pagination", async () => {
    resetHarness({
      transactions: [
        seedTx({ id: "00000000-0000-4000-8000-0000000000a1", occurred_at: "2026-11-20T05:00:00+00:00" }),
        seedTx({ id: "00000000-0000-4000-8000-0000000000a2", occurred_at: "2026-11-21T05:00:00+00:00" }),
        seedTx({ id: "00000000-0000-4000-8000-0000000000a3", occurred_at: "2026-11-22T05:00:00+00:00", kind: "income" }),
      ],
    });
    const { GET } = await import("@/app/api/transactions/route");
    const page = await json(await GET(request("GET", "/api/transactions?kind=expense&limit=1&offset=0&category=food&fromDate=2026-11-01&toDate=2026-11-30&search=canteen")));
    expect(page.items).toHaveLength(1);
    expect(page.limit).toBe(1);
    const q = queriesOn(harness.db, "transactions").at(-1)!;
    const methods = q.calls.map((c) => c.method);
    expect(methods).toEqual(expect.arrayContaining(["eq", "gte", "lt", "or", "range"]));
    expect(q.calls.some((c) => c.method === "eq" && c.args[0] === "kind" && c.args[1] === "expense")).toBe(true);
  });

  it("rejects bad filters with 400", async () => {
    const { GET } = await import("@/app/api/transactions/route");
    expect((await GET(request("GET", "/api/transactions?kind=bogus"))).status).toBe(400);
    expect((await GET(request("GET", "/api/transactions?fromDate=2026-13-45"))).status).toBe(400);
    expect((await GET(request("GET", "/api/transactions?fromDate=2026-11-30&toDate=2026-11-01"))).status).toBe(400);
    expect((await GET(request("GET", "/api/transactions?limit=abc"))).status).toBe(400);
  });
});

describe("POST /api/transactions", () => {
  it("creates an owned row, computes the fingerprint on the server, and reports impact", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    const res = await POST(request("POST", "/api/transactions", validTx()));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.transaction).toMatchObject({ kind: "expense", amountVnd: "45000", merchant: "Canteen", source: "manual", localDate: "2026-11-20" });
    expect(body.impact).toMatchObject({ affectsCurrentBalance: true, isHistoricalOnly: false, isFuture: false, reason: "counted_in_balance", balanceDeltaVnd: "-45000" });
    expect(body.transaction).not.toHaveProperty("fingerprint");
    const stored = harness.db.tables.transactions![0]!;
    expect(stored.user_id).toBe(OWNER_ID);
    expect(stored.fingerprint).toBe(
      transactionFingerprint({ occurredAt: new Date("2026-11-20T05:30:00Z"), kind: "expense", amountVnd: 45000n, merchant: "Canteen" }),
    );
  });

  it("takes the owner from the verified session for any caller", async () => {
    resetHarness({}, { id: OTHER_ID, is_anonymous: false });
    harness.db.tables.financial_profiles!.push(foreign(profileRow()));
    const { POST } = await import("@/app/api/transactions/route");
    expect((await POST(request("POST", "/api/transactions", validTx()))).status).toBe(201);
    expect(harness.db.tables.transactions![0]!.user_id).toBe(OTHER_ID);
  });

  it("flags a pre-snapshot transaction as historical-only (AC-04) and leaves the engine balance unchanged (AC-05)", async () => {
    const profile = mapProfileRow(profileRow());
    const before = balanceAt(profile, [], NOW);
    const { POST } = await import("@/app/api/transactions/route");
    const res = await POST(request("POST", "/api/transactions", validTx({ occurredAt: "2026-11-10T05:00:00Z", amountVnd: "800000" })));
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.impact).toMatchObject({ affectsCurrentBalance: false, isHistoricalOnly: true, reason: "before_snapshot", balanceDeltaVnd: "0" });
    expect(body.impact.messageVi).toMatch(/phân tích/);
    const stored = harness.db.tables.transactions!.map(mapTransactionRow);
    expect(balanceAt(profile, stored, NOW)).toBe(before);
  });

  it("a post-snapshot row changes the engine balance by exactly impact.balanceDeltaVnd", async () => {
    const profile = mapProfileRow(profileRow());
    const before = balanceAt(profile, [], NOW);
    const { POST } = await import("@/app/api/transactions/route");
    const body = await json(await POST(request("POST", "/api/transactions", validTx({ kind: "income", amountVnd: "1000000" }))));
    const after = balanceAt(profile, harness.db.tables.transactions!.map(mapTransactionRow), NOW);
    expect(after - before).toBe(BigInt(body.impact.balanceDeltaVnd));
    expect(body.impact.balanceDeltaVnd).toBe("1000000");
  });

  it("treats a row exactly at the snapshot instant as not counted", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    const body = await json(await POST(request("POST", "/api/transactions", validTx({ occurredAt: "2026-11-15T10:00:00+07:00" }))));
    expect(body.impact).toMatchObject({ affectsCurrentBalance: false, isHistoricalOnly: true });
  });

  it("flags future-dated rows and excluded rows as not affecting the balance", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    const future = await json(await POST(request("POST", "/api/transactions", validTx({ occurredAt: "2026-12-05T05:00:00Z" }))));
    expect(future.impact).toMatchObject({ affectsCurrentBalance: false, isFuture: true, reason: "future_dated" });
    const excluded = await json(await POST(request("POST", "/api/transactions", validTx({ kind: "excluded" }))));
    expect(excluded.impact).toMatchObject({ affectsCurrentBalance: false, reason: "excluded", balanceDeltaVnd: "0" });
  });

  it("returns 401 without a session and 403 for a missing or foreign origin, writing nothing", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    expect((await POST(request("POST", "/api/transactions", validTx(), {}))).status).toBe(403);
    expect((await POST(request("POST", "/api/transactions", validTx(), { origin: "https://evil.example.com" }))).status).toBe(403);
    resetHarness({}, null);
    expect((await POST(request("POST", "/api/transactions", validTx()))).status).toBe(401);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it.each([
    ["user_id", { user_id: OTHER_ID }],
    ["userId", { userId: OTHER_ID }],
    ["owner_id", { owner_id: OTHER_ID }],
    ["fingerprint", { fingerprint: "forged" }],
    ["importBatchId", { importBatchId: ITEM_ID }],
    ["source csv", { source: "csv" }],
    ["source seed", { source: "seed" }],
    ["zero amount", { amountVnd: "0" }],
    ["negative amount", { amountVnd: "-5" }],
    ["numeric amount", { amountVnd: 45000 }],
    ["decimal amount", { amountVnd: "45000.5" }],
    ["bad kind", { kind: "refund" }],
    ["offsetless instant", { occurredAt: "2026-11-20T05:30:00" }],
    ["bad category", { category: "a;b,c" }],
    ["only item id", { recurringItemId: ITEM_ID }],
    ["only instance date", { recurringInstanceDate: "2026-11-05" }],
  ])("rejects %s with 400 and writes nothing", async (_name, extra) => {
    const { POST } = await import("@/app/api/transactions/route");
    const res = await POST(request("POST", "/api/transactions", validTx(extra)));
    expect(res.status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("rejects malformed, array and oversize bodies with 400", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    expect((await POST(request("POST", "/api/transactions", "{not json"))).status).toBe(400);
    expect((await POST(request("POST", "/api/transactions", "[]"))).status).toBe(400);
    expect((await POST(request("POST", "/api/transactions", validTx({ description: "x".repeat(20_000) })))).status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("returns 404 when the caller has no profile (impact cannot be computed)", async () => {
    resetHarness();
    harness.db.tables.financial_profiles = [];
    const { POST } = await import("@/app/api/transactions/route");
    const res = await POST(request("POST", "/api/transactions", validTx()));
    expect(res.status).toBe(404);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("never leaks internals in error bodies", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    const text = await (await POST(request("POST", "/api/transactions", validTx({ user_id: OTHER_ID })))).text();
    expect(text).not.toMatch(/stack|supabase\.co|test-publishable|bigint/i);
  });
});

describe("POST /api/transactions with a recurring link", () => {
  const linked = (date: string, over: Record<string, unknown> = {}) =>
    validTx({ kind: "expense", amountVnd: "1500000", category: "rent", merchant: "Landlord", recurringItemId: ITEM_ID, recurringInstanceDate: date, ...over });

  beforeEach(() => resetHarness({ recurring_items: [seedItem()] }));

  it("links to a real occurrence of the caller's item", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    const res = await POST(request("POST", "/api/transactions", linked("2026-11-05")));
    expect(res.status).toBe(201);
    expect((await json(res)).transaction).toMatchObject({ recurringItemId: ITEM_ID, recurringInstanceDate: "2026-11-05" });
  });

  it("returns 409 db_conflict when that occurrence is already posted", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    expect((await POST(request("POST", "/api/transactions", linked("2026-11-05")))).status).toBe(201);
    const dup = await POST(request("POST", "/api/transactions", linked("2026-11-05", { occurredAt: "2026-11-06T05:00:00Z" })));
    expect(dup.status).toBe(409);
    const body = await json(dup);
    expect(body.error.details).toMatchObject({ reason: "db_conflict", constraint: "recurring_posting" });
    expect(harness.db.tables.transactions).toHaveLength(1);
  });

  it("does not trust the id: another user's recurring item is rejected like a missing one", async () => {
    resetHarness({ recurring_items: [foreign(seedItem({ id: FOREIGN_ITEM_ID }))] });
    const { POST } = await import("@/app/api/transactions/route");
    const foreignRes = await POST(request("POST", "/api/transactions", linked("2026-11-05", { recurringItemId: FOREIGN_ITEM_ID })));
    const missingRes = await POST(request("POST", "/api/transactions", linked("2026-11-05", { recurringItemId: MISSING_ID })));
    expect(foreignRes.status).toBe(400);
    expect(await json(foreignRes)).toEqual(await json(missingRes));
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("rejects a date that is not an occurrence, and a kind mismatch", async () => {
    const { POST } = await import("@/app/api/transactions/route");
    const notOcc = await POST(request("POST", "/api/transactions", linked("2026-11-06")));
    expect(notOcc.status).toBe(400);
    expect((await json(notOcc)).error.details).toMatchObject({ field: "recurringInstanceDate", rule: "not_an_occurrence" });
    const kind = await POST(request("POST", "/api/transactions", linked("2026-11-05", { kind: "income" })));
    expect(kind.status).toBe(400);
    expect((await json(kind)).error.details).toMatchObject({ field: "kind", rule: "recurring_kind_mismatch" });
    const before = await POST(request("POST", "/api/transactions", linked("2025-12-05")));
    expect(before.status).toBe(400); // before the item's start date
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("accepts a past occurrence of a since-deactivated item", async () => {
    resetHarness({ recurring_items: [seedItem({ active: false })] });
    const { POST } = await import("@/app/api/transactions/route");
    expect((await POST(request("POST", "/api/transactions", linked("2026-11-05")))).status).toBe(201);
  });

  describe("day-of-month clamping", () => {
    const day31 = () => resetHarness({ recurring_items: [seedItem({ day_of_month: 31, start_date: "2026-01-31" })] });
    it.each([
      ["2026-02-28", 201], // non-leap Feb clamps to 28
      ["2026-02-27", 400],
      ["2026-02-31", 400], // not a calendar date
      ["2026-04-30", 201], // 30-day month
      ["2026-04-29", 400],
      ["2026-03-31", 201],
      ["2028-02-29", 201], // leap Feb clamps to 29
      ["2028-02-28", 400],
    ])("instance %s -> %i", async (date, status) => {
      day31();
      const { POST } = await import("@/app/api/transactions/route");
      const res = await POST(request("POST", "/api/transactions", linked(date, { occurredAt: `${date.slice(0, 7)}-15T05:00:00Z` })));
      expect(res.status).toBe(status);
    });
  });
});

describe("PATCH /api/transactions/[id]", () => {
  beforeEach(() => resetHarness({ transactions: [seedTx({ fingerprint: "old" })] }));

  it("updates the caller's row, recomputes the fingerprint for manual rows and reports impact", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const res = await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { amountVnd: "50000", merchant: "Cafe" }), idContext(TX_ID));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.transaction).toMatchObject({ id: TX_ID, amountVnd: "50000", merchant: "Cafe" });
    expect(body.impact).toMatchObject({ affectsCurrentBalance: true, balanceDeltaVnd: "-50000" });
    expect(harness.db.tables.transactions![0]!.fingerprint).toBe(
      transactionFingerprint({ occurredAt: new Date("2026-11-20T05:30:00Z"), kind: "expense", amountVnd: 50000n, merchant: "Cafe" }),
    );
  });

  it("moving a row before the snapshot reports historical-only and the engine balance ignores it", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const body = await json(await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { occurredAt: "2026-11-01T05:00:00Z" }), idContext(TX_ID)));
    expect(body.impact).toMatchObject({ isHistoricalOnly: true, affectsCurrentBalance: false });
    const profile = mapProfileRow(profileRow());
    expect(balanceAt(profile, harness.db.tables.transactions!.map(mapTransactionRow), NOW)).toBe(balanceAt(profile, [], NOW));
  });

  it("keeps the import fingerprint of csv rows", async () => {
    resetHarness({ transactions: [seedTx({ source: "csv", fingerprint: "csv-fp" })] });
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { amountVnd: "60000" }), idContext(TX_ID))).status).toBe(200);
    expect(harness.db.tables.transactions![0]!.fingerprint).toBe("csv-fp");
  });

  it("answers 404 for a foreign id exactly as for a missing id, and changes nothing", async () => {
    resetHarness({ transactions: [foreign(seedTx({ id: FOREIGN_TX_ID, fingerprint: "keep" }))] });
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    const a = await PATCH(request("PATCH", `/api/transactions/${FOREIGN_TX_ID}`, { amountVnd: "1" }), idContext(FOREIGN_TX_ID));
    const b = await PATCH(request("PATCH", `/api/transactions/${MISSING_ID}`, { amountVnd: "1" }), idContext(MISSING_ID));
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(await json(a)).toEqual(await json(b));
    expect(harness.db.tables.transactions![0]).toMatchObject({ amount_vnd: 45000, fingerprint: "keep" });
  });

  it("rejects smuggled owner keys, empty bodies and a bad id with 400", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    for (const body of [{ user_id: OTHER_ID }, { owner_id: OTHER_ID }, { fingerprint: "x" }, { source: "csv" }, {}, { recurringItemId: ITEM_ID }]) {
      expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, body), idContext(TX_ID))).status).toBe(400);
    }
    expect((await PATCH(request("PATCH", "/api/transactions/not-a-uuid", { amountVnd: "1" }), idContext("not-a-uuid"))).status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("returns 401 and 403 before touching data", async () => {
    const { PATCH } = await import("@/app/api/transactions/[id]/route");
    expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { amountVnd: "1" }, {}), idContext(TX_ID))).status).toBe(403);
    harness.user = null;
    expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { amountVnd: "1" }), idContext(TX_ID))).status).toBe(401);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  describe("recurring link", () => {
    beforeEach(() => resetHarness({ recurring_items: [seedItem()], transactions: [seedTx({ amount_vnd: 1500000, category: "rent" })] }));
    const link = (date: string) => ({ recurringItemId: ITEM_ID, recurringInstanceDate: date });

    it("links and unlinks", async () => {
      const { PATCH } = await import("@/app/api/transactions/[id]/route");
      const linked = await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, link("2026-11-05")), idContext(TX_ID));
      expect(linked.status).toBe(200);
      expect((await json(linked)).transaction).toMatchObject(link("2026-11-05"));
      const unlinked = await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { recurringItemId: null, recurringInstanceDate: null }), idContext(TX_ID));
      expect((await json(unlinked)).transaction).toMatchObject({ recurringItemId: null, recurringInstanceDate: null });
    });

    it("validates occurrence, kind and ownership on edit", async () => {
      const { PATCH } = await import("@/app/api/transactions/[id]/route");
      expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, link("2026-11-06")), idContext(TX_ID))).status).toBe(400);
      expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { ...link("2026-11-05"), kind: "income" }), idContext(TX_ID))).status).toBe(400);
      resetHarness({ recurring_items: [foreign(seedItem({ id: FOREIGN_ITEM_ID }))], transactions: [seedTx()] });
      expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { recurringItemId: FOREIGN_ITEM_ID, recurringInstanceDate: "2026-11-05" }), idContext(TX_ID))).status).toBe(400);
    });

    it("rechecks the kind when an already linked row changes kind", async () => {
      resetHarness({
        recurring_items: [seedItem()],
        transactions: [seedTx({ recurring_item_id: ITEM_ID, recurring_instance_date: "2026-11-05" })],
      });
      const { PATCH } = await import("@/app/api/transactions/[id]/route");
      expect((await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, { kind: "income" }), idContext(TX_ID))).status).toBe(400);
    });

    it("returns 409 when the occurrence is already posted by another row", async () => {
      resetHarness({
        recurring_items: [seedItem()],
        transactions: [
          seedTx({ id: "00000000-0000-4000-8000-0000000000b1", recurring_item_id: ITEM_ID, recurring_instance_date: "2026-11-05" }),
          seedTx({ id: TX_ID }),
        ],
      });
      const { PATCH } = await import("@/app/api/transactions/[id]/route");
      const res = await PATCH(request("PATCH", `/api/transactions/${TX_ID}`, link("2026-11-05")), idContext(TX_ID));
      expect(res.status).toBe(409);
      expect((await json(res)).error.details).toMatchObject({ reason: "db_conflict" });
    });
  });
});

describe("DELETE /api/transactions/[id]", () => {
  beforeEach(() => resetHarness({ transactions: [seedTx(), foreign(seedTx({ id: FOREIGN_TX_ID }))] }));

  it("deletes only with {confirm:true}", async () => {
    const { DELETE } = await import("@/app/api/transactions/[id]/route");
    const res = await DELETE(request("DELETE", `/api/transactions/${TX_ID}`, { confirm: true }), idContext(TX_ID));
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ deleted: true, id: TX_ID });
    expect(harness.db.tables.transactions!.map((r) => r.id)).toEqual([FOREIGN_TX_ID]);
  });

  it.each([
    ["no body", undefined],
    ["empty object", {}],
    ["confirm false", { confirm: false }],
    ["confirm string", { confirm: "true" }],
    ["extra keys", { confirm: true, user_id: OTHER_ID }],
  ])("rejects %s and deletes nothing", async (_name, body) => {
    const { DELETE } = await import("@/app/api/transactions/[id]/route");
    const res = await DELETE(request("DELETE", `/api/transactions/${TX_ID}`, body), idContext(TX_ID));
    expect(res.status).toBe(400);
    expect(harness.db.tables.transactions).toHaveLength(2);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("answers 404 for a foreign id exactly like a missing id and deletes nothing", async () => {
    const { DELETE } = await import("@/app/api/transactions/[id]/route");
    const a = await DELETE(request("DELETE", `/api/transactions/${FOREIGN_TX_ID}`, { confirm: true }), idContext(FOREIGN_TX_ID));
    const b = await DELETE(request("DELETE", `/api/transactions/${MISSING_ID}`, { confirm: true }), idContext(MISSING_ID));
    expect(a.status).toBe(404);
    expect(await json(a)).toEqual(await json(b));
    expect(harness.db.tables.transactions).toHaveLength(2);
    // The delete itself was scoped to the caller.
    const del = writesOf(harness.db).find((q) => q.calls.some((c) => c.method === "delete"))!;
    expect(del.calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === OWNER_ID)).toBe(true);
  });

  it("returns 403 for a bad origin and 401 without a session", async () => {
    const { DELETE } = await import("@/app/api/transactions/[id]/route");
    expect((await DELETE(request("DELETE", `/api/transactions/${TX_ID}`, { confirm: true }, {}), idContext(TX_ID))).status).toBe(403);
    harness.user = null;
    expect((await DELETE(request("DELETE", `/api/transactions/${TX_ID}`, { confirm: true }), idContext(TX_ID))).status).toBe(401);
    expect(harness.db.tables.transactions).toHaveLength(2);
  });
});

describe("recurring routes", () => {
  const newItem = (over: Record<string, unknown> = {}) => ({
    label: "Netflix",
    kind: "expense",
    amountVnd: "260000",
    dayOfMonth: 12,
    category: "entertainment",
    startDate: "2026-01-12",
    ...over,
  });

  it("GET lists only the caller's items with string amounts and proposes unlinked matches without linking", async () => {
    resetHarness({
      recurring_items: [
        seedItem({ day_of_month: 20, start_date: "2026-01-20" }),
        foreign(seedItem({ id: FOREIGN_ITEM_ID })),
      ],
      transactions: [seedTx({ id: TX_ID, occurred_at: "2026-11-21T05:00:00+00:00", amount_vnd: 1_480_000, category: "rent" })],
    });
    const { GET } = await import("@/app/api/recurring/route");
    const res = await GET(request("GET", "/api/recurring"));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ id: ITEM_ID, amountVnd: "1500000", active: true });
    expect(body.suggestionsAvailable).toBe(true);
    expect(body.unreconciledSuggestions).toHaveLength(1);
    expect(body.unreconciledSuggestions[0]).toMatchObject({ itemId: ITEM_ID, instanceDate: "2026-11-20", expectedAmountVnd: "1500000" });
    expect(body.unreconciledSuggestions[0].candidates[0]).toMatchObject({ transactionId: TX_ID, dayDistance: 1, amountDifferenceVnd: "20000" });
    expect(JSON.stringify(body)).not.toContain(FOREIGN_ITEM_ID);
    expect(writesOf(harness.db)).toHaveLength(0); // suggestions never write
    expect(harness.db.tables.transactions![0]!.recurring_item_id ?? null).toBeNull();
  });

  it("GET still lists items when the caller has no profile, with suggestionsAvailable=false", async () => {
    resetHarness({ recurring_items: [seedItem()] });
    harness.db.tables.financial_profiles = [];
    const { GET } = await import("@/app/api/recurring/route");
    const body = await json(await GET(request("GET", "/api/recurring")));
    expect(body.items).toHaveLength(1);
    expect(body).toMatchObject({ unreconciledSuggestions: [], suggestionsAvailable: false });
  });

  it("GET supports activeOnly and returns 401 without a session", async () => {
    resetHarness({ recurring_items: [seedItem(), seedItem({ id: FOREIGN_ITEM_ID, active: false })] });
    const { GET } = await import("@/app/api/recurring/route");
    const body = await json(await GET(request("GET", "/api/recurring?activeOnly=true")));
    expect(body.items.map((i: { id: string }) => i.id)).toEqual([ITEM_ID]);
    expect((await GET(request("GET", "/api/recurring?activeOnly=maybe"))).status).toBe(400);
    harness.user = null;
    expect((await GET(request("GET", "/api/recurring"))).status).toBe(401);
  });

  it("POST creates an owned item and returns 201", async () => {
    const { POST } = await import("@/app/api/recurring/route");
    const res = await POST(request("POST", "/api/recurring", newItem()));
    expect(res.status).toBe(201);
    expect((await json(res)).item).toMatchObject({ label: "Netflix", amountVnd: "260000", dayOfMonth: 12, active: true });
    expect(harness.db.tables.recurring_items![0]!.user_id).toBe(OWNER_ID);
  });

  it.each([
    ["user_id", { user_id: OTHER_ID }],
    ["owner_id", { owner_id: OTHER_ID }],
    ["day 32", { dayOfMonth: 32 }],
    ["numeric amount", { amountVnd: 260000 }],
    ["zero amount", { amountVnd: "0" }],
    ["bad kind", { kind: "excluded" }],
  ])("POST rejects %s with 400", async (_name, extra) => {
    const { POST } = await import("@/app/api/recurring/route");
    expect((await POST(request("POST", "/api/recurring", newItem(extra)))).status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("POST returns 403 for a bad origin and 401 without a session", async () => {
    const { POST } = await import("@/app/api/recurring/route");
    expect((await POST(request("POST", "/api/recurring", newItem(), {}))).status).toBe(403);
    harness.user = null;
    expect((await POST(request("POST", "/api/recurring", newItem()))).status).toBe(401);
  });

  describe("PATCH /api/recurring/[id]", () => {
    beforeEach(() => resetHarness({ recurring_items: [seedItem(), foreign(seedItem({ id: FOREIGN_ITEM_ID }))] }));

    it("edits fields and soft-deactivates with active=false (row is kept)", async () => {
      const { PATCH } = await import("@/app/api/recurring/[id]/route");
      const edit = await PATCH(request("PATCH", `/api/recurring/${ITEM_ID}`, { amountVnd: "1600000", dayOfMonth: 31 }), idContext(ITEM_ID));
      expect(edit.status).toBe(200);
      expect((await json(edit)).item).toMatchObject({ amountVnd: "1600000", dayOfMonth: 31 });
      const off = await PATCH(request("PATCH", `/api/recurring/${ITEM_ID}`, { active: false }), idContext(ITEM_ID));
      expect((await json(off)).item.active).toBe(false);
      expect(harness.db.tables.recurring_items).toHaveLength(2);
    });

    it("answers 404 for a foreign id like a missing id", async () => {
      const { PATCH } = await import("@/app/api/recurring/[id]/route");
      const a = await PATCH(request("PATCH", `/api/recurring/${FOREIGN_ITEM_ID}`, { active: false }), idContext(FOREIGN_ITEM_ID));
      const b = await PATCH(request("PATCH", `/api/recurring/${MISSING_ID}`, { active: false }), idContext(MISSING_ID));
      expect(a.status).toBe(404);
      expect(await json(a)).toEqual(await json(b));
      expect(harness.db.tables.recurring_items!.find((r) => r.id === FOREIGN_ITEM_ID)!.active).toBe(true);
    });

    it("locks the kind once transactions reference the item", async () => {
      harness.db.tables.transactions!.push(seedTx({ recurring_item_id: ITEM_ID, recurring_instance_date: "2026-11-05" }) as Row);
      const { PATCH } = await import("@/app/api/recurring/[id]/route");
      const res = await PATCH(request("PATCH", `/api/recurring/${ITEM_ID}`, { kind: "income" }), idContext(ITEM_ID));
      expect(res.status).toBe(400);
      expect((await json(res)).error.details).toMatchObject({ rule: "recurring_kind_locked" });
    });

    it("rejects smuggled keys, empty bodies, bad origin and no session", async () => {
      const { PATCH } = await import("@/app/api/recurring/[id]/route");
      for (const body of [{ user_id: OTHER_ID }, { owner_id: OTHER_ID }, {}]) {
        expect((await PATCH(request("PATCH", `/api/recurring/${ITEM_ID}`, body), idContext(ITEM_ID))).status).toBe(400);
      }
      expect((await PATCH(request("PATCH", `/api/recurring/${ITEM_ID}`, { active: false }, {}), idContext(ITEM_ID))).status).toBe(403);
      harness.user = null;
      expect((await PATCH(request("PATCH", `/api/recurring/${ITEM_ID}`, { active: false }), idContext(ITEM_ID))).status).toBe(401);
    });
  });

  it("exposes no DELETE handler: recurring items are deactivated, never deleted", async () => {
    const mod = (await import("@/app/api/recurring/[id]/route")) as Record<string, unknown>;
    expect(mod.DELETE).toBeUndefined();
    const list = (await import("@/app/api/recurring/route")) as Record<string, unknown>;
    expect(list.DELETE).toBeUndefined();
  });
});

describe("route module configuration", () => {
  it.each([
    "@/app/api/transactions/route",
    "@/app/api/transactions/[id]/route",
    "@/app/api/recurring/route",
    "@/app/api/recurring/[id]/route",
  ])("%s runs on Node and is never cached", async (path) => {
    const mod = (await import(path)) as Record<string, unknown>;
    expect(mod.runtime).toBe("nodejs");
    expect(mod.dynamic).toBe("force-dynamic");
  });
});
