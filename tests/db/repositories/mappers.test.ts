import { describe, expect, it } from "vitest";
import { isDbError, type DbError } from "@/lib/db/errors";
import { transactionCreateSchema, parseInput, recurringCreateSchema, goalUpsertSchema, profileUpdateSchema } from "@/lib/db/inputs";
import {
  mapGoalRow,
  mapImportBatchRow,
  mapProfileRow,
  mapRecurringRow,
  mapTransactionRow,
  toGoalUpsert,
  toProfileUpdate,
  toRecurringInsert,
  toTransactionInsert,
  toTransactionUpdate,
} from "@/lib/db/mappers";
import { batchRow, goalRow, OWNER_ID, profileRow, recurringRow, transactionRow } from "./support/fake-client";

describe("row -> domain mappers", () => {
  it("maps a transaction: timestamptz -> Date, date string unchanged, money -> bigint", () => {
    const t = mapTransactionRow(
      transactionRow({ amount_vnd: "45000", recurring_item_id: "55555555-5555-4555-8555-555555555555", recurring_instance_date: "2026-11-05" }),
    );
    expect(t.occurredAt).toEqual(new Date("2026-11-20T05:30:00Z"));
    expect(t.amountVnd).toBe(45000n);
    expect(t.recurringInstanceDate).toBe("2026-11-05");
    expect(t.kind).toBe("expense");
    expect(t.createdAt.getTime()).toBeGreaterThan(0);
  });

  it("maps a profile with a negative snapshot and keeps payday null", () => {
    const p = mapProfileRow(profileRow({ balance_snapshot_vnd: -50000, payday_day: null }));
    expect(p.balanceSnapshotVnd).toBe(-50000n);
    expect(p.paydayDay).toBeNull();
    expect(p.balanceSnapshotAt).toEqual(new Date("2026-11-15T03:00:00Z"));
    expect(p.minimumReserveVnd).toBe(300000n);
  });

  it("maps recurring/goal/batch rows", () => {
    expect(mapRecurringRow(recurringRow({ end_date: "2026-12-31" }))).toMatchObject({ amountVnd: 1500000n, endDate: "2026-12-31", startDate: "2026-01-05", dayOfMonth: 5 });
    expect(mapGoalRow(goalRow({ target_date: null }))).toMatchObject({ targetVnd: 15000000n, savedVnd: 2000000n, targetDate: null });
    expect(mapImportBatchRow(batchRow())).toMatchObject({ idempotencyKey: "key-1", acceptedCount: 10 });
  });

  it("is independent of the host timezone (date columns never go through Date)", () => {
    // vitest config runs with TZ=America/New_York; a date near midnight must stay as stored.
    expect(mapRecurringRow(recurringRow({ start_date: "2026-03-01" })).startDate).toBe("2026-03-01");
  });

  const SECRET = "sb-secret-DO-NOT-LEAK";
  it.each([
    ["negative amount", () => mapTransactionRow(transactionRow({ amount_vnd: -1 }))],
    ["zero amount", () => mapTransactionRow(transactionRow({ amount_vnd: 0 }))],
    ["fractional amount", () => mapTransactionRow(transactionRow({ amount_vnd: 10.5 }))],
    ["unsafe amount", () => mapTransactionRow(transactionRow({ amount_vnd: Number.MAX_SAFE_INTEGER + 2 }))],
    ["null amount", () => mapTransactionRow(transactionRow({ amount_vnd: null }))],
    ["bad kind", () => mapTransactionRow(transactionRow({ kind: SECRET }))],
    ["bad timestamp", () => mapTransactionRow(transactionRow({ occurred_at: `not-a-date ${SECRET}` }))],
    ["impossible timestamp", () => mapTransactionRow(transactionRow({ occurred_at: "2026-13-45T00:00:00+00:00" }))],
    ["rolled-over timestamp (Feb 30)", () => mapTransactionRow(transactionRow({ occurred_at: "2026-02-30T00:00:00+00:00" }))],
    ["non-uuid id", () => mapTransactionRow(transactionRow({ id: SECRET }))],
    ["half recurring pair", () => mapTransactionRow(transactionRow({ recurring_item_id: "55555555-5555-4555-8555-555555555555" }))],
    ["bad recurring date", () => mapTransactionRow(transactionRow({ recurring_item_id: "55555555-5555-4555-8555-555555555555", recurring_instance_date: "2026-02-30" }))],
    ["not an object", () => mapTransactionRow(SECRET)],
    ["null row", () => mapTransactionRow(null)],
    ["negative reserve", () => mapProfileRow(profileRow({ minimum_reserve_vnd: -1 }))],
    ["payday out of range", () => mapProfileRow(profileRow({ payday_day: 40 }))],
    ["bad persona", () => mapProfileRow(profileRow({ persona_code: SECRET }))],
    ["recurring end before start", () => mapRecurringRow(recurringRow({ end_date: "2025-01-01" }))],
    ["recurring zero amount", () => mapRecurringRow(recurringRow({ amount_vnd: 0 }))],
    ["goal zero target", () => mapGoalRow(goalRow({ target_vnd: 0 }))],
    ["batch negative count", () => mapImportBatchRow(batchRow({ accepted_count: -1 }))],
  ])("rejects malformed row: %s", (_name, run) => {
    let thrown: unknown;
    try {
      run();
    } catch (e) {
      thrown = e;
    }
    expect(isDbError(thrown)).toBe(true);
    const err = thrown as DbError;
    expect(err.reason).toBe("db_row_invalid");
    expect(err.code).toBe("internal");
    // No secret, stack, or cause leaks through the client-visible fields.
    const visible = JSON.stringify({ m: err.userMessage, d: err.safeDetails });
    expect(visible).not.toContain(SECRET);
    expect(visible).not.toMatch(/at .*\.ts/);
    expect(err.cause).toBeUndefined();
  });
});

