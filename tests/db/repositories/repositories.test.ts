import { describe, expect, it } from "vitest";
import {
  clearGoal,
  createImportBatch,
  createRecurringItem,
  createTransaction,
  deactivateRecurringItem,
  deleteRecurringItem,
  deleteTransaction,
  getGoal,
  getImportBatch,
  getProfile,
  getRecurringItem,
  getTransaction,
  listImportBatches,
  listRecurringItems,
  listTransactions,
  updateProfile,
  updateRecurringItem,
  updateTransaction,
  upsertGoal,
} from "@/lib/db/repositories";
import { PAGE_MAX } from "@/lib/db/inputs";
import {
  batchRow,
  callsOf,
  createFakeClient,
  goalRow,
  hasCall,
  isOwnerScoped,
  makeOwner,
  OTHER_ID,
  OWNER_ID,
  profileRow,
  recurringRow,
  ROW_ID,
  transactionRow,
  type RecordedQuery,
} from "./support/fake-client";

const owner = makeOwner();
const MALICIOUS = [
  "%",
  "a,user_id.eq." + OTHER_ID,
  "x)",
  "or=(user_id.eq." + OTHER_ID + ")",
  "') OR 1=1 --",
  "*",
  "a\\b",
];

/** Every repository operation, with a responder that returns plausible data. */
const operations: { name: string; run: (c: ReturnType<typeof createFakeClient>["client"]) => Promise<unknown>; data: unknown }[] = [
  { name: "getProfile", run: (c) => getProfile(c, owner), data: profileRow() },
  { name: "updateProfile", run: (c) => updateProfile(c, owner, { displayName: "Lan" }), data: profileRow() },
  { name: "listTransactions", run: (c) => listTransactions(c, owner, { kind: "expense", search: "cafe", fromDate: "2026-11-01", toDate: "2026-11-30" }), data: [transactionRow()] },
  { name: "getTransaction", run: (c) => getTransaction(c, owner, ROW_ID), data: transactionRow() },
  { name: "createTransaction", run: (c) => createTransaction(c, owner, { occurredAt: "2026-11-20T00:00:00+07:00", kind: "expense", amountVnd: "1000" }), data: transactionRow() },
  { name: "updateTransaction", run: (c) => updateTransaction(c, owner, ROW_ID, { category: "food" }), data: transactionRow() },
  { name: "deleteTransaction", run: (c) => deleteTransaction(c, owner, ROW_ID), data: [{ id: ROW_ID }] },
  { name: "listRecurringItems", run: (c) => listRecurringItems(c, owner, { activeOnly: true }), data: [recurringRow()] },
  { name: "getRecurringItem", run: (c) => getRecurringItem(c, owner, ROW_ID), data: recurringRow() },
  { name: "createRecurringItem", run: (c) => createRecurringItem(c, owner, { label: "x", kind: "expense", amountVnd: "1", dayOfMonth: 1, startDate: "2026-01-01" }), data: recurringRow() },
  { name: "updateRecurringItem", run: (c) => updateRecurringItem(c, owner, ROW_ID, { label: "y" }), data: recurringRow() },
  { name: "deactivateRecurringItem", run: (c) => deactivateRecurringItem(c, owner, ROW_ID), data: recurringRow({ active: false }) },
  { name: "getGoal", run: (c) => getGoal(c, owner), data: goalRow() },
  { name: "upsertGoal", run: (c) => upsertGoal(c, owner, { name: "g", targetVnd: "100" }), data: goalRow() },
  { name: "clearGoal", run: (c) => clearGoal(c, owner), data: null },
  { name: "listImportBatches", run: (c) => listImportBatches(c, owner), data: [batchRow()] },
  { name: "getImportBatch", run: (c) => getImportBatch(c, owner, ROW_ID), data: batchRow() },
  { name: "createImportBatch", run: (c) => createImportBatch(c, owner, { idempotencyKey: "k", source: "csv" }), data: batchRow() },
];

