import { randomUUID } from "node:crypto";
import type { User } from "@supabase/supabase-js";
import { ownerContextFromVerifiedUser, type OwnerContext } from "@/lib/auth/owner-context";
import type { DbClient } from "@/lib/db/repositories/shared";
import type { RpcClient } from "@/lib/db/repositories/server-only/rpc";

/**
 * In-memory stand-in for the slice of PostgREST the import code uses: select/eq/gte/lt/order/range,
 * insert (single or bulk) with `.select()`, update, `maybeSingle()`. Enforces the SQL unique
 * constraint (user_id, idempotency_key) with a Postgres 23505 error. Nothing touches a network.
 */
export const OWNER_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ID = "22222222-2222-4222-8222-222222222222";

export const makeOwner = (id: string = OWNER_ID): OwnerContext =>
  ownerContextFromVerifiedUser({ userId: id, user: { id } as User, isAnonymous: false });

type Row = Record<string, unknown>;
type Table = "import_batches" | "transactions" | "financial_profiles";

export interface WriteLog {
  readonly table: string;
  readonly op: "insert" | "update" | "delete";
  readonly rows: number;
}

export interface FakeDb {
  client: DbClient;
  /** Stand-in for the service-role client: only `rpc("commit_csv_import")` is emulated. */
  rpc: RpcClient;
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
  tables: Record<Table, Row[]>;
  writes: WriteLog[];
  selects: { table: string; filters: [string, string, unknown][] }[];
  /** Make the next write on `table` fail with this error (then reset). */
  failNext: { table: Table; op: "insert" | "update"; error: { code: string } } | null;
  /** Runs right before an insert is applied (used to simulate a concurrent request). */
  beforeInsert: ((table: Table, db: FakeDb) => void) | null;
}

export function profileRow(over: Row = {}): Row {
  return {
    user_id: OWNER_ID,
    persona_code: "student",
    display_name: "Minh",
    balance_snapshot_vnd: "2500000",
    balance_snapshot_at: "2026-11-23T02:00:00+00:00",
    expected_monthly_income_vnd: 6000000,
    payday_day: 5,
    expected_daily_expense_vnd: 120000,
    projected_monthly_budget_vnd: 4000000,
    minimum_reserve_vnd: 300000,
    is_demo: true,
    updated_at: "2026-11-23T02:00:00+00:00",
    ...over,
  };
}

export function storedTransaction(over: Row = {}): Row {
  return {
    id: randomUUID(),
    user_id: OWNER_ID,
    occurred_at: "2026-11-01T05:30:00+00:00",
    kind: "expense",
    amount_vnd: 45000,
    category: "food",
    merchant: "Canteen",
    description: null,
    source: "manual",
    fingerprint: null,
    import_batch_id: null,
    recurring_item_id: null,
    recurring_instance_date: null,
    created_at: "2026-11-01T06:00:00+00:00",
    updated_at: "2026-11-01T06:00:00+00:00",
    ...over,
  };
}

const time = (v: unknown) => Date.parse(String(v));

