/**
 * LIVE tests for the PROPOSED migration 202611230003 (profile column protection and
 * public.commit_csv_import).
 *
 * STATUS: BLOCKED. Skipped unless BOTH RLS_TEST_ENABLED and RLS_TEST_MIGRATION_0003 are set.
 * The second variable exists so the 0002 live suite keeps working before 0003 is applied.
 * Nothing here may run until the owner has granted G2 approval for a specific target AND
 * migration 0003 has been applied there (docs/18-g2-approval-pack-0003.md).
 *
 * Same rules as tests/db/rls.live.test.ts: credentials only from environment variables,
 * project-ref guard, users created through anonymous sign-in (role `authenticated`), and
 * cleanup deletes only the user ids created by this run.
 */
import { randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assertTargetAllowed } from "./target-guard";

const enabled = Boolean(process.env.RLS_TEST_ENABLED) && Boolean(process.env.RLS_TEST_MIGRATION_0003);

interface TestUser {
  id: string;
  client: SupabaseClient;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required for live tests`);
  return value;
}

function newClient(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
}

const isDenied = (error: { code?: string; message?: string } | null): boolean =>
  error !== null && (error.code === "42501" || /permission denied|not allowed|server-controlled|row-level security/i.test(error.message ?? ""));

const csvRow = (i: number): Record<string, unknown> => ({
  occurred_at: `2026-11-${String((i % 20) + 1).padStart(2, "0")}T12:30:00+07:00`,
  kind: "expense",
  amount_vnd: String(1000 + i),
  category: "food",
  merchant: `Synthetic ${i}`,
  fingerprint: `fp-${i}`,
});

describe.skipIf(!enabled)("LIVE migration 0003 tests (BLOCKED until G2-approved target with 0003 applied)", () => {
  let url = "";
  let anonKey = "";
  let service: SupabaseClient;
  let anonOnly: SupabaseClient;
  const created: string[] = [];

  async function createUser(persona: "student" | "worker" | "at_risk" | null = "student"): Promise<TestUser> {
    const client = newClient(url, anonKey);
    const { data, error } = await client.auth.signInAnonymously();
    if (error || !data.user) throw new Error(`anonymous sign-in failed: ${error?.message ?? "no user"}`);
    created.push(data.user.id);
    const boot = await service.rpc("bootstrap_profile", { p_user_id: data.user.id, p_persona_code: persona });
    expect(boot.error).toBeNull();
    return { id: data.user.id, client };
  }

  async function count(table: string, userId: string): Promise<number> {
    const { count: n, error } = await service.from(table).select("*", { count: "exact", head: true }).eq("user_id", userId);
    if (error) throw new Error(error.message);
    return n ?? 0;
  }

  async function profileOf(userId: string): Promise<{ persona_code: string | null; is_demo: boolean; user_id: string }> {
    const { data, error } = await service.from("financial_profiles").select("user_id,persona_code,is_demo").eq("user_id", userId).single();
    if (error) throw new Error(error.message);
    return data as { persona_code: string | null; is_demo: boolean; user_id: string };
  }

  beforeAll(async () => {
    url = requireEnv("RLS_TEST_SUPABASE_URL");
    assertTargetAllowed(url, process.env.RLS_TEST_ALLOWED_PROJECT_REF);
    anonKey = requireEnv("RLS_TEST_ANON_KEY");
    service = newClient(url, requireEnv("RLS_TEST_SERVICE_ROLE_KEY"));
    anonOnly = newClient(url, anonKey);
  }, 60_000);

  afterAll(async () => {
    if (!service) return;
    for (const id of created) {
      const { error } = await service.auth.admin.deleteUser(id);
      if (error) console.error(`cleanup failed for ${id}: ${error.message}`);
    }
  }, 120_000);

  describe("financial_profiles column protection (client = PostgREST role authenticated)", () => {
    it("client cannot change persona_code, is_demo or user_id of its own profile", async () => {
      const u = await createUser("student");
      const other = await createUser("worker");
      const before = await profileOf(u.id);

      const attempts = [
        u.client.from("financial_profiles").update({ persona_code: "worker" }).eq("user_id", u.id).select(),
        u.client.from("financial_profiles").update({ persona_code: null }).eq("user_id", u.id).select(),
        u.client.from("financial_profiles").update({ is_demo: true }).eq("user_id", u.id).select(),
        u.client.from("financial_profiles").update({ user_id: other.id }).eq("user_id", u.id).select(),
        u.client.from("financial_profiles").update({ persona_code: "at_risk", is_demo: true, minimum_reserve_vnd: 1 }).eq("user_id", u.id).select(),
      ];
      for (const a of attempts) {
        const res = await a;
        expect(isDenied(res.error), JSON.stringify(res.error)).toBe(true);
      }
      expect(await profileOf(u.id)).toEqual(before);
      expect((await profileOf(other.id)).persona_code).toBe("worker");
    });

    it("client can still change non-protected columns, including balance_snapshot_* (documented decision)", async () => {
      const u = await createUser("student");
      const res = await u.client
        .from("financial_profiles")
        .update({ display_name: "Minh", minimum_reserve_vnd: 123456, balance_snapshot_vnd: 777, balance_snapshot_at: new Date().toISOString() })
        .eq("user_id", u.id)
        .select()
        .single();
      expect(res.error).toBeNull();
      expect(res.data?.display_name).toBe("Minh");
      expect(Number(res.data?.minimum_reserve_vnd)).toBe(123456);
    });

    it("an unchanged persona_code/is_demo echoed in a full-row update is accepted", async () => {
      const u = await createUser("student");
      const before = await profileOf(u.id);
      const res = await u.client
        .from("financial_profiles")
        .update({ persona_code: before.persona_code, is_demo: before.is_demo, display_name: "Echo" })
        .eq("user_id", u.id)
        .select();
      expect(res.error).toBeNull();
      expect(res.data).toHaveLength(1);
    });

    it("client cannot insert is_demo = true or a persona_code; a plain insert is allowed", async () => {
      const client = newClient(url, anonKey);
      const { data, error } = await client.auth.signInAnonymously();
      if (error || !data.user) throw new Error("anonymous sign-in failed");
      created.push(data.user.id);
      const id = data.user.id;

      const demo = await client.from("financial_profiles").insert({ user_id: id, is_demo: true });
      expect(isDenied(demo.error), JSON.stringify(demo.error)).toBe(true);
      const persona = await client.from("financial_profiles").insert({ user_id: id, persona_code: "student" });
      expect(isDenied(persona.error), JSON.stringify(persona.error)).toBe(true);
      const upsertDemo = await client.from("financial_profiles").upsert({ user_id: id, is_demo: true }, { onConflict: "user_id" });
      expect(isDenied(upsertDemo.error), JSON.stringify(upsertDemo.error)).toBe(true);
      expect(await count("financial_profiles", id)).toBe(0);

      const plain = await client.from("financial_profiles").insert({ user_id: id });
      expect(plain.error).toBeNull();
      expect(await profileOf(id)).toMatchObject({ persona_code: null, is_demo: false });
    });

    it("server paths still set the protected columns (service_role, bootstrap_profile, reset_user_to_persona)", async () => {
      const u = await createUser("student");
      const viaService = await service.from("financial_profiles").update({ persona_code: "worker", is_demo: true }).eq("user_id", u.id);
      expect(viaService.error).toBeNull();
      expect(await profileOf(u.id)).toMatchObject({ persona_code: "worker", is_demo: true });

      const reset = await service.rpc("reset_user_to_persona", {
        p_user_id: u.id,
        p_idempotency_key: randomUUID(),
        p_template: {
          persona_code: "at_risk",
          profile: {
            display_name: "Reset",
            balance_snapshot_vnd: "1000",
            balance_snapshot_at: "2026-11-23T09:00:00+07:00",
            expected_monthly_income_vnd: "1",
            payday_day: 5,
            expected_daily_expense_vnd: "1",
            projected_monthly_budget_vnd: "1",
            minimum_reserve_vnd: "1",
            is_demo: true,
          },
          recurring_items: [],
          transactions: [],
          goal: { name: "g", target_vnd: "10", saved_vnd: "0" },
        },
      });
      expect(reset.error).toBeNull();
      expect(await profileOf(u.id)).toMatchObject({ persona_code: "at_risk", is_demo: true });
    });
  });

  describe("commit_csv_import", () => {
    const rpc = (userId: string, key: string, rows: unknown, rejected = 0, filename: string | null = "t.csv") =>
      service.rpc("commit_csv_import", {
        p_user_id: userId,
        p_idempotency_key: key,
        p_filename: filename,
        p_rows: rows,
        p_rejected_count: rejected,
      });

    it("is not callable by the anon role or by an authenticated user (even for its own id)", async () => {
      const u = await createUser();
      for (const client of [anonOnly, u.client]) {
        const res = await client.rpc("commit_csv_import", {
          p_user_id: u.id,
          p_idempotency_key: randomUUID(),
          p_filename: null,
          p_rows: [csvRow(1)],
          p_rejected_count: 0,
        });
        expect(isDenied(res.error), JSON.stringify(res.error)).toBe(true);
        expect(res.data ?? null).toBeNull();
      }
      expect(await count("import_batches", u.id)).toBe(0);
      expect(await count("transactions", u.id)).toBe(0);
    });

    it("commits a batch and all rows, then replays the same key without inserting", async () => {
      const u = await createUser();
      const key = randomUUID();
      const rows = Array.from({ length: 25 }, (_, i) => csvRow(i));
      const first = await rpc(u.id, key, rows, 3);
      expect(first.error).toBeNull();
      expect(first.data).toMatchObject({ replayed: false, accepted_count: 25, rejected_count: 3, status: "committed" });
      const batchId = (first.data as { batch_id: string }).batch_id;
      expect(await count("transactions", u.id)).toBe(25);

      const { data: txs } = await service.from("transactions").select("source,import_batch_id,fingerprint").eq("user_id", u.id);
      expect(txs?.every((t) => t.source === "csv" && t.import_batch_id === batchId && t.fingerprint !== null)).toBe(true);

      const replay = await rpc(u.id, key, [csvRow(99)], 0);
      expect(replay.error).toBeNull();
      expect(replay.data).toMatchObject({ replayed: true, batch_id: batchId, accepted_count: 25, rejected_count: 3 });
      expect(await count("transactions", u.id)).toBe(25);
      expect(await count("import_batches", u.id)).toBe(1);
    });

    it("is atomic: one bad row leaves no batch and no transactions", async () => {
      const u = await createUser();
      const bad = [csvRow(1), csvRow(2), { ...csvRow(3), amount_vnd: "9007199254740992" }];
      const res = await rpc(u.id, randomUUID(), bad);
      expect(res.error).not.toBeNull();
      expect(await count("import_batches", u.id)).toBe(0);
      expect(await count("transactions", u.id)).toBe(0);

      const smuggled = await rpc(u.id, randomUUID(), [{ ...csvRow(1), user_id: randomUUID() }]);
      expect(smuggled.error).not.toBeNull();
      const badDate = await rpc(u.id, randomUUID(), [csvRow(1), { ...csvRow(2), occurred_at: "2026-13-45T10:00:00Z" }]);
      expect(badDate.error).not.toBeNull();
      expect(await count("import_batches", u.id)).toBe(0);
      expect(await count("transactions", u.id)).toBe(0);
    });

    it("writes only for p_user_id and never touches another user's rows", async () => {
      const a = await createUser();
      const b = await createUser();
      expect((await rpc(b.id, randomUUID(), [csvRow(1), csvRow(2)])).error).toBeNull();
      expect((await rpc(a.id, randomUUID(), [csvRow(3)])).error).toBeNull();
      expect(await count("transactions", a.id)).toBe(1);
      expect(await count("transactions", b.id)).toBe(2);
      // The same key under another user is an independent batch.
      const key = randomUUID();
      expect((await rpc(a.id, key, [csvRow(4)])).data).toMatchObject({ replayed: false });
      expect((await rpc(b.id, key, [csvRow(5)])).data).toMatchObject({ replayed: false });
    });

    it("50 concurrent calls with one key produce exactly one batch and one set of rows", async () => {
      const u = await createUser();
      const key = randomUUID();
      const rows = Array.from({ length: 100 }, (_, i) => csvRow(i));
      const results = await Promise.all(Array.from({ length: 50 }, () => rpc(u.id, key, rows, 1)));
      for (const r of results) expect(r.error).toBeNull();
      expect(results.filter((r) => (r.data as { replayed: boolean }).replayed === false)).toHaveLength(1);
      expect(new Set(results.map((r) => (r.data as { batch_id: string }).batch_id)).size).toBe(1);
      expect(await count("import_batches", u.id)).toBe(1);
      expect(await count("transactions", u.id)).toBe(100);
    }, 120_000);
  });
});