describe("every query is explicitly owner-scoped (defence in depth beside RLS)", () => {
  it.each(operations)("$name filters by user_id from the OwnerContext", async ({ run, data }) => {
    // createImportBatch first looks the key up (must miss), then inserts.
    const fake = createFakeClient((q) => ({
      data: q.table === "import_batches" && hasCall(q, "eq", "idempotency_key", "k") ? null : data,
    }));
    await run(fake.client);
    expect(fake.queries.length).toBeGreaterThan(0);
    for (const q of fake.queries) {
      expect(isOwnerScoped(q, OWNER_ID), `${q.table}: ${JSON.stringify(q.calls)}`).toBe(true);
      expect(JSON.stringify(q.calls)).not.toContain(OTHER_ID);
    }
  });

  it("inserts and upserts carry user_id from the OwnerContext", async () => {
    const fake = createFakeClient(() => ({ data: transactionRow() }));
    await createTransaction(fake.client, owner, { occurredAt: "2026-11-20T00:00:00+07:00", kind: "income", amountVnd: "5" });
    const payload = callsOf(fake.queries[0]!, "insert")[0]!.args[0] as Record<string, unknown>;
    expect(payload.user_id).toBe(OWNER_ID);

    const g = createFakeClient(() => ({ data: goalRow() }));
    await upsertGoal(g.client, owner, { name: "g", targetVnd: "5" });
    const up = callsOf(g.queries[0]!, "upsert")[0]!;
    expect((up.args[0] as Record<string, unknown>).user_id).toBe(OWNER_ID);
    expect(up.args[1]).toEqual({ onConflict: "user_id" });
  });

  it("two different owners produce different scoping on the same call", async () => {
    const a = createFakeClient(() => ({ data: profileRow() }));
    const b = createFakeClient(() => ({ data: profileRow() }));
    await getProfile(a.client, makeOwner(OWNER_ID));
    await getProfile(b.client, makeOwner(OTHER_ID));
    expect(isOwnerScoped(a.queries[0]!, OWNER_ID)).toBe(true);
    expect(isOwnerScoped(a.queries[0]!, OTHER_ID)).toBe(false);
    expect(isOwnerScoped(b.queries[0]!, OTHER_ID)).toBe(true);
  });
});

describe("owner injection through input is rejected before any query", () => {
  const cases: [string, (c: ReturnType<typeof createFakeClient>["client"]) => Promise<unknown>][] = [
    ["createTransaction", (c) => createTransaction(c, owner, { occurredAt: "2026-11-20T00:00:00+07:00", kind: "expense", amountVnd: "1", user_id: "other" })],
    ["updateTransaction", (c) => updateTransaction(c, owner, ROW_ID, { category: "food", user_id: "other" })],
    ["createRecurringItem", (c) => createRecurringItem(c, owner, { label: "x", kind: "expense", amountVnd: "1", dayOfMonth: 1, startDate: "2026-01-01", user_id: "other" })],
    ["updateRecurringItem", (c) => updateRecurringItem(c, owner, ROW_ID, { active: false, user_id: "other" })],
    ["updateProfile", (c) => updateProfile(c, owner, { displayName: "x", user_id: "other" })],
    ["upsertGoal", (c) => upsertGoal(c, owner, { name: "g", targetVnd: "1", user_id: "other" })],
    ["createImportBatch", (c) => createImportBatch(c, owner, { idempotencyKey: "k", source: "csv", user_id: "other" })],
    ["listTransactions", (c) => listTransactions(c, owner, { user_id: "other" })],
    ["listRecurringItems", (c) => listRecurringItems(c, owner, { user_id: "other" })],
    ["listImportBatches", (c) => listImportBatches(c, owner, { userId: "other" })],
  ];
  it.each(cases)("%s", async (_n, run) => {
    const fake = createFakeClient(() => ({ data: null }));
    await expect(run(fake.client)).rejects.toMatchObject({ code: "validation_failed", safeDetails: { reason: "invalid_input" } });
    expect(fake.queries).toHaveLength(0);
  });

  it("row ids must be uuids; an id is never interpreted as an owner", async () => {
    const fake = createFakeClient();
    for (const bad of ["1 or 1=1", "other", `${ROW_ID},user_id.eq.${OTHER_ID}`, ""]) {
      await expect(getTransaction(fake.client, owner, bad)).rejects.toMatchObject({ code: "validation_failed" });
      await expect(deleteTransaction(fake.client, owner, bad)).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect(fake.queries).toHaveLength(0);
  });
});

describe("list filters and pagination", () => {
  it("builds the expected filter chain with VN-day boundaries and clamped range", async () => {
    const fake = createFakeClient(() => ({ data: [] }));
    const page = await listTransactions(fake.client, owner, {
      limit: 100000,
      offset: -1,
      kind: "income",
      category: "salary",
      fromDate: "2026-11-01",
      toDate: "2026-11-30",
    });
    const q = fake.queries[0]!;
    expect(hasCall(q, "eq", "kind", "income")).toBe(true);
    expect(hasCall(q, "eq", "category", "salary")).toBe(true);
    expect(hasCall(q, "gte", "occurred_at", "2026-11-01T00:00:00+07:00")).toBe(true);
    expect(hasCall(q, "lt", "occurred_at", "2026-12-01T00:00:00+07:00")).toBe(true);
    expect(callsOf(q, "range")[0]!.args).toEqual([0, PAGE_MAX]);
    expect(page).toMatchObject({ limit: PAGE_MAX, offset: 0, hasMore: false, items: [] });
  });

  it("defaults to 50 rows and reports hasMore using limit+1", async () => {
    const rows = Array.from({ length: 51 }, () => transactionRow());
    const fake = createFakeClient(() => ({ data: rows }));
    const page = await listTransactions(fake.client, owner);
    expect(callsOf(fake.queries[0]!, "range")[0]!.args).toEqual([0, 50]);
    expect(page.items).toHaveLength(50);
    expect(page.hasMore).toBe(true);
  });

  it.each(MALICIOUS)("search %j cannot alter the PostgREST filter", async (raw) => {
    const fake = createFakeClient(() => ({ data: [] }));
    // Some inputs sanitise to nothing and are rejected; the rest must be inert.
    try {
      await listTransactions(fake.client, owner, { search: raw });
    } catch (e) {
      expect((e as { reason: string }).reason).toBe("invalid_input");
      expect(fake.queries).toHaveLength(0);
      return;
    }
    const q = fake.queries[0]!;
    const or = callsOf(q, "or");
    expect(or).toHaveLength(1);
    const expr = or[0]!.args[0] as string;
    // exactly two predicates, each `col.ilike.%term%`, term made only of whitelisted chars
    expect(expr).toMatch(/^merchant\.ilike\.%[\p{L}\p{N} .'-]+%,description\.ilike\.%[\p{L}\p{N} .'-]+%$/u);
    expect(expr.split(",")).toHaveLength(2);
    expect(expr).not.toContain("user_id");
    expect(isOwnerScoped(q, OWNER_ID)).toBe(true);
  });

  it("injection-like category in a filter is rejected, not forwarded", async () => {
    const fake = createFakeClient();
    await expect(listTransactions(fake.client, owner, { category: "x,user_id.eq." + OTHER_ID })).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.queries).toHaveLength(0);
  });
});

