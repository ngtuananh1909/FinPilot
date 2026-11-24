import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { commitCsvImportRpc } from "@/lib/db/repositories/server-only/csv-commit";
import * as serverOnlyBarrel from "@/lib/db/repositories/server-only";
import { createFakeClient, makeOwner, OTHER_ID, OWNER_ID } from "./support/fake-client";

const owner = makeOwner();
const BATCH_ID = "33333333-3333-4333-8333-333333333333";

const row = {
  occurredAt: "2026-11-20T10:00:00+07:00",
  kind: "expense",
  amountVnd: "45000",
  category: "food",
  merchant: " Cafe ",
};
const input = { idempotencyKey: "imp-1", filename: "a.csv", rows: [row], rejectedCount: 2 };
const okResult = { replayed: false, batch_id: BATCH_ID, accepted_count: 1, rejected_count: 2, status: "committed" };

describe("commitCsvImportRpc", () => {
  it("sends the verified owner id and snake_case rows, and maps the result", async () => {
    const fake = createFakeClient(undefined, () => ({ data: okResult }));
    const res = await commitCsvImportRpc(fake.client, owner, input);
    expect(res).toEqual({ replayed: false, batchId: BATCH_ID, acceptedCount: 1, rejectedCount: 2, status: "committed" });
    expect(fake.rpcCalls).toHaveLength(1);
    expect(fake.rpcCalls[0]).toEqual({
      fn: "commit_csv_import",
      args: {
        p_user_id: OWNER_ID,
        p_idempotency_key: "imp-1",
        p_filename: "a.csv",
        p_rows: [
          {
            occurred_at: "2026-11-20T03:00:00.000Z",
            kind: "expense",
            amount_vnd: "45000",
            category: "food",
            merchant: "Cafe",
            description: null,
            fingerprint: null,
          },
        ],
        p_rejected_count: 2,
      },
    });
    expect(fake.queries).toHaveLength(0);
  });

  it("surfaces a replay", async () => {
    const fake = createFakeClient(undefined, () => ({ data: { ...okResult, replayed: true } }));
    expect((await commitCsvImportRpc(fake.client, owner, input)).replayed).toBe(true);
  });

  it("defaults a missing filename to null and keeps amounts as decimal strings", async () => {
    const fake = createFakeClient(undefined, () => ({ data: okResult }));
    await commitCsvImportRpc(fake.client, owner, { ...input, filename: undefined, rows: [{ ...row, amountVnd: "9007199254740991" }] });
    const args = fake.rpcCalls[0]!.args as { p_filename: unknown; p_rows: Array<{ amount_vnd: unknown }> };
    expect(args.p_filename).toBeNull();
    expect(args.p_rows[0]!.amount_vnd).toBe("9007199254740991");
  });

  it("rejects a smuggled user id, source, batch id or unknown row key without calling the RPC", async () => {
    const fake = createFakeClient(undefined, () => ({ data: okResult }));
    const bad = [
      { ...input, userId: OTHER_ID },
      { ...input, user_id: OTHER_ID },
      { ...input, rows: [{ ...row, userId: OTHER_ID }] },
      { ...input, rows: [{ ...row, user_id: OTHER_ID }] },
      { ...input, rows: [{ ...row, source: "seed" }] },
      { ...input, rows: [{ ...row, importBatchId: BATCH_ID }] },
    ];
    for (const b of bad) await expect(commitCsvImportRpc(fake.client, owner, b)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("rejects invalid input before any call", async () => {
    const fake = createFakeClient(undefined, () => ({ data: okResult }));
    const many = Array.from({ length: 5001 }, () => row);
    const bad = [
      { ...input, rows: [] },
      { ...input, rows: many },
      { ...input, idempotencyKey: "  " },
      { ...input, idempotencyKey: "k".repeat(129) },
      { ...input, filename: "f".repeat(256) },
      { ...input, rejectedCount: -1 },
      { ...input, rejectedCount: 1.5 },
      { ...input, rejectedCount: 5001 },
      { ...input, rows: [{ ...row, amountVnd: "0" }] },
      { ...input, rows: [{ ...row, amountVnd: "9007199254740992" }] },
      { ...input, rows: [{ ...row, amountVnd: "12.5" }] },
      { ...input, rows: [{ ...row, kind: "refund" }] },
      { ...input, rows: [{ ...row, occurredAt: "2026-11-20 10:00" }] },
      { ...input, rows: [{ ...row, merchant: "m".repeat(201) }] },
      { ...input, rows: [{ ...row, description: "d".repeat(501) }] },
      { ...input, rows: [{ ...row, fingerprint: "" }] },
      { ...input, rows: [{ ...row, category: "bad;category" }] },
    ];
    for (const b of bad) await expect(commitCsvImportRpc(fake.client, owner, b), JSON.stringify(b).slice(0, 80)).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("accepts exactly 5000 rows", async () => {
    const fake = createFakeClient(undefined, () => ({ data: { ...okResult, accepted_count: 5000 } }));
    const rows = Array.from({ length: 5000 }, () => row);
    expect((await commitCsvImportRpc(fake.client, owner, { ...input, rows })).acceptedCount).toBe(5000);
  });

  it("reports rpc_unavailable while the migration is not applied, never success", async () => {
    const fake = createFakeClient();
    await expect(commitCsvImportRpc(fake.client, owner, input)).rejects.toMatchObject({
      reason: "rpc_unavailable",
      safeDetails: { rpc: "commit_csv_import" },
    });
  });

  it("maps database errors without leaking messages", async () => {
    const fake = createFakeClient(undefined, () => ({ error: { code: "42501", message: "permission denied for SECRET" } }));
    const err = await commitCsvImportRpc(fake.client, owner, input).catch((e) => e);
    expect(err).toMatchObject({ reason: "db_forbidden" });
    expect(JSON.stringify({ m: err.userMessage, d: err.safeDetails })).not.toContain("SECRET");
  });

  it.each([
    ["non-object", "ok"],
    ["bad batch id", { ...okResult, batch_id: "nope" }],
    ["missing count", { replayed: false, batch_id: BATCH_ID, status: "committed" }],
    ["unknown status", { ...okResult, status: "weird" }],
    ["negative count", { ...okResult, accepted_count: -1 }],
  ])("rejects an unexpected result shape (%s)", async (_name, data) => {
    const fake = createFakeClient(undefined, () => ({ data }));
    await expect(commitCsvImportRpc(fake.client, owner, input)).rejects.toMatchObject({ reason: "db_row_invalid" });
  });

  it("refuses to run in a browser runtime", async () => {
    const fake = createFakeClient(undefined, () => ({ data: okResult }));
    (globalThis as { window?: unknown }).window = {};
    try {
      await expect(commitCsvImportRpc(fake.client, owner, input)).rejects.toMatchObject({ reason: "server_only" });
    } finally {
      delete (globalThis as { window?: unknown }).window;
    }
    expect(fake.rpcCalls).toHaveLength(0);
  });
});

describe("commitCsvImportRpc stays unwired", () => {
  it("is not exported from the server-only barrel", () => {
    expect(Object.keys(serverOnlyBarrel)).not.toContain("commitCsvImportRpc");
    const barrel = readFileSync(new URL("../../../src/lib/db/repositories/server-only/index.ts", import.meta.url), "utf8");
    expect(barrel).not.toMatch(/csv-commit/);
  });

  it("is used by the import service and the commit route passes the service-role client (0003 applied)", () => {
    const service = readFileSync(new URL("../../../src/lib/import/service.ts", import.meta.url), "utf8");
    expect(service).toMatch(/commitCsvImportRpc/);
    // The two-call commit path is gone: no direct batch or bulk inserts from the service.
    expect(service).not.toMatch(/createImportBatch|createTransactionsBulk|markImportBatchFailed/);
    const route = readFileSync(new URL("../../../src/app/api/imports/csv/commit/route.ts", import.meta.url), "utf8");
    expect(route).toMatch(/createSupabaseAdminClient\(\)/);
    const preview = readFileSync(new URL("../../../src/app/api/imports/csv/preview/route.ts", import.meta.url), "utf8");
    expect(preview).not.toMatch(/admin/);
  });
});
