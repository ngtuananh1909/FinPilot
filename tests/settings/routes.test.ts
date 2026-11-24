import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { balanceAt } from "@/lib/finance";
import { mapProfileRow, mapTransactionRow } from "@/lib/db/mappers";
import { getSettingsForOwner } from "@/lib/settings/service";
import { makeOwner } from "../db/repositories/support/fake-client";
import {
  NOW,
  ORIGIN,
  OTHER_ID,
  OWNER_ID,
  foreign,
  goalRow,
  harness,
  owned,
  profileRow,
  queriesOn,
  recurringRow,
  request,
  resetHarness,
  seedItem,
  transactionRow,
  writesOf,
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

// The service-role client must never be used by the settings routes.
vi.mock("@/lib/db/admin", () => ({
  createSupabaseAdminClient: () => {
    throw new Error("admin client must not be used by settings routes");
  },
}));

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- test helper: bodies are asserted structurally
const json = async (res: Response) => JSON.parse(await res.text()) as Record<string, any>;
const BAD_ORIGIN = { origin: "https://evil.example" };

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

const profileRowInDb = () => harness.db.tables.financial_profiles!.find((r) => r.user_id === OWNER_ID)!;

describe("GET /api/settings", () => {
  it("401 without a verified session and reads nothing", async () => {
    resetHarness({}, null);
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(401);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it("404 when the profile is missing", async () => {
    resetHarness({}, undefined, false);
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(404);
    expect((await json(res)).error.details.reason).toBe("profile_missing");
  });

  it("returns profile, goal, recurring items and readiness with string amounts", async () => {
    resetHarness({
      savings_goals: [owned(goalRow())],
      recurring_items: [seedItem(), foreign(recurringRow({ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd" }))],
    });
    const { GET } = await import("@/app/api/settings/route");
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = await json(res);
    expect(body.profile).toEqual({
      displayName: "Minh",
      balanceSnapshot: { amountVnd: "2500000", at: "2026-11-15T03:00:00.000Z" },
      expectedMonthlyIncomeVnd: "6000000",
      paydayDay: 5,
      expectedDailyExpenseVnd: "120000",
      projectedMonthlyBudgetVnd: "4000000",
      minimumReserveVnd: "300000",
      isDemo: true,
      personaCode: "student",
      updatedAt: "2026-11-15T03:00:00.000Z",
    });
    expect(body.goal).toMatchObject({ name: "Laptop", targetVnd: "15000000", savedVnd: "2000000", reached: false });
    expect(body.goal.progress).toEqual({ percent: 13, remainingVnd: "13000000" });
    expect(body.recurringItems.map((i: { id: string }) => i.id)).toEqual([seedItem().id]);
    expect(body.recurringItems[0].amountVnd).toBe("1500000");
    expect(body.forecastReadiness).toEqual({ complete: true, issues: [] });
    const text = JSON.stringify(body);
    expect(text).not.toContain("user_id");
    expect(text).not.toContain(OTHER_ID);
    expect(text).not.toContain(OWNER_ID);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("reports an incomplete forecast instead of inventing numbers", async () => {
    resetHarness(
      {},
      undefined,
      false,
    );
    harness.db.tables.financial_profiles!.push(
      owned(
        profileRow({
          balance_snapshot_vnd: 0,
          payday_day: null,
          expected_monthly_income_vnd: 0,
          expected_daily_expense_vnd: 0,
        }),
      ),
    );
    const { GET } = await import("@/app/api/settings/route");
    const body = await json(await GET());
    expect(body.goal).toBeNull();
    expect(body.recurringItems).toEqual([]);
    expect(body.forecastReadiness.complete).toBe(false);
    expect(body.forecastReadiness.issues.map((i: { field: string }) => i.field)).toEqual([
      "balance_snapshot",
      "payday_day",
      "expected_monthly_income",
      "expected_daily_expense",
      "recurring_items",
    ]);
  });

  it("scopes every query to the verified session user and carries no bigint", async () => {
    resetHarness({ savings_goals: [owned(goalRow({ target_vnd: "9007199254740991" }))] });
    const result = await getSettingsForOwner(harness.db.fake.client, makeOwner());
    expect(() => JSON.stringify(result)).not.toThrow();
    for (const q of harness.db.fake.queries) {
      expect(q.calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === OWNER_ID)).toBe(true);
    }
  });

  it("uses the session user, not another user's data", async () => {
    resetHarness({}, { id: OTHER_ID, is_anonymous: false });
    harness.db.tables.financial_profiles!.push(foreign(profileRow({ display_name: "Other" })));
    const { GET } = await import("@/app/api/settings/route");
    const body = await json(await GET());
    expect(body.profile.displayName).toBe("Other");
  });
});

describe("PATCH /api/settings/profile", () => {
  const patch = async (body: unknown, headers?: Record<string, string>) => {
    const { PATCH } = await import("@/app/api/settings/profile/route");
    return PATCH(request("PATCH", "/api/settings/profile", body, headers));
  };

  it("401 / 403 happen before any database access", async () => {
    resetHarness({}, null);
    expect((await patch({ minimumReserveVnd: "1" })).status).toBe(401);
    resetHarness();
    expect((await patch({ minimumReserveVnd: "1" }, BAD_ORIGIN)).status).toBe(403);
    expect((await patch({ minimumReserveVnd: "1" }, {})).status).toBe(403);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it("updates the editable fields and returns readiness", async () => {
    const res = await patch({
      displayName: "  Lan ",
      expectedMonthlyIncomeVnd: "7500000",
      paydayDay: 10,
      expectedDailyExpenseVnd: "150000",
      projectedMonthlyBudgetVnd: "5000000",
      minimumReserveVnd: "500000",
    });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.profile).toMatchObject({
      displayName: "Lan",
      expectedMonthlyIncomeVnd: "7500000",
      paydayDay: 10,
      expectedDailyExpenseVnd: "150000",
      projectedMonthlyBudgetVnd: "5000000",
      minimumReserveVnd: "500000",
    });
    expect(body.forecastReadiness.complete).toBe(false); // no active recurring item in this fixture
    const row = profileRowInDb();
    expect(row.minimum_reserve_vnd).toBe("500000");
    // the snapshot, persona and demo flag are untouched
    expect(row).toMatchObject({ balance_snapshot_vnd: "2500000", persona_code: "student", is_demo: true });
    const [write] = writesOf(harness.db);
    expect(Object.keys((write!.calls.find((c) => c.method === "update")!.args[0] as object)).sort()).toEqual([
      "display_name",
      "expected_daily_expense_vnd",
      "expected_monthly_income_vnd",
      "minimum_reserve_vnd",
      "payday_day",
      "projected_monthly_budget_vnd",
    ]);
    expect(write!.calls.some((c) => c.method === "eq" && c.args[0] === "user_id" && c.args[1] === OWNER_ID)).toBe(true);
  });

  it("allows paydayDay null and zero amounts", async () => {
    const res = await patch({ paydayDay: null, minimumReserveVnd: "0" });
    expect(res.status).toBe(200);
    expect((await json(res)).profile).toMatchObject({ paydayDay: null, minimumReserveVnd: "0" });
  });

  it.each([
    ["smuggled user_id", { user_id: OTHER_ID, minimumReserveVnd: "1" }],
    ["smuggled userId", { userId: OTHER_ID, minimumReserveVnd: "1" }],
    ["smuggled owner", { owner: OTHER_ID, minimumReserveVnd: "1" }],
    ["smuggled persona_code", { persona_code: "worker", minimumReserveVnd: "1" }],
    ["smuggled personaCode", { personaCode: "worker", minimumReserveVnd: "1" }],
    ["smuggled is_demo", { is_demo: false, minimumReserveVnd: "1" }],
    ["smuggled isDemo", { isDemo: false, minimumReserveVnd: "1" }],
    ["balance snapshot amount", { balanceSnapshotVnd: "1" }],
    ["balance snapshot time", { balanceSnapshotAt: "2026-11-24T00:00:00Z" }],
    ["empty body", {}],
    ["negative amount", { minimumReserveVnd: "-1" }],
    ["decimal amount", { expectedDailyExpenseVnd: "1.5" }],
    ["exponent amount", { expectedDailyExpenseVnd: "1e3" }],
    ["number amount", { minimumReserveVnd: 5000 }],
    ["above safe bound", { minimumReserveVnd: "9007199254740992" }],
    ["payday 0", { paydayDay: 0 }],
    ["payday 32", { paydayDay: 32 }],
    ["payday fraction", { paydayDay: 1.5 }],
    ["payday string", { paydayDay: "5" }],
    ["blank name", { displayName: "   " }],
    ["null name", { displayName: null }],
  ])("400 for %s and nothing is written", async (_name, body) => {
    const res = await patch(body);
    expect(res.status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("accepts the safe-integer maximum", async () => {
    const res = await patch({ projectedMonthlyBudgetVnd: "9007199254740991" });
    expect(res.status).toBe(200);
    expect((await json(res)).profile.projectedMonthlyBudgetVnd).toBe("9007199254740991");
  });

  it("400 for malformed JSON and arrays", async () => {
    expect((await patch("{nope")).status).toBe(400);
    expect((await patch("[]")).status).toBe(400);
  });

  it("404 when the profile is missing, and never touches another user's profile", async () => {
    resetHarness({ financial_profiles: [foreign(profileRow())] }, undefined, false);
    const res = await patch({ minimumReserveVnd: "1" });
    expect(res.status).toBe(404);
    expect(harness.db.tables.financial_profiles![0]!.minimum_reserve_vnd).toBe(300000);
  });

  it("only updates the session user's row", async () => {
    resetHarness({ financial_profiles: [owned(profileRow()), foreign(profileRow({ display_name: "Other" }))] });
    await patch({ displayName: "Mine" });
    const other = harness.db.tables.financial_profiles!.find((r) => r.user_id === OTHER_ID)!;
    expect(other.display_name).toBe("Other");
    expect(profileRowInDb().display_name).toBe("Mine");
  });
});

describe("POST /api/settings/balance-snapshot", () => {
  const post = async (body: unknown, headers?: Record<string, string>) => {
    const { POST } = await import("@/app/api/settings/balance-snapshot/route");
    return POST(request("POST", "/api/settings/balance-snapshot", body, headers));
  };

  it("401 / 403", async () => {
    resetHarness({}, null);
    expect((await post({ amountVnd: "1", confirm: true })).status).toBe(401);
    resetHarness();
    expect((await post({ amountVnd: "1", confirm: true }, BAD_ORIGIN)).status).toBe(403);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it("sets amount and the SERVER time, and reports the previous snapshot", async () => {
    const res = await post({ amountVnd: "3000000", confirm: true });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.profile.balanceSnapshot).toEqual({ amountVnd: "3000000", at: NOW.toISOString() });
    expect(body.previousSnapshot).toEqual({ amountVnd: "2500000", at: "2026-11-15T03:00:00.000Z" });
    expect(body.deltaVnd).toBe("500000");
    expect(body.earlierTransactionsReapplied).toBe(false);
    expect(profileRowInDb()).toMatchObject({ balance_snapshot_vnd: "3000000", balance_snapshot_at: NOW.toISOString() });
    // the only columns written are the two snapshot columns
    const update = writesOf(harness.db)[0]!.calls.find((c) => c.method === "update")!;
    expect(Object.keys(update.args[0] as object).sort()).toEqual(["balance_snapshot_at", "balance_snapshot_vnd"]);
  });

  it("allows a negative amount (overdraft) and reports a negative delta", async () => {
    const body = await json(await post({ amountVnd: "-250000", confirm: true }));
    expect(body.profile.balanceSnapshot.amountVnd).toBe("-250000");
    expect(body.deltaVnd).toBe("-2750000");
  });

  it("ignores any client time: a timestamp key is rejected", async () => {
    const res = await post({ amountVnd: "1", confirm: true, at: "2020-01-01T00:00:00Z" });
    expect(res.status).toBe(400);
    expect((await post({ amountVnd: "1", confirm: true, balanceSnapshotAt: "2020-01-01T00:00:00Z" })).status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it.each([
    ["missing confirm", { amountVnd: "1" }],
    ["confirm false", { amountVnd: "1", confirm: false }],
    ["confirm string", { amountVnd: "1", confirm: "true" }],
    ["missing amount", { confirm: true }],
    ["number amount", { amountVnd: 1, confirm: true }],
    ["decimal amount", { amountVnd: "1.5", confirm: true }],
    ["above bound", { amountVnd: "9007199254740992", confirm: true }],
    ["below negative bound", { amountVnd: "-9007199254740992", confirm: true }],
    ["smuggled user_id", { amountVnd: "1", confirm: true, user_id: OTHER_ID }],
    ["smuggled persona_code", { amountVnd: "1", confirm: true, persona_code: "worker" }],
    ["smuggled is_demo", { amountVnd: "1", confirm: true, is_demo: false }],
  ])("400 for %s and nothing is written", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("missing confirm reports the confirm_required rule", async () => {
    const body = await json(await post({ amountVnd: "1", confirm: false }));
    expect(body.error.details).toMatchObject({ field: "confirm", rule: "confirm_required" });
  });

  it("accepts the bounds exactly", async () => {
    expect((await post({ amountVnd: "9007199254740991", confirm: true })).status).toBe(200);
    expect((await post({ amountVnd: "-9007199254740991", confirm: true })).status).toBe(200);
  });

  it("404 when the profile is missing", async () => {
    resetHarness({}, undefined, false);
    expect((await post({ amountVnd: "1", confirm: true })).status).toBe(404);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  describe("rebase semantics with the finance engine", () => {
    it("history before the new anchor is ignored; later rows still apply", async () => {
      resetHarness({
        transactions: [
          owned(transactionRow({ id: "00000000-0000-4000-8000-0000000000a1", occurred_at: "2026-11-10T05:00:00+00:00", amount_vnd: 700000 })), // before old snapshot
          owned(transactionRow({ id: "00000000-0000-4000-8000-0000000000a2", occurred_at: "2026-11-20T05:00:00+00:00", amount_vnd: 45000 })), // between old and new anchor
          owned(transactionRow({ id: "00000000-0000-4000-8000-0000000000a3", occurred_at: "2026-11-26T05:00:00+00:00", amount_vnd: 100000, kind: "income" })), // future
        ],
      });
      const loadAll = () => {
        const profile = mapProfileRow(profileRowInDb());
        const txs = harness.db.tables.transactions!.map(mapTransactionRow);
        return { profile, txs };
      };

      let { profile, txs } = loadAll();
      expect(balanceAt(profile, txs, NOW)).toBe(2_500_000n - 45_000n); // old anchor counts the 20 Nov expense

      expect((await post({ amountVnd: "3000000", confirm: true })).status).toBe(200);
      ({ profile, txs } = loadAll());
      expect(balanceAt(profile, txs, NOW)).toBe(3_000_000n); // = new amount, 45,000 NOT re-applied
      expect(txs).toHaveLength(3); // nothing was deleted or rewritten
      expect(balanceAt(profile, txs, new Date("2026-11-27T00:00:00Z"))).toBe(3_100_000n); // later rows still count
    });

    it("never writes to transactions or recurring_items", async () => {
      resetHarness({ transactions: [owned(transactionRow())], recurring_items: [seedItem()] });
      await post({ amountVnd: "10", confirm: true });
      expect(writesOf(harness.db).every((q) => q.table === "financial_profiles")).toBe(true);
      expect(queriesOn(harness.db, "transactions")).toHaveLength(0);
    });
  });
});

describe("/api/settings/goal", () => {
  const goalRoute = () => import("@/app/api/settings/goal/route");
  const put = async (body: unknown, headers?: Record<string, string>) =>
    (await goalRoute()).PUT(request("PUT", "/api/settings/goal", body, headers));
  const del = async (body?: unknown, headers?: Record<string, string>) =>
    (await goalRoute()).DELETE(request("DELETE", "/api/settings/goal", body, headers));
  const goalsOf = (id = OWNER_ID) => harness.db.tables.savings_goals!.filter((r) => r.user_id === id);

  it("GET: 401, null when none, own goal when present", async () => {
    resetHarness({}, null);
    expect((await (await goalRoute()).GET()).status).toBe(401);
    resetHarness();
    expect(await json(await (await goalRoute()).GET())).toEqual({ goal: null });
    resetHarness({ savings_goals: [owned(goalRow()), foreign(goalRow({ name: "Other" }))] });
    const body = await json(await (await goalRoute()).GET());
    expect(body.goal.name).toBe("Laptop");
  });

  it("PUT creates the goal with progress", async () => {
    const res = await put({ name: " Xe máy ", targetVnd: "20000000", savedVnd: "5000000", targetDate: "2027-06-30" });
    expect(res.status).toBe(200);
    const { goal } = await json(res);
    expect(goal).toMatchObject({
      name: "Xe máy",
      targetVnd: "20000000",
      savedVnd: "5000000",
      targetDate: "2027-06-30",
      reached: false,
      progress: { percent: 25, remainingVnd: "15000000" },
    });
    expect(goalsOf()).toHaveLength(1);
    expect(goalsOf()[0]!.user_id).toBe(OWNER_ID);
  });

  it("PUT defaults saved to 0 and the deadline to null", async () => {
    const { goal } = await json(await put({ name: "Quỹ", targetVnd: "1000" }));
    expect(goal).toMatchObject({ savedVnd: "0", targetDate: null, progress: { percent: 0, remainingVnd: "1000" } });
  });

  it("PUT twice leaves exactly one row (one goal per user), and does not touch other users", async () => {
    resetHarness({ savings_goals: [foreign(goalRow({ name: "Other" }))] });
    await put({ name: "A", targetVnd: "100" });
    await put({ name: "B", targetVnd: "200", savedVnd: "50" });
    expect(goalsOf()).toHaveLength(1);
    expect(goalsOf()[0]).toMatchObject({ name: "B", target_vnd: "200", saved_vnd: "50" });
    expect(goalsOf(OTHER_ID)).toHaveLength(1);
    expect(goalsOf(OTHER_ID)[0]!.name).toBe("Other");
    const upserts = writesOf(harness.db).flatMap((q) => q.calls.filter((c) => c.method === "upsert"));
    expect(upserts.every((c) => (c.args[1] as { onConflict: string }).onConflict === "user_id")).toBe(true);
    expect(writesOf(harness.db).some((q) => q.calls.some((c) => c.method === "insert"))).toBe(false);
  });

  it("saved exactly at target and above target both report reached:true, 100%", async () => {
    let { goal } = await json(await put({ name: "A", targetVnd: "500", savedVnd: "500" }));
    expect(goal).toMatchObject({ reached: true, progress: { percent: 100, remainingVnd: "0" } });
    ({ goal } = await json(await put({ name: "A", targetVnd: "500", savedVnd: "9000" })));
    expect(goal).toMatchObject({ savedVnd: "9000", reached: true, progress: { percent: 100, remainingVnd: "0" } });
  });

  it("handles tiny and huge bigint values", async () => {
    let { goal } = await json(await put({ name: "A", targetVnd: "9007199254740991", savedVnd: "1" }));
    expect(goal.progress).toEqual({ percent: 0, remainingVnd: "9007199254740990" });
    ({ goal } = await json(await put({ name: "A", targetVnd: "9007199254740991", savedVnd: "9007199254740990" })));
    expect(goal.progress).toEqual({ percent: 99, remainingVnd: "1" });
  });

  it("rejects a past deadline using the Vietnam calendar day, accepts today", async () => {
    expect((await put({ name: "A", targetVnd: "100", targetDate: "2026-11-23" })).status).toBe(400);
    expect(goalsOf()).toHaveLength(0);
    const res = await put({ name: "A", targetVnd: "100", targetDate: "2026-11-24" });
    expect(res.status).toBe(200);
    // clock moves to 2026-11-25 03:00 Vietnam (still 24 Nov in UTC): 24 Nov is now in the past
    vi.setSystemTime(new Date("2026-11-24T20:00:00Z"));
    const late = await put({ name: "B", targetVnd: "100", targetDate: "2026-11-24" });
    expect(late.status).toBe(200); // unchanged from the stored date -> allowed
    const changed = await put({ name: "B", targetVnd: "100", targetDate: "2026-11-23" });
    expect(changed.status).toBe(400);
    expect((await json(changed)).error.details).toMatchObject({ field: "targetDate", rule: "target_date_in_past" });
  });

  it("keeps an overdue deadline editable when unchanged, rejects a different past date", async () => {
    resetHarness({ savings_goals: [owned(goalRow({ target_date: "2026-01-01" }))] });
    expect((await put({ name: "Laptop 2", targetVnd: "15000000", savedVnd: "3000000", targetDate: "2026-01-01" })).status).toBe(200);
    expect((await put({ name: "Laptop 2", targetVnd: "15000000", targetDate: "2026-01-02" })).status).toBe(400);
    expect(goalsOf()[0]!.target_date).toBe("2026-01-01");
  });

  it("PUT without a targetDate clears it (replace semantics)", async () => {
    resetHarness({ savings_goals: [owned(goalRow())] });
    const { goal } = await json(await put({ name: "Laptop", targetVnd: "15000000" }));
    expect(goal.targetDate).toBeNull();
  });

  it.each([
    ["zero target", { name: "A", targetVnd: "0" }],
    ["negative target", { name: "A", targetVnd: "-5" }],
    ["negative saved", { name: "A", targetVnd: "5", savedVnd: "-1" }],
    ["decimal target", { name: "A", targetVnd: "5.5" }],
    ["number target", { name: "A", targetVnd: 5 }],
    ["target above bound", { name: "A", targetVnd: "9007199254740992" }],
    ["saved above bound", { name: "A", targetVnd: "5", savedVnd: "9007199254740992" }],
    ["blank name", { name: " ", targetVnd: "5" }],
    ["missing name", { targetVnd: "5" }],
    ["missing target", { name: "A" }],
    ["bad date", { name: "A", targetVnd: "5", targetDate: "2027-02-30" }],
    ["smuggled user_id", { name: "A", targetVnd: "5", user_id: OTHER_ID }],
    ["smuggled owner", { name: "A", targetVnd: "5", owner: OTHER_ID }],
    ["smuggled persona_code", { name: "A", targetVnd: "5", persona_code: "worker" }],
    ["smuggled is_demo", { name: "A", targetVnd: "5", is_demo: true }],
    ["second-goal id", { name: "A", targetVnd: "5", id: "x" }],
  ])("PUT 400 for %s and nothing is written", async (_name, body) => {
    const res = await put(body);
    expect(res.status).toBe(400);
    expect(writesOf(harness.db)).toHaveLength(0);
  });

  it("PUT / DELETE 401 and 403", async () => {
    resetHarness({}, null);
    expect((await put({ name: "A", targetVnd: "5" })).status).toBe(401);
    expect((await del({ confirm: true })).status).toBe(401);
    resetHarness();
    expect((await put({ name: "A", targetVnd: "5" }, BAD_ORIGIN)).status).toBe(403);
    expect((await del({ confirm: true }, BAD_ORIGIN)).status).toBe(403);
    expect(harness.db.fake.queries).toHaveLength(0);
  });

  it("DELETE removes only the caller's goal and requires confirm:true", async () => {
    resetHarness({ savings_goals: [owned(goalRow()), foreign(goalRow({ name: "Other" }))] });
    for (const body of [{}, { confirm: false }, { confirm: "true" }, { confirm: true, user_id: OTHER_ID }, undefined, "nope"]) {
      expect((await del(body)).status).toBe(400);
    }
    expect(writesOf(harness.db)).toHaveLength(0);
    const res = await del({ confirm: true });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ goal: null });
    expect(goalsOf()).toHaveLength(0);
    expect(goalsOf(OTHER_ID)).toHaveLength(1);
    expect((await del({ confirm: true })).status).toBe(200); // idempotent
  });
});

describe("recurring items are read-only in settings", () => {
  it("no settings route writes to or deletes recurring rows", async () => {
    resetHarness({ recurring_items: [seedItem()], savings_goals: [owned(goalRow())] });
    const settings = await import("@/app/api/settings/route");
    const profile = await import("@/app/api/settings/profile/route");
    const snapshot = await import("@/app/api/settings/balance-snapshot/route");
    const goal = await import("@/app/api/settings/goal/route");
    await settings.GET();
    await profile.PATCH(request("PATCH", "/api/settings/profile", { minimumReserveVnd: "1" }));
    await snapshot.POST(request("POST", "/api/settings/balance-snapshot", { amountVnd: "1", confirm: true }));
    await goal.PUT(request("PUT", "/api/settings/goal", { name: "A", targetVnd: "5" }));
    await goal.DELETE(request("DELETE", "/api/settings/goal", { confirm: true }));
    expect(harness.db.tables.recurring_items).toHaveLength(1);
    expect(writesOf(harness.db).filter((q) => q.table === "recurring_items")).toHaveLength(0);
    for (const q of queriesOn(harness.db, "recurring_items")) {
      expect(q.calls.some((c) => ["insert", "update", "upsert", "delete"].includes(c.method))).toBe(false);
    }
    expect(Object.keys(settings)).not.toContain("DELETE");
  });

  it("an inactive-only recurring list still reports recurring_items as missing", async () => {
    resetHarness({ recurring_items: [seedItem({ active: false })] });
    const { GET } = await import("@/app/api/settings/route");
    const body = await json(await GET());
    expect(body.recurringItems).toHaveLength(1);
    expect(body.recurringItems[0].active).toBe(false);
    expect(body.forecastReadiness.issues).toEqual([{ field: "recurring_items", problem: "missing" }]);
  });
});

describe("demo profiles", () => {
  it("allows editing a demo profile while persona_code and is_demo stay untouched", async () => {
    const { PATCH } = await import("@/app/api/settings/profile/route");
    const res = await PATCH(request("PATCH", "/api/settings/profile", { displayName: "Bạn" }));
    expect(res.status).toBe(200);
    expect(profileRowInDb()).toMatchObject({ persona_code: "student", is_demo: true, display_name: "Bạn" });
  });
});
