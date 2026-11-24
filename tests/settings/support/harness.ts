import {
  OTHER_ID,
  OWNER_ID,
  createFakeClient,
  goalRow,
  profileRow,
  recurringRow,
  transactionRow,
  type FakeClient,
  type FakeResult,
  type RecordedQuery,
} from "../../db/repositories/support/fake-client";

export { OTHER_ID, OWNER_ID, goalRow, profileRow, recurringRow, transactionRow };

export type Row = Record<string, unknown>;

export const ORIGIN = "http://localhost:3000";
/** 2026-11-24 12:00 Asia/Ho_Chi_Minh. */
export const NOW = new Date("2026-11-24T05:00:00Z");
const NOW_ISO = "2026-11-24T05:00:00+00:00";

export interface FakeDb {
  tables: Record<string, Row[]>;
  fake: FakeClient;
}

/**
 * In-memory interpreter for the PostgREST-style chains the settings repositories emit:
 * select/eq/order/range, update, upsert (keyed by user_id, like the real primary keys) and delete.
 * RLS is deliberately NOT emulated: tests prove every query is scoped by user_id itself.
 */
export function createSettingsDb(seed: Record<string, Row[]> = {}): FakeDb {
  const tables: Record<string, Row[]> = {
    transactions: [],
    recurring_items: [],
    financial_profiles: [],
    savings_goals: [],
    ...Object.fromEntries(Object.entries(seed).map(([k, v]) => [k, v.map((r) => ({ ...r }))])),
  };
  const respond = (q: RecordedQuery): FakeResult => {
    const table = (tables[q.table] ??= []);
    const calls = (m: string) => q.calls.filter((c) => c.method === m);
    const eqs = calls("eq").map((c) => [c.args[0] as string, c.args[1]] as const);
    const matches = (r: Row) => eqs.every(([k, v]) => r[k] === v);
    const shape = (rows: Row[]): FakeResult => {
      if (calls("single").length > 0) return rows[0] ? { data: rows[0] } : { error: { code: "PGRST116" } };
      if (calls("maybeSingle").length > 0) return { data: rows[0] ?? null };
      return { data: rows };
    };
    const upsert = calls("upsert")[0];
    if (upsert) {
      const payload = upsert.args[0] as Row;
      const existing = table.find((r) => r.user_id === payload.user_id);
      if (existing) {
        Object.assign(existing, payload, { updated_at: NOW_ISO });
        return shape([existing]);
      }
      const row = { updated_at: NOW_ISO, ...payload };
      table.push(row);
      return shape([row]);
    }
    const update = calls("update")[0];
    if (update) {
      const hits = table.filter(matches);
      for (const row of hits) Object.assign(row, update.args[0] as Row, { updated_at: NOW_ISO });
      return shape(hits);
    }
    if (calls("delete").length > 0) {
      const hits = table.filter(matches);
      tables[q.table] = table.filter((r) => !hits.includes(r));
      return { data: hits.map((r) => ({ user_id: r.user_id })) };
    }
    let rows = table.filter(matches);
    const order = calls("order")[0];
    if (order) {
      const col = order.args[0] as string;
      rows = [...rows].sort((a, b) => (String(a[col]) < String(b[col]) ? -1 : String(a[col]) > String(b[col]) ? 1 : 0));
    }
    const range = calls("range")[0];
    if (range) rows = rows.slice(range.args[0] as number, (range.args[1] as number) + 1);
    return shape(rows);
  };
  return { tables, fake: createFakeClient(respond) };
}

export interface Harness {
  user: { id: string; is_anonymous: boolean } | null;
  db: FakeDb;
}

export const harness: Harness = { user: null, db: createSettingsDb() };

export const owned = (row: Row): Row => ({ ...row, user_id: OWNER_ID });
export const foreign = (row: Row): Row => ({ ...row, user_id: OTHER_ID });

export function resetHarness(
  seed: Record<string, Row[]> = {},
  user: Harness["user"] = { id: OWNER_ID, is_anonymous: true },
  withProfile = true,
): void {
  harness.user = user;
  harness.db = createSettingsDb({ ...(withProfile ? { financial_profiles: [owned(profileRow())] } : {}), ...seed });
}

export const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const seedItem = (over: Row = {}): Row => owned(recurringRow({ id: ITEM_ID, ...over }));

export function request(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

export const writesOf = (db: FakeDb): RecordedQuery[] =>
  db.fake.queries.filter((q) => q.calls.some((c) => ["insert", "update", "delete", "upsert"].includes(c.method)));
export const queriesOn = (db: FakeDb, table: string): RecordedQuery[] => db.fake.queries.filter((q) => q.table === table);
