import { OWNER_ID, OTHER_ID, profileRow, recurringRow, transactionRow } from "../../db/repositories/support/fake-client";
import { createFakeDb, type FakeDb, type Row } from "./fake-db";

export { OWNER_ID, OTHER_ID };
export const ORIGIN = "http://localhost:3000";
/** 2026-11-24 12:00 Asia/Ho_Chi_Minh. Profile snapshot is 2026-11-15 10:00 local (03:00Z). */
export const NOW = new Date("2026-11-24T05:00:00Z");

export interface Harness {
  user: { id: string; is_anonymous: boolean } | null;
  db: FakeDb;
  adminCreated: number;
}

export const harness: Harness = { user: null, db: createFakeDb(), adminCreated: 0 };

export const ITEM_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
export const TX_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

export const owned = (row: Row): Row => ({ ...row, user_id: OWNER_ID });
export const foreign = (row: Row): Row => ({ ...row, user_id: OTHER_ID });

export function resetHarness(seed: Record<string, Row[]> = {}, user: Harness["user"] = { id: OWNER_ID, is_anonymous: true }): void {
  harness.user = user;
  harness.adminCreated = 0;
  harness.db = createFakeDb({
    financial_profiles: [owned(profileRow())],
    ...seed,
  });
}

export const seedTx = (over: Row = {}): Row => owned(transactionRow({ id: TX_ID, ...over }));
export const seedItem = (over: Row = {}): Row => owned(recurringRow({ id: ITEM_ID, ...over }));

export function request(method: string, path: string, body?: unknown, headers: Record<string, string> = { origin: ORIGIN }): Request {
  return new Request(`${ORIGIN}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }),
  });
}

export const idContext = (id: string) => ({ params: Promise.resolve({ id }) });