describe("domain -> write payload mappers", () => {
  it("builds a transaction insert with user_id from the caller and money as strings", () => {
    const input = parseInput(transactionCreateSchema, {
      occurredAt: "2026-11-20T12:30:00+07:00",
      kind: "expense",
      amountVnd: "45000",
      merchant: "Canteen",
    });
    expect(toTransactionInsert(OWNER_ID, input)).toEqual({
      user_id: OWNER_ID,
      occurred_at: "2026-11-20T05:30:00.000Z",
      kind: "expense",
      amount_vnd: "45000",
      category: "other",
      merchant: "Canteen",
      description: null,
      source: "manual",
      fingerprint: null,
      import_batch_id: null,
      recurring_item_id: null,
      recurring_instance_date: null,
    });
  });

  it("transaction update only includes provided fields", () => {
    expect(toTransactionUpdate({ amountVnd: 10n, merchant: null })).toEqual({ amount_vnd: "10", merchant: null });
  });

  it("recurring insert, goal upsert and profile update payloads", () => {
    const rec = parseInput(recurringCreateSchema, { label: " Netflix ", kind: "expense", amountVnd: "260000", dayOfMonth: 31, startDate: "2026-01-31" });
    expect(toRecurringInsert(OWNER_ID, rec)).toMatchObject({ user_id: OWNER_ID, label: "Netflix", amount_vnd: "260000", end_date: null, active: true });
    const goal = parseInput(goalUpsertSchema, { name: "Laptop", targetVnd: "15000000" });
    expect(toGoalUpsert(OWNER_ID, goal)).toEqual({ user_id: OWNER_ID, name: "Laptop", target_vnd: "15000000", saved_vnd: "0", target_date: null });
    const prof = parseInput(profileUpdateSchema, { balanceSnapshotVnd: "-100", paydayDay: null, balanceSnapshotAt: "2026-11-20T00:00:00Z" });
    expect(toProfileUpdate(prof)).toEqual({ balance_snapshot_vnd: "-100", payday_day: null, balance_snapshot_at: "2026-11-20T00:00:00.000Z" });
  });
});
