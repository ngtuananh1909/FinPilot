import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { csvLimits } from "@/lib/import/limits";
import { previewCsv } from "@/lib/import/service";
import { createFakeDb, makeOwner, profileRow } from "./support/fake-db";

const lines = readFileSync(join(process.cwd(), "mock-data", "transactions.csv"), "utf8").trim().split(/\r?\n/);
const header = lines[0] as string;
const SNAPSHOT = "2026-11-23T09:00:00+07:00";

describe.each(["student", "worker", "at_risk"])("mock-data/transactions.csv, persona %s", (persona) => {
  const mine = lines.slice(1).filter((l) => l.startsWith(`${persona},`));
  const csv = [header, ...mine].join("\n");

  it("previews cleanly: 15 rows, no invalid/ambiguous/duplicate, persona_code ignored", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow({ balance_snapshot_at: SNAPSHOT })] });
    const r = await previewCsv(db.client, makeOwner(), { csv }, csvLimits());
    expect(mine).toHaveLength(15);
    expect(r.mappingIssues).toEqual([]);
    expect(r.mapping).toEqual({
      occurred_at: 1,
      kind: 2,
      amount_vnd: 3,
      debit_vnd: null,
      credit_vnd: null,
      category: 4,
      merchant: 5,
      description: 6,
    });
    expect(r.kindSource).toBe("column");
    expect(r.counts).toEqual({ total: 15, ok: 15, invalid: 0, ambiguous: 0, possibleDuplicate: 0, exactDuplicate: 0 });
    expect(r.needsDateFormat).toBe(false);
    expect(db.writes).toEqual([]);

    // Independent expectation straight from the file text.
    const expected = mine.map((l) => l.split(","));
    r.rows.forEach((row, i) => {
      const [, at, kind, amount] = expected[i] as string[];
      expect(row.values).toMatchObject({ kind, amountVnd: amount });
      expect(row.values.occurredAt).toBe(new Date(at as string).toISOString());
    });
    const before = expected.filter((c) => Date.parse(c[1] as string) <= Date.parse(SNAPSHOT)).length;
    expect(r.historicalOnlyCount).toBe(before);
  });

  it("a second upload of the same persona file is entirely exact duplicates", async () => {
    const db = createFakeDb({ financial_profiles: [profileRow({ balance_snapshot_at: SNAPSHOT })] });
    const owner = makeOwner();
    const first = await previewCsv(db.client, owner, { csv }, csvLimits());
    const { commitCsv } = await import("@/lib/import/service");
    await commitCsv(
      db.client,
      owner,
      { confirmed: true, idempotencyKey: `mock-${persona}-1`, csv, rowIds: first.rows.map((x) => x.rowId) },
      csvLimits(),
      db.rpc,
    );
    const second = await previewCsv(db.client, owner, { csv }, csvLimits());
    expect(second.counts.exactDuplicate).toBe(15);
  });
});
