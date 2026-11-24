import { randomUUID } from "node:crypto";

/**
 * Small in-memory interpreter for the PostgREST chains used by the assistant code:
 * select/insert/update/upsert, eq/gt/gte/lt/is, order/limit/range, single/maybeSingle, plus the
 * quota RPCs (reserve/release/commit) with the SQL semantics. Values are compared as strings
 * (bigint columns arrive as numbers or decimal strings). RLS is NOT emulated: tests assert the
 * code scopes every query by user_id itself. No network.
 */
export type Row = Record<string, unknown>;

const PK: Record<string, string> = { financial_profiles: "user_id", savings_goals: "user_id" };

export interface MemoryDb {
  tables: Record<string, Row[]>;
  log: { table: string; op: string; filters: [string, string, unknown][] }[];
  rpcLog: { fn: string; args: Record<string, unknown> }[];
  client: { from: (t: string) => unknown };
  admin: { from: (t: string) => unknown; rpc: (fn: string, args: Record<string, unknown>) => Promise<unknown> };
  failNext: { table: string; op: string } | null;
}

export function createMemoryDb(seed: Record<string, Row[]> = {}): MemoryDb {
  const db: MemoryDb = {
    tables: Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
    log: [],
    rpcLog: [],
    client: { from: () => undefined },
    admin: { from: () => undefined, rpc: async () => undefined },
    failNext: null,
  };
  const table = (name: string) => (db.tables[name] ??= []);

  class Q implements PromiseLike<{ data: unknown; error: unknown }> {
    op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    filters: [string, string, unknown][] = [];
    payload: Row[] = [];
    patch: Row = {};
    returning = false;
    mode: "many" | "single" | "maybe" = "many";
    orderBy: [string, boolean] | null = null;
    max: number | null = null;
    window: [number, number] | null = null;
    constructor(readonly name: string) {}
    select() {
      this.returning = true;
      return this;
    }
    insert(p: Row | Row[]) {
      this.op = "insert";
      this.payload = Array.isArray(p) ? p : [p];
      return this;
    }
    upsert(p: Row) {
      this.op = "upsert";
      this.payload = [p];
      return this;
    }
    update(p: Row) {
      this.op = "update";
      this.patch = p;
      return this;
    }
    delete() {
      this.op = "delete";
      return this;
    }
    eq(c: string, v: unknown) {
      this.filters.push([c, "eq", v]);
      return this;
    }
    gt(c: string, v: unknown) {
      this.filters.push([c, "gt", v]);
      return this;
    }
    gte(c: string, v: unknown) {
      this.filters.push([c, "gte", v]);
      return this;
    }
    lt(c: string, v: unknown) {
      this.filters.push([c, "lt", v]);
      return this;
    }
    is(c: string, v: unknown) {
      this.filters.push([c, "is", v]);
      return this;
    }
    order(c: string, o: { ascending: boolean }) {
      this.orderBy = [c, o.ascending];
      return this;
    }
    limit(n: number) {
      this.max = n;
      return this;
    }
    range(a: number, b: number) {
      this.window = [a, b];
      return this;
    }
    single() {
      this.mode = "single";
      return this;
    }
    maybeSingle() {
      this.mode = "maybe";
      return this;
    }
    private match(r: Row) {
      return this.filters.every(([c, k, v]) => {
        const a = r[c];
        if (k === "eq") return String(a) === String(v);
        if (k === "is") return (a ?? null) === v;
        const ta = Date.parse(String(a));
        const tv = Date.parse(String(v));
        const [x, y] = Number.isFinite(ta) && Number.isFinite(tv) ? [ta, tv] : [String(a), String(v)];
        return k === "gt" ? x > y : k === "gte" ? x >= y : x < y;
      });
    }
    private shape(rows: Row[]) {
      if (this.mode === "single") return rows[0] ? { data: rows[0], error: null } : { data: null, error: { code: "PGRST116" } };
      if (this.mode === "maybe") return { data: rows[0] ?? null, error: null };
      return { data: this.returning || this.op === "select" ? rows : null, error: null };
    }
    run() {
      db.log.push({ table: this.name, op: this.op, filters: this.filters });
      if (db.failNext && db.failNext.table === this.name && db.failNext.op === this.op) {
        db.failNext = null;
        return { data: null, error: { code: "XX000", message: "injected" } };
      }
      const rows = table(this.name);
      const now = new Date().toISOString();
      if (this.op === "insert" || this.op === "upsert") {
        const out: Row[] = [];
        for (const p of this.payload) {
          const pk = PK[this.name];
          const existing = pk ? rows.find((r) => r[pk] === p[pk]) : undefined;
          if (existing && this.op === "insert") return { data: null, error: { code: "23505" } };
          if (existing) {
            Object.assign(existing, p, { updated_at: now });
            out.push(existing);
            continue;
          }
          const row = { id: randomUUID(), created_at: now, updated_at: now, ...p };
          rows.push(row);
          out.push(row);
        }
        return this.shape(out);
      }
      if (this.op === "update") {
        const hits = rows.filter((r) => this.match(r));
        for (const r of hits) Object.assign(r, this.patch, { updated_at: now });
        return this.shape(hits);
      }
      if (this.op === "delete") {
        const keep = rows.filter((r) => !this.match(r));
        db.tables[this.name] = keep;
        return this.shape([]);
      }
      let out = rows.filter((r) => this.match(r));
      if (this.orderBy) {
        const [c, asc] = this.orderBy;
        out = [...out].sort((a, b) => (String(a[c]) < String(b[c]) ? -1 : String(a[c]) > String(b[c]) ? 1 : 0) * (asc ? 1 : -1));
      }
      if (this.window) out = out.slice(this.window[0], this.window[1] + 1);
      if (this.max !== null) out = out.slice(0, this.max);
      return this.shape(out);
    }
    then<A = unknown, B = never>(
      ok?: ((v: { data: unknown; error: unknown }) => A | PromiseLike<A>) | null,
      bad?: ((e: unknown) => B | PromiseLike<B>) | null,
    ): PromiseLike<A | B> {
      return Promise.resolve().then(() => this.run()).then(ok, bad);
    }
  }

  const from = (t: string) => new Q(t);
  const vnDate = () => new Date(Date.now() + 7 * 3600_000).toISOString().slice(0, 10);
  const rpc = async (fn: string, args: Record<string, unknown>) => {
    db.rpcLog.push({ fn, args });
    const reservations = table("ai_quota_reservations");
    const usage = table("ai_usage_daily");
    const counter = (userId: unknown, date: string) => {
      let row = usage.find((u) => u.user_id === userId && u.usage_date === date);
      if (!row) {
        row = { user_id: userId, usage_date: date, chat_calls: 0, scan_calls: 0 };
        usage.push(row);
      }
      return row;
    };
    if (fn === "reserve_ai_quota") {
      const existing = reservations.find((r) => r.request_id === args.p_request_id);
      if (existing) return { data: existing.status !== "released", error: null };
      const date = vnDate();
      const c = counter(args.p_user_id, date);
      const col = args.p_kind === "chat" ? "chat_calls" : "scan_calls";
      if ((c[col] as number) >= (args.p_limit as number)) return { data: false, error: null };
      c[col] = (c[col] as number) + 1;
      reservations.push({ request_id: args.p_request_id, user_id: args.p_user_id, kind: args.p_kind, usage_date: date, status: "reserved" });
      return { data: true, error: null };
    }
    if (fn === "release_ai_quota" || fn === "commit_ai_quota") {
      const r = reservations.find((x) => x.request_id === args.p_request_id && x.user_id === args.p_user_id);
      if (!r || r.status !== "reserved") return { data: false, error: null };
      if (fn === "release_ai_quota") {
        const c = counter(r.user_id, r.usage_date as string);
        const col = r.kind === "chat" ? "chat_calls" : "scan_calls";
        c[col] = Math.max(0, (c[col] as number) - 1);
        r.status = "released";
      } else r.status = "committed";
      return { data: true, error: null };
    }
    return { data: null, error: { code: "PGRST202", message: "function not found" } };
  };
  db.client = { from };
  db.admin = { from, rpc };
  return db;
}
