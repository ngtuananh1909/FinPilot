/**
 * LIVE RLS / RPC / quota-concurrency integration tests.
 *
 * STATUS: BLOCKED. Skipped unless RLS_TEST_ENABLED is set. Nothing here may run until the
 * owner has granted G2 approval for a specific target (see tests/db/README.md and
 * docs/15-g2-migration-approval-pack.md). The 202611230002 hardening migration must be
 * applied to that target first.
 *
 * Credentials come only from environment variables. The suite refuses to run when the
 * Supabase URL project ref differs from RLS_TEST_ALLOWED_PROJECT_REF. Test users are
 * created through anonymous sign-in (role `authenticated`), and cleanup deletes only the
 * user ids created by this run.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTargetAllowed } from "./target-guard";

const enabled = Boolean(process.env.RLS_TEST_ENABLED);

interface TestUser {
  id: string;
  client: SupabaseClient;
}

const PERMISSION_DENIED = "42501";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for live RLS tests`);
  return value;
}

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

function isDenied(error: { code?: string; message?: string } | null): boolean {
  return error !== null && (error.code === PERMISSION_DENIED || /permission denied|not allowed|row-level security/i.test(error.message ?? ""));
}

function template(personaCode: "student" | "worker" | "at_risk", txCount: number, label: string): Record<string, unknown> {
  return {
    persona_code: personaCode,
    profile: {
      display_name: label,
      balance_snapshot_vnd: "2450000",
      balance_snapshot_at: "2026-11-23T09:00:00+07:00",
      expected_monthly_income_vnd: "5000000",
      payday_day: 5,
      expected_daily_expense_vnd: "80000",
      projected_monthly_budget_vnd: "2400000",
      minimum_reserve_vnd: "300000",
      is_demo: true,
    },
    recurring_items: [
      { label: "Tiền trọ", kind: "expense", amount_vnd: "1800000", day_of_month: 1, category: "rent", start_date: "2026-09-01" },
    ],
    transactions: Array.from({ length: txCount }, (_, i) => ({
      occurred_at: `2026-11-${String((i % 20) + 1).padStart(2, "0")}T12:30:00+07:00`,
      kind: "expense",
      amount_vnd: String(10000 + i),
      category: "food",
      merchant: `Synthetic ${i}`,
    })),
    goal: { name: "Synthetic goal", target_vnd: "12000000", saved_vnd: "2500000", target_date: "2027-06-01" },
  };
}

describe.skipIf(!enabled)("LIVE RLS/RPC/quota tests (BLOCKED until G2-approved target)", () => {
  let url = "";
  let anonKey = "";
  let service: SupabaseClient;
  let anonOnly: SupabaseClient;
  const created: string[] = [];

  async function createUser(): Promise<TestUser> {
    const client = newClient(url, anonKey);
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message ?? "no user"}`);
    created.push(data.user.id);
    return { id: data.user.id, client };
  }

  async function vnDate(): Promise<string> {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
  }

  async function counter(userId: string, date?: string): Promise<{ chat: number; scan: number } | null> {
    const { data, error } = await service
      .from("ai_usage_daily")
      .select("chat_calls,scan_calls")
      .eq("user_id", userId)
      .eq("usage_date", date ?? (await vnDate()))
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? { chat: data.chat_calls as number, scan: data.scan_calls as number } : null;
  }

  async function count(table: string, userId: string): Promise<number> {
    const { count: n, error } = await service.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return n ?? 0;
  }

  let a: TestUser;
  let b: TestUser;

  beforeAll(async () => {
    url = requireEnv("RLS_TEST_SUPABASE_URL");
    assertTargetAllowed(url, process.env.RLS_TEST_ALLOWED_PROJECT_REF);
    anonKey = requireEnv("RLS_TEST_ANON_KEY");
    service = newClient(url, requireEnv("RLS_TEST_SERVICE_ROLE_KEY"));
    anonOnly = newClient(url, anonKey);
    a = await createUser();
    b = await createUser();
    expect(a.id).not.toEqual(b.id);
    for (const u of [a, b]) {
      const { data, error } = await service.rpc("bootstrap_profile", { p_user_id: u.id, p_persona_code: "student" });
      expect(error).toBeNull();
      expect(data).toBe(true);
    }
  }, 60_000);

  afterAll(async () => {
    // Cleanup is scoped to the user ids created by THIS run. Cascades remove their rows.
    if (!service) return;
    for (const id of created) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) console.error(`cleanup failed for ${id}: ${error.message}`);
    }
  }, 120_000);

  describe("owner isolation on client-writable tables (anonymous users are role authenticated)", () => {
    const rowFor = (table: string, userId: string): Record<string, unknown> => {
      switch (table) {
        case "import_batches":
          return { user_id: userId, idempotency_key: randomUUID(), source: "csv" };
        case "recurring_items":
          return { user_id: userId, label: "Synthetic", kind: "expense", amount_vnd: 1000, day_of_month: 1 };
        case "transactions":
          return { user_id: userId, occurred_at: new Date().toISOString(), kind: "expense", amount_vnd: 1000 };
        case "savings_goals":
          return { user_id: userId, name: "Synthetic", target_vnd: 1000 };
        default:
          throw new Error(`no factory for ${table}`);
      }
    };

    for (const table of ["import_batches", "recurring_items", "transactions", "savings_goals"]) {
      it(`${table}: B cannot select, insert for, update or delete A's rows`, async () => {
        const { data: inserted, error: insertError } = await a.client.from(table).insert(rowFor(table, a.id)).select();
        expect(insertError).toBeNull();
        expect(inserted).toHaveLength(1);

        const seen = await b.client.from(table).select("*").eq("user_id", a.id);
        expect(seen.error).toBeNull();
        expect(seen.data).toEqual([]);

        const forged = await b.client.from(table).insert(rowFor(table, a.id));
        expect(forged.error).not.toBeNull();

        const updated = await b.client.from(table).update({ user_id: b.id }).eq("user_id", a.id).select();
        expect(updated.data ?? []).toEqual([]);

        const deleted = await b.client.from(table).delete().eq("user_id", a.id).select();
        expect(deleted.data ?? []).toEqual([]);

        expect(await count(table, a.id)).toBeGreaterThanOrEqual(1);
      });
    }

    it("financial_profiles: B cannot read, change or delete A's profile; A can read own", async () => {
      const own = await a.client.from("financial_profiles").select("user_id").eq("user_id", a.id);
      expect(own.data).toHaveLength(1);
      const other = await b.client.from("financial_profiles").select("user_id").eq("user_id", a.id);
      expect(other.data).toEqual([]);
      const upd = await b.client.from("financial_profiles").update({ minimum_reserve_vnd: 1 }).eq("user_id", a.id).select();
      expect(upd.data ?? []).toEqual([]);
      const del = await b.client.from("financial_profiles").delete().eq("user_id", a.id).select();
      expect(del.data ?? []).toEqual([]);
      expect(await count("financial_profiles", a.id)).toBe(1);
    });

    it("raw anon role (no session) sees nothing and cannot write", async () => {
      const read = await anonOnly.from("transactions").select("*");
      expect(read.error !== null || (read.data ?? []).length === 0).toBe(true);
      const write = await anonOnly.from("transactions").insert(rowFor("transactions", a.id));
      expect(write.error).not.toBeNull();
    });

    it("user-owned bounds and label checks reject invalid values", async () => {
      const tooBig = await a.client.from("transactions").insert({ ...rowFor("transactions", a.id), amount_vnd: "9007199254740992" });
      expect(tooBig.error?.code).toBe("23514");
      const blank = await a.client.from("recurring_items").insert({ ...rowFor("recurring_items", a.id), label: "   " });
      expect(blank.error?.code).toBe("23514");
    });
  });

  describe("server-only tables and privileged RPCs", () => {
    it("clients can select but never write ai_* tables, ai_usage_daily, reservations or reset_log", async () => {
      const { data: conv, error } = await service.from("ai_conversations").insert({ user_id: a.id }).select().single();
      expect(error).toBeNull();
      const own = await a.client.from("ai_conversations").select("id").eq("id", conv?.id);
      expect(own.data).toHaveLength(1);
      const other = await b.client.from("ai_conversations").select("id").eq("id", conv?.id);
      expect(other.data).toEqual([]);

      const attempts = [
        a.client.from("ai_conversations").insert({ user_id: a.id }),
        a.client.from("ai_conversations").update({ title: "x" }).eq("user_id", a.id),
        a.client.from("ai_conversations").delete().eq("user_id", a.id),
        a.client.from("ai_messages").insert({ user_id: a.id, conversation_id: conv?.id, role: "user", content: "x" }),
        a.client.from("ai_proposals").insert({ user_id: a.id, kind: "budget_update", payload: {}, expires_at: new Date().toISOString() }),
        a.client.from("ai_usage_daily").insert({ user_id: a.id, usage_date: "2026-01-01" }),
        a.client.from("ai_usage_daily").update({ chat_calls: 0 }).eq("user_id", a.id),
        a.client.from("ai_quota_reservations").insert({ request_id: randomUUID(), user_id: a.id, usage_date: "2026-01-01", kind: "chat" }),
        a.client.from("reset_log").insert({ user_id: a.id, idempotency_key: "client-write-attempt" }),
        a.client.from("reset_log").select("*"),
      ];
      for (const attempt of attempts) {
        const res = await attempt;
        expect(isDenied(res.error), JSON.stringify(res.error)).toBe(true);
      }
      expect(await count("ai_conversations", a.id)).toBeGreaterThanOrEqual(1);
    });

    const rpcCalls: Array<[string, Record<string, unknown>]> = [
      ["consume_ai_quota", { p_user_id: randomUUID(), p_kind: "chat", p_limit: 20 }],
      ["reserve_ai_quota", { p_user_id: randomUUID(), p_request_id: randomUUID(), p_kind: "chat", p_limit: 20 }],
      ["release_ai_quota", { p_user_id: randomUUID(), p_request_id: randomUUID() }],
      ["commit_ai_quota", { p_user_id: randomUUID(), p_request_id: randomUUID() }],
      ["bootstrap_profile", { p_user_id: randomUUID(), p_persona_code: "student" }],
      ["reset_user_to_persona", { p_user_id: randomUUID(), p_template: {}, p_idempotency_key: "denied-key-000" }],
    ];
    for (const [fn, args] of rpcCalls) {
      it(`${fn}: permission denied for anon role and for authenticated (incl. anonymous guest)`, async () => {
        for (const client of [anonOnly, a.client]) {
          const res = await client.rpc(fn, args);
          expect(isDenied(res.error), `${fn}: ${JSON.stringify(res.error)}`).toBe(true);
          expect(res.data ?? null).toBeNull();
        }
      });
    }

    it("a guest cannot call a privileged RPC against its OWN id either", async () => {
      const res = await a.client.rpc("reset_user_to_persona", {
        p_user_id: a.id,
        p_template: template("student", 1, "x"),
        p_idempotency_key: randomUUID(),
      });
      expect(isDenied(res.error)).toBe(true);
    });
  });

  describe("composite FK ownership and recurring link integrity", () => {
    it("B cannot link a transaction to A's import batch or recurring item", async () => {
      const batch = await a.client.from("import_batches").insert({ user_id: a.id, idempotency_key: randomUUID(), source: "csv" }).select().single();
      const rec = await a.client
        .from("recurring_items")
        .insert({ user_id: a.id, label: "FK", kind: "expense", amount_vnd: 1, day_of_month: 2 })
        .select()
        .single();
      expect(batch.error).toBeNull();
      expect(rec.error).toBeNull();

      const viaBatch = await b.client
        .from("transactions")
        .insert({ user_id: b.id, occurred_at: new Date().toISOString(), kind: "expense", amount_vnd: 1, import_batch_id: batch.data?.id });
      expect(viaBatch.error?.code).toBe("23503");

      const viaRecurring = await b.client.from("transactions").insert({
        user_id: b.id,
        occurred_at: new Date().toISOString(),
        kind: "expense",
        amount_vnd: 1,
        recurring_item_id: rec.data?.id,
        recurring_instance_date: "2026-11-23",
      });
      expect(viaRecurring.error?.code).toBe("23503");
    });

    it("recurring link must be set as a pair, and a referenced recurring item cannot be deleted (NO ACTION)", async () => {
      const rec = await a.client
        .from("recurring_items")
        .insert({ user_id: a.id, label: "Pair", kind: "expense", amount_vnd: 1, day_of_month: 3 })
        .select()
        .single();
      const half = await a.client
        .from("transactions")
        .insert({ user_id: a.id, occurred_at: new Date().toISOString(), kind: "expense", amount_vnd: 1, recurring_item_id: rec.data?.id });
      expect(half.error?.code).toBe("23514");

      const linked = await a.client.from("transactions").insert({
        user_id: a.id,
        occurred_at: new Date().toISOString(),
        kind: "expense",
        amount_vnd: 1,
        recurring_item_id: rec.data?.id,
        recurring_instance_date: "2026-11-23",
      });
      expect(linked.error).toBeNull();

      const del = await a.client.from("recurring_items").delete().eq("id", rec.data?.id);
      expect(del.error?.code).toBe("23503");
      const deactivate = await a.client.from("recurring_items").update({ active: false }).eq("id", rec.data?.id).select();
      expect(deactivate.data).toHaveLength(1);
    });

    it("savings_goals allows one goal per user", async () => {
      const u = await createUser();
      const first = await u.client.from("savings_goals").insert({ user_id: u.id, name: "One", target_vnd: 100 });
      expect(first.error).toBeNull();
      const second = await u.client.from("savings_goals").insert({ user_id: u.id, name: "Two", target_vnd: 100 });
      expect(second.error?.code).toBe("23505");
    });

    it("updated_at advances on update and cannot be forged", async () => {
      const g = await a.client.from("transactions").insert({ user_id: a.id, occurred_at: new Date().toISOString(), kind: "expense", amount_vnd: 7 }).select().single();
      const before = new Date(g.data?.updated_at as string).getTime();
      await new Promise((r) => setTimeout(r, 25));
      const upd = await a.client.from("transactions").update({ amount_vnd: 8, updated_at: "2000-01-01T00:00:00Z" }).eq("id", g.data?.id).select().single();
      expect(new Date(upd.data?.updated_at as string).getTime()).toBeGreaterThan(before);
    });
  });

  describe("quota reservations (service role)", () => {
    it("50 concurrent reserve_ai_quota calls with limit 20 grant exactly 20", async () => {
      const u = await createUser();
      const results = await Promise.all(
        Array.from({ length: 50 }, () =>
          service.rpc("reserve_ai_quota", { p_user_id: u.id, p_request_id: randomUUID(), p_kind: "chat", p_limit: 20 }),
        ),
      );
      for (const r of results) expect(r.error).toBeNull();
      expect(results.filter((r) => r.data === true)).toHaveLength(20);
      expect((await counter(u.id))?.chat).toBe(20);
      expect(await count("ai_quota_reservations", u.id)).toBe(20);
    }, 60_000);

    it("replay of a request id is idempotent, other owners are rejected, released ids stay released", async () => {
      const u = await createUser();
      const other = await createUser();
      const request = randomUUID();
      const args = { p_user_id: u.id, p_request_id: request, p_kind: "chat", p_limit: 20 };
      expect((await service.rpc("reserve_ai_quota", args)).data).toBe(true);
      expect((await service.rpc("reserve_ai_quota", args)).data).toBe(true);
      expect((await counter(u.id))?.chat).toBe(1);

      const stolen = await service.rpc("reserve_ai_quota", { ...args, p_user_id: other.id });
      expect(stolen.error).not.toBeNull();
      expect(await counter(other.id)).toBeNull();

      expect((await service.rpc("release_ai_quota", { p_user_id: other.id, p_request_id: request })).data).toBe(false);
      expect((await counter(u.id))?.chat).toBe(1);

      expect((await service.rpc("release_ai_quota", { p_user_id: u.id, p_request_id: request })).data).toBe(true);
      expect((await service.rpc("reserve_ai_quota", args)).data).toBe(false);
      expect((await counter(u.id))?.chat).toBe(0);
    });

    it("double release (sequential and concurrent) decrements exactly once", async () => {
      const u = await createUser();
      const ids = [randomUUID(), randomUUID()];
      for (const id of ids) {
        expect((await service.rpc("reserve_ai_quota", { p_user_id: u.id, p_request_id: id, p_kind: "scan", p_limit: 5 })).data).toBe(true);
      }
      expect((await counter(u.id))?.scan).toBe(2);

      expect((await service.rpc("release_ai_quota", { p_user_id: u.id, p_request_id: ids[0] })).data).toBe(true);
      expect((await service.rpc("release_ai_quota", { p_user_id: u.id, p_request_id: ids[0] })).data).toBe(false);
      expect((await counter(u.id))?.scan).toBe(1);

      const concurrent = await Promise.all(
        Array.from({ length: 10 }, () => service.rpc("release_ai_quota", { p_user_id: u.id, p_request_id: ids[1] })),
      );
      expect(concurrent.filter((r) => r.data === true)).toHaveLength(1);
      expect((await counter(u.id))?.scan).toBe(0);
    });

    it("commit prevents later release, and the reservation stores the Vietnam date", async () => {
      const u = await createUser();
      const id = randomUUID();
      expect((await service.rpc("reserve_ai_quota", { p_user_id: u.id, p_request_id: id, p_kind: "chat", p_limit: 20 })).data).toBe(true);
      const { data } = await service.from("ai_quota_reservations").select("usage_date,status").eq("request_id", id).single();
      expect(data?.usage_date).toBe(await vnDate());
      expect((await service.rpc("commit_ai_quota", { p_user_id: u.id, p_request_id: id })).data).toBe(true);
      expect((await service.rpc("commit_ai_quota", { p_user_id: u.id, p_request_id: id })).data).toBe(true);
      expect((await service.rpc("release_ai_quota", { p_user_id: u.id, p_request_id: id })).data).toBe(false);
      expect((await counter(u.id))?.chat).toBe(1);
    });

    it("consume_ai_quota rejects NULL kind or limit", async () => {
      const u = await createUser();
      expect((await service.rpc("consume_ai_quota", { p_user_id: u.id, p_kind: null, p_limit: 5 })).error).not.toBeNull();
      expect((await service.rpc("consume_ai_quota", { p_user_id: u.id, p_kind: "chat", p_limit: null })).error).not.toBeNull();
      expect(await counter(u.id)).toBeNull();
    });
  });

  describe("reset_user_to_persona (service role)", () => {
    it("resets only the caller's rows, keeps other users and quota counters intact, and replays as a no-op", async () => {
      const r1 = await createUser();
      const r2 = await createUser();
      expect((await service.rpc("reset_user_to_persona", { p_user_id: r1.id, p_template: template("student", 5, "R1"), p_idempotency_key: "seed-key-r1" })).data).toMatchObject({ applied: true });
      expect((await service.rpc("reset_user_to_persona", { p_user_id: r2.id, p_template: template("worker", 7, "R2"), p_idempotency_key: "seed-key-r2" })).data).toMatchObject({ applied: true });
      expect(await count("transactions", r1.id)).toBe(5);
      expect(await count("transactions", r2.id)).toBe(7);

      for (const u of [r1, r2]) {
        expect((await service.rpc("reserve_ai_quota", { p_user_id: u.id, p_request_id: randomUUID(), p_kind: "chat", p_limit: 20 })).data).toBe(true);
      }
      await service.from("transactions").insert({ user_id: r1.id, occurred_at: new Date().toISOString(), kind: "expense", amount_vnd: 999 });
      await service.from("ai_conversations").insert({ user_id: r1.id });
      const reservationsBefore = await count("ai_quota_reservations", r1.id);

      const reset = await service.rpc("reset_user_to_persona", { p_user_id: r1.id, p_template: template("at_risk", 3, "R1b"), p_idempotency_key: "reset-key-2" });
      expect(reset.error).toBeNull();
      expect(reset.data).toMatchObject({ applied: true, deleted_transactions: 6, inserted_transactions: 3 });
      expect(await count("transactions", r1.id)).toBe(3);
      expect(await count("ai_conversations", r1.id)).toBe(0);
      expect(await count("savings_goals", r1.id)).toBe(1);

      expect(await count("transactions", r2.id)).toBe(7);
      expect((await counter(r1.id))?.chat).toBe(1);
      expect((await counter(r2.id))?.chat).toBe(1);
      expect(await count("ai_quota_reservations", r1.id)).toBe(reservationsBefore);

      await service.from("transactions").insert({ user_id: r1.id, occurred_at: new Date().toISOString(), kind: "expense", amount_vnd: 555 });
      const replay = await service.rpc("reset_user_to_persona", { p_user_id: r1.id, p_template: template("at_risk", 3, "R1b"), p_idempotency_key: "reset-key-2" });
      expect(replay.data).toMatchObject({ applied: false, replay: true });
      expect(await count("transactions", r1.id)).toBe(4);
    }, 60_000);

    it("concurrent resets with one idempotency key apply exactly once", async () => {
      const u = await createUser();
      const results = await Promise.all(
        Array.from({ length: 5 }, () =>
          service.rpc("reset_user_to_persona", { p_user_id: u.id, p_template: template("student", 4, "Race"), p_idempotency_key: "race-key-0001" }),
        ),
      );
      for (const r of results) expect(r.error).toBeNull();
      expect(results.filter((r) => (r.data as { applied?: boolean } | null)?.applied === true)).toHaveLength(1);
      expect(await count("transactions", u.id)).toBe(4);
    }, 60_000);

    it("rejects invalid templates atomically (data and idempotency key untouched)", async () => {
      const u = await createUser();
      expect((await service.rpc("reset_user_to_persona", { p_user_id: u.id, p_template: template("student", 2, "Base"), p_idempotency_key: "base-key-0001" })).error).toBeNull();

      const tooMany = await service.rpc("reset_user_to_persona", { p_user_id: u.id, p_template: template("student", 501, "Big"), p_idempotency_key: "bad-key-0001" });
      expect(tooMany.error).not.toBeNull();

      const bad = template("student", 2, "Bad");
      (bad.transactions as Array<Record<string, unknown>>)[0] = { ...(bad.transactions as Array<Record<string, unknown>>)[0], amount_vnd: "9007199254740992" };
      const overflow = await service.rpc("reset_user_to_persona", { p_user_id: u.id, p_template: bad, p_idempotency_key: "bad-key-0002" });
      expect(overflow.error).not.toBeNull();

      const badPersona = await service.rpc("reset_user_to_persona", { p_user_id: u.id, p_template: { ...template("student", 1, "x"), persona_code: "admin" }, p_idempotency_key: "bad-key-0003" });
      expect(badPersona.error).not.toBeNull();

      expect(await count("transactions", u.id)).toBe(2);
      const { count: logged } = await service.from("reset_log").select("*", { count: "exact", head: true }).eq("user_id", u.id);
      expect(logged).toBe(1);
    }, 60_000);

    it("bootstrap_profile is idempotent and never overwrites", async () => {
      const u = await createUser();
      expect((await service.rpc("bootstrap_profile", { p_user_id: u.id, p_persona_code: "worker" })).data).toBe(true);
      expect((await service.rpc("bootstrap_profile", { p_user_id: u.id, p_persona_code: "student" })).data).toBe(false);
      const { data } = await service.from("financial_profiles").select("persona_code").eq("user_id", u.id).single();
      expect(data?.persona_code).toBe("worker");
    });
  });
});
