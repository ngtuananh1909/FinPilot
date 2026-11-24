import { describe, expect, it } from "vitest";
import { ImportError } from "@/lib/import/errors";
import { importFingerprint } from "@/lib/import/fingerprint";
import { csvLimits } from "@/lib/import/limits";
import { commitCsv, previewCsv, type CsvPreviewResult } from "@/lib/import/service";
import {
  OTHER_ID,
  OWNER_ID,
  createFakeDb,
  makeOwner,
  profileRow,
  storedTransaction,
  type FakeDb,
} from "./support/fake-db";

const HEAD = "occurred_at,kind,amount_vnd,category,merchant,description";
const LIMITS = csvLimits();
const owner = makeOwner();
const csvOf = (...lines: string[]) => [HEAD, ...lines].join("\n");
const KEY = "idem-key-0001";

const L1 = "2026-11-01T12:30:00+07:00,expense,45000,food,Canteen,Lunch";
const L2 = "2026-11-02T08:00:00+07:00,expense,30000,coffee,Cafe,Morning";
const L3 = "2026-11-03T09:00:00+07:00,income,5000000,salary,Company,Pay";

const preview = (db: FakeDb, body: unknown) => previewCsv(db.client, owner, body, LIMITS);
const commit = (db: FakeDb, body: unknown) => commitCsv(db.client, owner, body, LIMITS, db.rpc);

const fail = async (p: Promise<unknown>): Promise<ImportError> => {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(ImportError);
    return e as ImportError;
  }
  throw new Error("expected rejection");
};

const ids = (p: CsvPreviewResult) => p.rows.map((r) => r.rowId);

function commitBody(csv: string, rowIds: string[], extra: Record<string, unknown> = {}) {
  return { confirmed: true, idempotencyKey: KEY, csv, rowIds, ...extra };
}

