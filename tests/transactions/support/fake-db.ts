import { createFakeClient, type FakeClient, type FakeResult, type RecordedQuery } from "../../db/repositories/support/fake-client";

/**
 * Tiny in-memory interpreter for the PostgREST-style call chains the repositories emit. It is
 * NOT the real database: it applies `eq` / `gte` / `lt` / `order` / `range` / `limit` filters and
 * the `transactions_unique_recurring_posting` + pair check constraints, and it deliberately does
 * NOT emulate RLS (so tests prove the repositories scope every query by user_id themselves).
 * `.or(...)` (search) is recorded but not evaluated.
 */
export type Row = Record<string, unknown>;

export interface FakeDb {
  tables: Record<string, Row[]>;
  fake: FakeClient;
}

let counter = 0;
const nextId = (): string => {
  counter += 1;
  return `00000000-0000-4000-8000-${String(counter).padStart(12, "0")}`;
};

const NOW_ISO = "2026-11-24T05:00:00+00:00";

export function createFakeDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {
    transactions: [],
    recurring_items: [],
    financial_profiles: [],
    ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  };

  const respond = (q: RecordedQuery): FakeResult => {
    const table = (tables[q.table] ??= []);
    const calls = (method: string) => q.calls.filter((c) => c.method === method);
    const eqs = calls("eq").map((c) => [c.args[0] as string, c.args[1]] as const);
    const gtes = calls("gte").map((c) => [c.args[0] as string, Date.parse(String(c.args[1]))] as const);
    const lts = calls("lt").map((c) => [c.args[0] as string, Date.parse(String(c.args[1]))] as const);
    const matches = (r: Row): boolean =>
      eqs.every(([k, v]) => r[k] === v) &&
      gtes.every(([k, v]) => Date.parse(String(r[k])) >= v) &&
      lts.every(([k, v]) => Date.parse(String(r[k])) < v);

    const postingConflict = (candidate: Row, ignore?: Row): boolean =>
      q.table === "transactions" &&
      candidate.recurring_item_id != null &&
      table.some(
        (r) =>
          r !== ignore &&
          r.user_id === candidate.user_id &&
          r.recurring_item_id === candidate.recurring_item_id &&
          r.recurring_instance_date === candidate.recurring_instance_date,
      );
    const pairBroken = (r: Row): boolean =>
      q.table === "transactions" && (r.recurring_item_id == null) !== (r.recurring_instance_date == null);
    const shape = (rows: Row[]): FakeResult => {
      if (calls("single").length > 0) return rows[0] ? { data: rows[0] } : { error: { code: "PGRST116" } };
      if (calls("maybeSingle").length > 0) return { data: rows[0] ?? null };
      return { data: rows };
    };

    const insert = calls("insert")[0];
    if (insert) {
      const payload = insert.args[0] as Row;
      const row: Row = {
        id: nextId(),
        merchant: null,
        description: null,
        fingerprint: null,
        import_batch_id: null,
        recurring_item_id: null,
        recurring_instance_date: null,
        end_date: null,
        active: true,
        created_at: NOW_ISO,
        updated_at: NOW_ISO,
        ...payload,
      };
      if (pairBroken(row)) return { error: { code: "23514" } };
      if (postingConflict(row)) return { error: { code: "23505" } };
      table.push(row);
      return shape([row]);
    }

    const update = calls("update")[0];
    if (update) {
      const hits = table.filter(matches);
      const patch = update.args[0] as Row;
      for (const row of hits) {
        const next = { ...row, ...patch };
        if (pairBroken(next)) return { error: { code: "23514" } };
        if (postingConflict(next, row)) return { error: { code: "23505" } };
      }
      for (const row of hits) Object.assign(row, patch, { updated_at: NOW_ISO });
      return shape(hits);
    }

    if (calls("delete").length > 0) {
      const hits = table.filter(matches);
      tables[q.table] = table.filter((r) => !hits.includes(r));
      return { data: hits.map((r) => ({ id: r.id })) };
    }

    let rows = table.filter(matches);
    const order = calls("order")[0];
    if (order) {
      const col = order.args[0] as string;
      const dir = (order.args[1] as { ascending?: boolean } | undefined)?.ascending === false ? -1 : 1;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -dir : String(a[col]) > String(b[col]) ? dir : 0));
    }
    const range = calls("range")[0];
    if (range) rows = rows.slice(range.args[0] as number, (range.args[1] as number) + 1);
    const limit = calls("limit")[0];
    if (limit) rows = rows.slice(0, limit.args[0] as number);
    return shape(rows);
  };

  const fake = createFakeClient(respond);
  return { tables, fake };
}

export const queriesOn = (db: FakeDb, table: string): RecordedQuery[] => db.fake.queries.filter((q) => q.table === table);
export const writesOf = (db: FakeDb): RecordedQuery[] =>
  db.fake.queries.filter((q) => q.calls.some((c) => ["insert", "update", "delete", "upsert"].includes(c.method)));