export function createFakeDb(seed: Partial<Record<Table, Row[]>> = {}): FakeDb {
  const db: FakeDb = {
    client: undefined as unknown as DbClient,
    rpc: undefined as unknown as RpcClient,
    rpcCalls: [],
    tables: {
      import_batches: [...(seed.import_batches ?? [])],
      transactions: [...(seed.transactions ?? [])],
      financial_profiles: [...(seed.financial_profiles ?? [])],
    },
    writes: [],
    selects: [],
    failNext: null,
    beforeInsert: null,
  };

  class Query implements PromiseLike<{ data: unknown; error: { code: string } | null }> {
    private op: "select" | "insert" | "update" = "select";
    private filters: [string, string, unknown][] = [];
    private orders: [string, boolean][] = [];
    private window: [number, number] | null = null;
    private payload: Row[] = [];
    private patch: Row = {};
    private wantRows = false;
    private mode: "none" | "maybe" | "one" = "none";

    constructor(private readonly table: Table) {}

    select() {
      if (this.op === "select") db.selects.push({ table: this.table, filters: this.filters });
      this.wantRows = true;
      return this;
    }
    eq(col: string, value: unknown) {
      this.filters.push([col, "eq", value]);
      return this;
    }
    gte(col: string, value: unknown) {
      this.filters.push([col, "gte", value]);
      return this;
    }
    lt(col: string, value: unknown) {
      this.filters.push([col, "lt", value]);
      return this;
    }
    order(col: string, opts: { ascending: boolean }) {
      this.orders.push([col, opts.ascending]);
      return this;
    }
    range(from: number, to: number) {
      this.window = [from, to];
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this;
    }
    single() {
      this.mode = "one";
      return this;
    }
    insert(payload: Row | Row[]) {
      this.op = "insert";
      this.payload = Array.isArray(payload) ? payload : [payload];
      return this;
    }
    update(patch: Row) {
      this.op = "update";
      this.patch = patch;
      return this;
    }

    private matches(row: Row): boolean {
      return this.filters.every(([col, kind, value]) => {
        const actual = row[col];
        if (kind === "eq") return actual === value;
        if (col === "occurred_at") return kind === "gte" ? time(actual) >= time(value) : time(actual) < time(value);
        return kind === "gte" ? String(actual) >= String(value) : String(actual) < String(value);
      });
    }

    private run(): { data: unknown; error: { code: string } | null } {
      const rows = db.tables[this.table];
      if (db.failNext && db.failNext.table === this.table && db.failNext.op === this.op) {
        const { error } = db.failNext;
        db.failNext = null;
        return { data: null, error };
      }
      if (this.op === "insert") {
        db.beforeInsert?.(this.table, db);
        const created: Row[] = this.payload.map((p) => ({
          id: randomUUID(),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          filename: null,
          ...(this.table === "transactions"
            ? { description: null, merchant: null, recurring_item_id: null, recurring_instance_date: null }
            : {}),
          ...p,
        }));
        if (this.table === "import_batches") {
          for (const c of created) {
            const clash = rows.some((r) => r.user_id === c.user_id && r.idempotency_key === c.idempotency_key);
            if (clash) return { data: null, error: { code: "23505" } };
          }
        }
        rows.push(...created);
        db.writes.push({ table: this.table, op: "insert", rows: created.length });
        return { data: this.mode === "none" ? created : (created[0] ?? null), error: null };
      }
      if (this.op === "update") {
        const hit = rows.filter((r) => this.matches(r));
        for (const r of hit) Object.assign(r, this.patch);
        db.writes.push({ table: this.table, op: "update", rows: hit.length });
        return { data: null, error: null };
      }
      let out = rows.filter((r) => this.matches(r));
      for (const [col, asc] of [...this.orders].reverse()) {
        out = [...out].sort((a, b) => {
          const x = col === "occurred_at" ? time(a[col]) : String(a[col]);
          const y = col === "occurred_at" ? time(b[col]) : String(b[col]);
          return (x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1);
        });
      }
      if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
      if (this.mode === "maybe") return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }

    then<R1 = unknown, R2 = never>(
      onfulfilled?: ((value: { data: unknown; error: { code: string } | null }) => R1 | PromiseLike<R1>) | null,
      onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ): PromiseLike<R1 | R2> {
      return Promise.resolve().then(() => this.run()).then(onfulfilled, onrejected);
    }
  }

  db.client = { from: (table: string) => new Query(table as Table) } as unknown as DbClient;

  /**
   * Mirrors public.commit_csv_import (migration 0003): replay on an existing (user, key), else
   * batch + all rows in one step. All-or-nothing: an injected failure on either table stores
   * nothing. Writes are logged as one batch insert plus one bulk transaction insert.
   */
  const commitCsvImport = (args: Record<string, unknown>): { data: unknown; error: { code: string } | null } => {
    const userId = args.p_user_id as string;
    const key = args.p_idempotency_key as string;
    db.beforeInsert?.("import_batches", db);
    const existing = db.tables.import_batches.find((b) => b.user_id === userId && b.idempotency_key === key);
    if (existing) {
      return {
        data: {
          replayed: true,
          batch_id: existing.id,
          accepted_count: existing.accepted_count,
          rejected_count: existing.rejected_count,
          status: existing.status,
        },
        error: null,
      };
    }
    if (db.failNext && (db.failNext.table === "transactions" || db.failNext.table === "import_batches")) {
      const { error } = db.failNext;
      db.failNext = null;
      return { data: null, error };
    }
    const rows = args.p_rows as Row[];
    const now = new Date().toISOString();
    const batch: Row = {
      id: randomUUID(),
      user_id: userId,
      idempotency_key: key,
      source: "csv",
      filename: args.p_filename ?? null,
      status: "committed",
      accepted_count: rows.length,
      rejected_count: args.p_rejected_count,
      created_at: now,
    };
    db.tables.import_batches.push(batch);
    db.writes.push({ table: "import_batches", op: "insert", rows: 1 });
    db.tables.transactions.push(
      ...rows.map((r) => ({
        id: randomUUID(),
        user_id: userId,
        source: "csv",
        import_batch_id: batch.id,
        recurring_item_id: null,
        recurring_instance_date: null,
        created_at: now,
        updated_at: now,
        ...r,
      })),
    );
    db.writes.push({ table: "transactions", op: "insert", rows: rows.length });
    return {
      data: { replayed: false, batch_id: batch.id, accepted_count: rows.length, rejected_count: args.p_rejected_count, status: "committed" },
      error: null,
    };
  };
  db.rpc = {
    rpc: (fn: string, args: Record<string, unknown>) => {
      db.rpcCalls.push({ fn, args });
      return Promise.resolve().then(() =>
        fn === "commit_csv_import" ? commitCsvImport(args) : { data: null, error: { code: "PGRST202" } },
      );
    },
  } as unknown as RpcClient;
  return db;
}

export const seedProfile = (db: FakeDb, over: Row = {}) => {
  db.tables.financial_profiles.push(profileRow(over));
};