describe("previewCsv", () => {
  it("writes nothing to the database", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const result = await preview(db, { csv: csvOf(L1, L2, "bad,row,,,,") });
    expect(result.counts).toMatchObject({ total: 3, ok: 2, invalid: 1 });
    expect(db.writes).toEqual([]);
    expect(db.tables.transactions).toEqual([]);
    expect(db.tables.import_batches).toEqual([]);
  });

  it("scopes every read to the verified owner", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    await preview(db, { csv: csvOf(L1) });
    expect(db.selects.length).toBeGreaterThan(0);
    for (const s of db.selects) expect(s.filters).toContainEqual(["user_id", "eq", OWNER_ID]);
  });

  it("returns the mapping, headers, counts and normalised amounts as decimal strings", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const r = await preview(db, { csv: csvOf(L1) });
    expect(r.headers).toEqual(HEAD.split(","));
    expect(r.mapping).toMatchObject({ occurred_at: 0, kind: 1, amount_vnd: 2 });
    expect(r.rows[0]?.values.amountVnd).toBe("45000");
    expect(typeof r.rows[0]?.values.amountVnd).toBe("string");
    expect(JSON.stringify(r)).not.toMatch(/\d+n\b/);
    expect(r.kindSource).toBe("column");
    expect(r.needsDateFormat).toBe(false);
    expect(r.dayFirst).toBeNull();
  });

  it("labels an exact duplicate (stored fingerprint) and a possible duplicate", async () => {
    const fp = importFingerprint({
      occurredAt: new Date("2026-11-01T12:30:00+07:00"),
      kind: "expense",
      amountVnd: 45000n,
      merchant: "Canteen",
    });
    const db = createFakeDb({
      financial_profiles: [profileRow()],
      transactions: [
        storedTransaction({ fingerprint: fp, merchant: "Canteen", occurred_at: "2026-11-01T05:30:00+00:00" }),
        storedTransaction({ merchant: "Cafe Morning", amount_vnd: 30000, occurred_at: "2026-11-02T01:00:00+00:00" }),
      ],
    });
    const r = await preview(db, { csv: csvOf(L1, L2, L3, "x,y,z,,,") });
    expect(r.rows.map((x) => x.status)).toEqual(["exact_duplicate", "possible_duplicate", "ok", "invalid"]);
    expect(r.counts).toMatchObject({ exactDuplicate: 1, possibleDuplicate: 1, ok: 1, invalid: 1, total: 4 });
    expect(db.writes).toEqual([]);
  });

  it("does not see another owner's transactions", async () => {
    const db = createFakeDb({
      financial_profiles: [profileRow()],
      transactions: [storedTransaction({ user_id: OTHER_ID })],
    });
    const r = await preview(db, { csv: csvOf(L1) });
    expect(r.rows[0]?.status).toBe("ok");
  });

  it("counts rows at or before the balance snapshot as history only", async () => {
    // snapshot 2026-11-02T05:00Z; L1 (11-01) and L2 (11-02 01:00Z) are before it, L3 (11-03) after
    const db = createFakeDb({ financial_profiles: [profileRow({ balance_snapshot_at: "2026-11-02T05:00:00+00:00" })] });
    const r = await preview(db, { csv: csvOf(L1, L2, L3) });
    expect(r.historicalOnlyCount).toBe(2);
    expect(r.balanceSnapshotAt).toBe("2026-11-02T05:00:00.000Z");
  });

  it("reports a null historicalOnlyCount when the owner has no profile", async () => {
    const r = await preview(createFakeDb(), { csv: csvOf(L1) });
    expect(r.historicalOnlyCount).toBeNull();
  });

  it("asks for a date format when dates are ambiguous", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const line = "03/04/2026,expense,45000,food,A,B";
    const first = await preview(db, { csv: csvOf(line) });
    expect(first.needsDateFormat).toBe(true);
    expect(first.rows[0]?.status).toBe("ambiguous");
    const second = await preview(db, { csv: csvOf(line), options: { dayFirst: true } });
    expect(second.needsDateFormat).toBe(false);
    expect(second.rows[0]?.values.localDate).toBe("2026-04-03");
    expect(second.dayFirst).toBe(true);
  });

  it("returns mapping issues and no rows when columns cannot be identified, without querying", async () => {
    const db = createFakeDb();
    const r = await preview(db, { csv: "foo,bar\n1,2" });
    expect(r.mappingIssues).toEqual(["occurred_at_missing", "amount_missing"]);
    expect(r.rows).toEqual([]);
    expect(db.selects.filter((s) => s.table === "transactions")).toEqual([]);
  });

  it("warns that kind comes from the amount sign", async () => {
    const r = await preview(createFakeDb(), { csv: "date,amount\n2026-11-01,45000" });
    expect(r.warnings).toEqual(["kind_from_amount_sign", "all_amounts_positive_no_kind_column"]);
  });

  it("rejects bad input with typed errors", async () => {
    const db = createFakeDb();
    expect((await fail(preview(db, { csv: "" }))).reason).toBe("empty_file");
    expect((await fail(preview(db, { csv: "a,b\n" }))).reason).toBe("no_data_rows");
    expect((await fail(preview(db, { csv: "a,b\n1,\u00002" }))).reason).toBe("binary_content");
    expect((await fail(preview(db, {}))).reason).toBe("invalid_request");
    expect((await fail(preview(db, { csv: csvOf(L1), user_id: OTHER_ID }))).reason).toBe("invalid_request");
    expect((await fail(preview(db, { csv: csvOf(L1), mapping: { amount_vnd: 99 } }))).reason).toBe("invalid_request");
    expect((await fail(preview(db, { csv: csvOf(L1), mapping: { occurred_at: 1 } }))).reason).toBe("invalid_mapping");
    const big = await fail(previewCsv(db.client, owner, { csv: csvOf(L1, L2) }, { ...LIMITS, maxBytes: 50 }));
    expect([big.reason, big.httpStatus]).toEqual(["payload_too_large", 413]);
  });
});

