import type { User } from "@supabase/supabase-js";
import { ownerContextFromVerifiedUser, type OwnerContext } from "@/lib/auth/owner-context";
import type { DbClient } from "@/lib/db/repositories/shared";
import type { RpcClient } from "@/lib/db/repositories/server-only/rpc";

/** In-memory stand-in for the Supabase builder. Records every call; never touches a network. */
export interface Call {
  method: string;
  args: unknown[];
}
export interface RecordedQuery {
  table: string;
  calls: Call[];
}
export interface FakeResult {
  data?: unknown;
  error?: { code?: string; message?: string; status?: number } | null;
}
export type Responder = (query: RecordedQuery) => FakeResult | Promise<FakeResult>;
export type RpcResponder = (fn: string, args: Record<string, unknown>) => FakeResult | Promise<FakeResult>;

export interface FakeClient {
  client: DbClient & RpcClient;
  queries: RecordedQuery[];
  rpcCalls: { fn: string; args: Record<string, unknown> }[];
}

export function createFakeClient(
  responder: Responder = () => ({ data: null }),
  rpcResponder: RpcResponder = () => ({ data: null, error: { code: "PGRST202" } }),
): FakeClient {
  const queries: RecordedQuery[] = [];
  const rpcCalls: FakeClient["rpcCalls"] = [];
  const settle = async (r: FakeResult | Promise<FakeResult>) => {
    const value = await r;
    return { data: value.data ?? null, error: value.error ?? null };
  };
  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, calls: [] };
      queries.push(query);
      const proxy: unknown = new Proxy(
        {},
        {
          get(_t, prop) {
            if (prop === "then") {
              return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
                settle(responder(query)).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              query.calls.push({ method: String(prop), args });
              return proxy;
            };
          },
        },
      );
      return proxy;
    },
    rpc(fn: string, args: Record<string, unknown>) {
      rpcCalls.push({ fn, args });
      return { then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => settle(rpcResponder(fn, args)).then(resolve, reject) };
    },
  };
  return { client: client as unknown as DbClient & RpcClient, queries, rpcCalls };
}

export const OWNER_ID = "11111111-1111-4111-8111-111111111111";
export const OTHER_ID = "22222222-2222-4222-8222-222222222222";

export function makeOwner(id: string = OWNER_ID): OwnerContext {
  return ownerContextFromVerifiedUser({ userId: id, user: { id } as User, isAnonymous: false });
}

export const callsOf = (q: RecordedQuery, method: string) => q.calls.filter((c) => c.method === method);
export const hasCall = (q: RecordedQuery, method: string, ...args: unknown[]) =>
  q.calls.some((c) => c.method === method && args.every((a, i) => c.args[i] === a));
/**
 * True when the query is explicitly scoped to `userId`: either `.eq('user_id', userId)`, or a
 * write whose payload carries `user_id === userId` (insert/upsert have no filter to scope).
 */
export const isOwnerScoped = (q: RecordedQuery, userId: string) =>
  hasCall(q, "eq", "user_id", userId) ||
  q.calls.some(
    (c) =>
      (c.method === "insert" || c.method === "upsert") &&
      (c.args[0] as { user_id?: string } | undefined)?.user_id === userId,
  );

export const ROW_ID = "33333333-3333-4333-8333-333333333333";
export const ROW_ID_2 = "44444444-4444-4444-8444-444444444444";

export const transactionRow = (over: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  occurred_at: "2026-11-20T05:30:00+00:00",
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
  created_at: "2026-11-20T05:31:00.123456+00:00",
  updated_at: "2026-11-20T05:31:00.123456+00:00",
  ...over,
});
export const recurringRow = (over: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  label: "Tiền nhà",
  kind: "expense",
  amount_vnd: 1500000,
  day_of_month: 5,
  category: "rent",
  start_date: "2026-01-05",
  end_date: null,
  active: true,
  created_at: "2026-11-01T00:00:00+00:00",
  updated_at: "2026-11-01T00:00:00+00:00",
  ...over,
});
export const profileRow = (over: Record<string, unknown> = {}) => ({
  persona_code: "student",
  display_name: "Minh",
  balance_snapshot_vnd: "2500000",
  balance_snapshot_at: "2026-11-15T03:00:00+00:00",
  expected_monthly_income_vnd: 6000000,
  payday_day: 5,
  expected_daily_expense_vnd: 120000,
  projected_monthly_budget_vnd: 4000000,
  minimum_reserve_vnd: 300000,
  is_demo: true,
  updated_at: "2026-11-15T03:00:00+00:00",
  ...over,
});
export const goalRow = (over: Record<string, unknown> = {}) => ({
  name: "Laptop",
  target_vnd: 15000000,
  saved_vnd: 2000000,
  target_date: "2027-03-01",
  updated_at: "2026-11-15T03:00:00+00:00",
  ...over,
});
export const batchRow = (over: Record<string, unknown> = {}) => ({
  id: ROW_ID,
  idempotency_key: "key-1",
  source: "csv",
  filename: "bank.csv",
  status: "committed",
  accepted_count: 10,
  rejected_count: 1,
  created_at: "2026-11-20T05:31:00+00:00",
  ...over,
});