describe("transactions", () => {
  it("create enforces the recurring pair before querying", async () => {
    const fake = createFakeClient();
    await expect(
      createTransaction(fake.client, owner, { occurredAt: "2026-11-20T00:00:00+07:00", kind: "expense", amountVnd: "1", recurringItemId: ROW_ID }),
    ).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.queries).toHaveLength(0);
  });

  it("create with a full pair passes both columns", async () => {
    const fake = createFakeClient(() => ({ data: transactionRow({ recurring_item_id: ROW_ID, recurring_instance_date: "2026-11-05" }) }));
    const created = await createTransaction(fake.client, owner, {
      occurredAt: "2026-11-05T09:00:00+07:00",
      kind: "expense",
      amountVnd: "1500000",
      recurringItemId: ROW_ID,
      recurringInstanceDate: "2026-11-05",
    });
    const payload = callsOf(fake.queries[0]!, "insert")[0]!.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ recurring_item_id: ROW_ID, recurring_instance_date: "2026-11-05", amount_vnd: "1500000" });
    expect(created.recurringInstanceDate).toBe("2026-11-05");
  });

  it("update/delete by id are scoped by user_id too, and a miss is not_found", async () => {
    const empty = createFakeClient(() => ({ data: null }));
    await expect(updateTransaction(empty.client, owner, ROW_ID, { category: "x" })).rejects.toMatchObject({ code: "not_found" });
    expect(hasCall(empty.queries[0]!, "eq", "id", ROW_ID)).toBe(true);
    expect(isOwnerScoped(empty.queries[0]!, OWNER_ID)).toBe(true);
    const none = createFakeClient(() => ({ data: [] }));
    await expect(deleteTransaction(none.client, owner, ROW_ID)).rejects.toMatchObject({ code: "not_found" });
    expect(isOwnerScoped(none.queries[0]!, OWNER_ID)).toBe(true);
  });

  it("maps database errors without leaking messages", async () => {
    const fake = createFakeClient(() => ({ error: { code: "23505", message: "duplicate key value (user=SECRET-ROW)" } }));
    const err = await createTransaction(fake.client, owner, { occurredAt: "2026-11-20T00:00:00+07:00", kind: "expense", amountVnd: "1" }).catch((e) => e);
    expect(err).toMatchObject({ httpStatus: 409, safeDetails: { reason: "db_conflict" } });
    expect(JSON.stringify({ m: err.userMessage, d: err.safeDetails, msg: err.message })).not.toContain("SECRET-ROW");
    expect(String(err.cause?.message)).not.toContain("SECRET-ROW");
  });

  it("rejects a malformed row returned by the database", async () => {
    const fake = createFakeClient(() => ({ data: [transactionRow({ amount_vnd: -5 })] }));
    await expect(listTransactions(fake.client, owner)).rejects.toMatchObject({ safeDetails: { reason: "db_row_invalid" } });
  });
});