describe("commitCsv", () => {
  async function previewIds(db: FakeDb, csv: string, options?: Record<string, unknown>) {
    return preview(db, { csv, ...(options ? { options } : {}) });
  }

  it("records the batch and every accepted row through ONE atomic RPC call", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2, L3);
    const p = await previewIds(db, csv);
    const result = await commit(db, commitBody(csv, ids(p), { filename: "bank.csv" }));

    expect(result).toMatchObject({
      replayed: false,
      batch: { status: "committed", acceptedCount: 3, rejectedCount: 0, filename: "bank.csv" },
      refused: [],
      skippedCount: 0,
    });
    expect(db.writes).toEqual([
      { table: "import_batches", op: "insert", rows: 1 },
      { table: "transactions", op: "insert", rows: 3 },
    ]);
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0]).toMatchObject({ fn: "commit_csv_import", args: { p_user_id: OWNER_ID, p_idempotency_key: KEY } });
    for (const r of db.rpcCalls[0]!.args.p_rows as Record<string, unknown>[]) {
      expect(Object.keys(r).sort()).toEqual(["amount_vnd", "category", "description", "fingerprint", "kind", "merchant", "occurred_at"]);
    }
    const batch = db.tables.import_batches[0]!;
    expect(batch).toMatchObject({ user_id: OWNER_ID, source: "csv", idempotency_key: KEY });
    expect(db.tables.transactions).toHaveLength(3);
    for (const t of db.tables.transactions) {
      expect(t).toMatchObject({ user_id: OWNER_ID, source: "csv", import_batch_id: batch.id });
      expect(t.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(db.tables.transactions[0]).toMatchObject({
      occurred_at: "2026-11-01T05:30:00.000Z",
      kind: "expense",
      amount_vnd: "45000",
      category: "food",
      merchant: "Canteen",
    });
    expect(db.tables.transactions[0]?.fingerprint).toBe(
      importFingerprint({
        occurredAt: new Date("2026-11-01T05:30:00Z"),
        kind: "expense",
        amountVnd: 45000n,
        merchant: "Canteen",
      }),
    );
  });

  it("imports only the selected rows and reports the rest as skipped", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2, L3);
    const p = await previewIds(db, csv);
    const r = await commit(db, commitBody(csv, [ids(p)[0]!, ids(p)[2]!]));
    expect(r.batch).toMatchObject({ acceptedCount: 2, rejectedCount: 1 });
    expect(r.skippedCount).toBe(1);
    expect(db.tables.transactions.map((t) => t.amount_vnd)).toEqual(["45000", "5000000"]);
  });

  it("is idempotent: the same key twice gives one batch and one bulk insert", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2);
    const body = commitBody(csv, ids(await previewIds(db, csv)));
    const first = await commit(db, body);
    const second = await commit(db, body);

    expect(first.replayed).toBe(false);
    expect(second.replayed).toBe(true);
    expect(second.batch.id).toBe(first.batch.id);
    expect(second.batch).toEqual(first.batch);
    expect(db.tables.import_batches).toHaveLength(1);
    expect(db.tables.transactions).toHaveLength(2);
    expect(db.writes.filter((w) => w.table === "transactions")).toHaveLength(1);
    expect(db.writes.filter((w) => w.table === "import_batches")).toHaveLength(1);
  });

  it("a replay does not even parse the CSV (stored result wins)", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1);
    const rowIds = ids(await previewIds(db, csv));
    await commit(db, commitBody(csv, rowIds));
    const replay = await commit(db, commitBody(csv, rowIds));
    expect(replay.replayed).toBe(true);
    expect(db.tables.transactions).toHaveLength(1);
  });

  it("a repeat upload of the same file under a NEW key is flagged exact_duplicate and not re-imported", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2, L3);
    await commit(db, commitBody(csv, ids(await previewIds(db, csv))));
    expect(db.tables.transactions).toHaveLength(3);

    const again = await previewIds(db, csv);
    expect(again.rows.map((r) => r.status)).toEqual(Array(3).fill("exact_duplicate"));
    expect(again.counts.exactDuplicate).toBe(3);

    // Selecting them without confirming the duplicates imports nothing and creates no batch.
    const err = await fail(commit(db, commitBody(csv, ids(again), { idempotencyKey: "second-key-0002" })));
    expect(err.reason).toBe("no_rows_to_import");
    expect(db.tables.transactions).toHaveLength(3);
    expect(db.tables.import_batches).toHaveLength(1);
  });

  it("imports a duplicate only when the user explicitly lists it", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2);
    await commit(db, commitBody(csv, ids(await previewIds(db, csv))));
    const again = await previewIds(db, csv);
    const [first, second] = ids(again);

    const r = await commit(
      db,
      commitBody(csv, [first!, second!], { idempotencyKey: "second-key-0002", includeDuplicateRowIds: [first!] }),
    );
    expect(r.importedRowIds).toEqual([first]);
    expect(r.refused).toEqual([{ rowId: second, reason: "duplicate_not_confirmed" }]);
    expect(db.tables.transactions).toHaveLength(3);
  });

  it("never imports invalid or ambiguous rows, even when their ids are sent", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, "2026-11-01,expense,abc,food,A,B", "03/04/2026,expense,45000,food,A,B");
    const p = await previewIds(db, csv);
    expect(p.rows.map((r) => r.status)).toEqual(["ok", "invalid", "ambiguous"]);
    const r = await commit(db, commitBody(csv, ids(p), { includeDuplicateRowIds: ids(p) }));
    expect(r.importedRowIds).toEqual([ids(p)[0]]);
    expect(r.refused).toEqual([
      { rowId: ids(p)[1], reason: "invalid_row" },
      { rowId: ids(p)[2], reason: "ambiguous_row" },
    ]);
    expect(db.tables.transactions).toHaveLength(1);
  });

  it("creates no batch when nothing importable was selected", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf("2026-11-01,expense,abc,food,A,B");
    const err = await fail(commit(db, commitBody(csv, ids(await previewIds(db, csv)))));
    expect(err.reason).toBe("no_rows_to_import");
    expect(db.writes).toEqual([]);
  });

  it("an ambiguous row becomes importable once the user picks a date format", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf("03/04/2026,expense,45000,food,A,B");
    const p = await previewIds(db, csv, { dayFirst: true });
    await commit(db, commitBody(csv, ids(p), { options: { dayFirst: true } }));
    expect(db.tables.transactions[0]?.occurred_at).toBe("2026-04-03T05:00:00.000Z");
  });

  it("requires confirmed: true, an idempotency key, row ids, and rejects owner keys", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1);
    const rowIds = ids(await previewIds(db, csv));
    const base = commitBody(csv, rowIds);
    for (const bad of [
      { ...base, confirmed: false },
      { ...base, confirmed: "true" },
      { ...base, confirmed: undefined },
      { ...base, idempotencyKey: undefined },
      { ...base, idempotencyKey: "" },
      { ...base, idempotencyKey: "k".repeat(129) },
      { ...base, rowIds: [] },
      { ...base, rowIds: undefined },
      { ...base, rowIds: ["not-a-row-id"] },
      { ...base, user_id: OTHER_ID },
      { ...base, userId: OTHER_ID },
      { ...base, owner: OTHER_ID },
    ]) {
      expect((await fail(commit(db, bad))).reason).toBe("invalid_request");
    }
    expect(db.writes).toEqual([]);
  });

  it("rejects row ids that do not match the CSV (tampered or stale preview)", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const rowIds = ids(await previewIds(db, csvOf(L1, L2)));
    const changed = csvOf(L1.replace("45000", "46000"), L2);
    expect((await fail(commit(db, commitBody(changed, rowIds)))).reason).toBe("unknown_row");
    expect(db.writes).toEqual([]);
  });

  it("requires duplicate overrides to be part of the selection", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2);
    const [a, b] = ids(await previewIds(db, csv));
    const err = await fail(commit(db, commitBody(csv, [a!], { includeDuplicateRowIds: [b!] })));
    expect(err.reason).toBe("duplicate_selection_not_selected");
    expect(db.writes).toEqual([]);
  });

  it("refuses to commit with an incomplete mapping", async () => {
    const db = createFakeDb();
    const err = await fail(commit(db, commitBody("foo,bar\n1,2", ["r1-00000000"])));
    expect(err.reason).toBe("mapping_incomplete");
  });

  it("on commit failure stores nothing (no batch, no rows), raises a typed error, and the same key can retry", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2, L3);
    const rowIds = ids(await previewIds(db, csv));
    db.failNext = { table: "transactions", op: "insert", error: { code: "23514" } };
    const err = await fail(commit(db, commitBody(csv, rowIds)));
    expect(err.reason).toBe("import_commit_failed");
    expect(err.httpStatus).toBe(500);
    expect(JSON.stringify(err.safeDetails ?? {})).not.toMatch(/23514|Canteen/);
    expect(db.tables.transactions).toEqual([]);
    expect(db.tables.import_batches).toEqual([]);
    // Atomic commit leaves no failed batch behind, so retrying with the SAME key now works.
    const retried = await commit(db, commitBody(csv, rowIds));
    expect(retried).toMatchObject({ replayed: false, batch: { status: "committed", acceptedCount: 3 } });
    expect(db.tables.transactions).toHaveLength(3);
  });
  it("uses the owner id from the verified context, never from the body", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1);
    await commit(db, commitBody(csv, ids(await previewIds(db, csv))));
    expect(db.rpcCalls[0]!.args.p_user_id).toBe(OWNER_ID);
  });
  it("returns the existing batch when a concurrent request with the same key wins the unique constraint", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2);
    const rowIds = ids(await previewIds(db, csv));
    db.beforeInsert = (table, d) => {
      if (table !== "import_batches") return;
      d.beforeInsert = null;
      d.tables.import_batches.push({
        id: "99999999-9999-4999-8999-999999999999",
        user_id: OWNER_ID,
        idempotency_key: KEY,
        source: "csv",
        filename: null,
        status: "committed",
        accepted_count: 2,
        rejected_count: 0,
        created_at: "2026-11-23T02:00:00+00:00",
      });
    };
    const r = await commit(db, commitBody(csv, rowIds));
    expect(r.replayed).toBe(true);
    expect(r.batch.id).toBe("99999999-9999-4999-8999-999999999999");
    expect(db.tables.import_batches).toHaveLength(1);
    expect(db.tables.transactions).toEqual([]); // the winner owns the insert; this request adds none
    expect(db.writes.filter((w) => w.table === "transactions")).toEqual([]);
  });

  it("two parallel commits with the same key insert transactions at most once", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    const csv = csvOf(L1, L2);
    const body = commitBody(csv, ids(await previewIds(db, csv)));
    const [a, b] = await Promise.all([commit(db, body), commit(db, body)]);
    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(db.tables.import_batches).toHaveLength(1);
    expect(db.tables.transactions).toHaveLength(2);
  });

  it("the same key under a different owner is a different batch", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow()] });
    db.tables.import_batches.push({
      id: "88888888-8888-4888-8888-888888888888",
      user_id: OTHER_ID,
      idempotency_key: KEY,
      source: "csv",
      filename: null,
      status: "committed",
      accepted_count: 9,
      rejected_count: 0,
      created_at: "2026-11-23T02:00:00+00:00",
    });
    const csv = csvOf(L1);
    const r = await commit(db, commitBody(csv, ids(await previewIds(db, csv))));
    expect(r.replayed).toBe(false);
    expect(db.tables.transactions).toHaveLength(1);
  });
});