describe("recurring items: deactivate, never delete", () => {
  it("deleteRecurringItem is unavailable and issues no query", async () => {
    const fake = createFakeClient();
    await expect(deleteRecurringItem(fake.client, owner, ROW_ID)).rejects.toMatchObject({
      reason: "recurring_delete_not_allowed",
      code: "forbidden",
      safeDetails: { reason: "recurring_delete_not_allowed" },
    });
    expect(fake.queries).toHaveLength(0);
  });

  it("deactivate updates only active=false, scoped by id and owner", async () => {
    const fake = createFakeClient(() => ({ data: recurringRow({ active: false }) }));
    const item = await deactivateRecurringItem(fake.client, owner, ROW_ID);
    const q = fake.queries[0]!;
    expect(callsOf(q, "update")[0]!.args[0]).toEqual({ active: false });
    expect(hasCall(q, "eq", "id", ROW_ID)).toBe(true);
    expect(isOwnerScoped(q, OWNER_ID)).toBe(true);
    expect(callsOf(q, "delete")).toHaveLength(0);
    expect(item.active).toBe(false);
  });

  it("no repository module issues .delete() on recurring_items", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync("src/lib/db/repositories/recurring.ts", "utf8");
    expect(src).not.toMatch(/\.delete\(/);
  });
});

describe("profile, goal, import batches", () => {
  it("getProfile returns null when no profile exists", async () => {
    const fake = createFakeClient(() => ({ data: null }));
    expect(await getProfile(fake.client, owner)).toBeNull();
  });

  it("updateProfile reports profile_missing when nothing matched", async () => {
    const fake = createFakeClient(() => ({ data: null }));
    await expect(updateProfile(fake.client, owner, { displayName: "x" })).rejects.toMatchObject({ safeDetails: { reason: "profile_missing" } });
  });

  it("one goal per user: upsert on user_id, clear is scoped", async () => {
    const fake = createFakeClient(() => ({ data: goalRow() }));
    const goal = await upsertGoal(fake.client, owner, { name: " Laptop ", targetVnd: "15000000", savedVnd: "100", targetDate: "2027-03-01" });
    expect(callsOf(fake.queries[0]!, "upsert")[0]!.args[0]).toEqual({ user_id: OWNER_ID, name: "Laptop", target_vnd: "15000000", saved_vnd: "100", target_date: "2027-03-01" });
    expect(goal.targetVnd).toBe(15000000n);
    await clearGoal(fake.client, owner);
    expect(hasCall(fake.queries[1]!, "delete")).toBe(true);
    expect(isOwnerScoped(fake.queries[1]!, OWNER_ID)).toBe(true);
  });

  it("createImportBatch is idempotent per key (existing -> created:false, no insert)", async () => {
    const fake = createFakeClient(() => ({ data: batchRow() }));
    const res = await createImportBatch(fake.client, owner, { idempotencyKey: "key-1", source: "csv" });
    expect(res.created).toBe(false);
    expect(fake.queries).toHaveLength(1);
    expect(hasCall(fake.queries[0]!, "eq", "idempotency_key", "key-1")).toBe(true);
  });

  it("createImportBatch inserts when new, and returns the winner on a unique-key race", async () => {
    let n = 0;
    const fresh = createFakeClient((q) => (hasCall(q, "insert") ? { data: batchRow() } : { data: null }));
    const created = await createImportBatch(fresh.client, owner, { idempotencyKey: "new", source: "receipt", acceptedCount: 3 });
    expect(created.created).toBe(true);
    expect((callsOf(fresh.queries[1]!, "insert")[0]!.args[0] as Record<string, unknown>).user_id).toBe(OWNER_ID);

    const race = createFakeClient((q) => {
      if (hasCall(q, "insert")) return { error: { code: "23505" } };
      n += 1;
      return { data: n === 1 ? null : batchRow() };
    });
    const res = await createImportBatch(race.client, owner, { idempotencyKey: "key-1", source: "csv" });
    expect(res.created).toBe(false);
  });

  it("import batch input is validated", async () => {
    const fake = createFakeClient();
    await expect(createImportBatch(fake.client, owner, { idempotencyKey: "", source: "csv" })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createImportBatch(fake.client, owner, { idempotencyKey: "k", source: "zip" })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(createImportBatch(fake.client, owner, { idempotencyKey: "k", source: "csv", acceptedCount: -1 })).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.queries).toHaveLength(0);
  });
});

export type { RecordedQuery };
