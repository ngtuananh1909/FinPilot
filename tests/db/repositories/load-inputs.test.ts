import { describe, expect, it } from "vitest";
import {
  HISTORY_WINDOW_DAYS,
  MAX_RECURRING_ITEMS,
  MAX_TRANSACTIONS,
  TRANSACTION_PAGE_SIZE,
  loadFinanceInputs,
} from "@/lib/db/repositories";
import { forecastCashflow } from "@/lib/finance";
import {
  callsOf,
  createFakeClient,
  hasCall,
  isOwnerScoped,
  makeOwner,
  OWNER_ID,
  profileRow,
  recurringRow,
  transactionRow,
  type RecordedQuery,
} from "./support/fake-client";

const owner = makeOwner();
const NOW = new Date("2026-11-23T03:00:00Z");
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const txRows = (count: number, startAt = 0) =>
  Array.from({ length: count }, (_, i) =>
    transactionRow({ id: uuid(startAt + i + 1), occurred_at: new Date(NOW.getTime() - (startAt + i) * 60_000).toISOString().replace("Z", "+00:00") }),
  );

function responder(opts: { profile?: unknown; total: number; recurring?: unknown[] }) {
  return (q: RecordedQuery) => {
    if (q.table === "financial_profiles") return { data: opts.profile === undefined ? profileRow() : opts.profile };
    if (q.table === "recurring_items") return { data: opts.recurring ?? [recurringRow()] };
    const [from, to] = callsOf(q, "range")[0]!.args as [number, number];
    const idOnly = hasCall(q, "select", "id");
    const rows = txRows(Math.max(0, Math.min(opts.total, to + 1) - from), from);
    return { data: idOnly ? rows.map((r) => ({ id: r.id })) : rows };
  };
}

describe("loadFinanceInputs", () => {
  it("scopes every query to the owner and returns engine-compatible pieces", async () => {
    const fake = createFakeClient(responder({ total: 3 }));
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    expect(fake.queries.map((q) => q.table).sort()).toEqual(["financial_profiles", "recurring_items", "transactions"]);
    for (const q of fake.queries) expect(isOwnerScoped(q, OWNER_ID)).toBe(true);
    expect(res.transactions).toHaveLength(3);
    expect(res.recurringItems).toHaveLength(1);
    expect(res.truncated).toBe(false);
    expect(res.balanceReliable).toBe(true);
    // The record shapes are accepted by the pure engine as-is.
    const f = forecastCashflow({ profile: res.profile, transactions: res.transactions, recurringItems: res.recurringItems, now: NOW });
    expect(f.days).toHaveLength(45);
  });

  it("window starts at min(snapshot, now-90d) with no upper bound (future rows included)", async () => {
    const fake = createFakeClient(responder({ total: 1 }));
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    const q = fake.queries.find((x) => x.table === "transactions")!;
    const gte = callsOf(q, "gte")[0]!;
    expect(gte.args[0]).toBe("occurred_at");
    const expected = Math.min(new Date("2026-11-15T03:00:00Z").getTime(), NOW.getTime() - HISTORY_WINDOW_DAYS * 86_400_000);
    expect(new Date(gte.args[1] as string).getTime()).toBe(expected);
    expect(res.windowStart.getTime()).toBe(expected);
    expect(callsOf(q, "lt")).toHaveLength(0);
    expect(callsOf(q, "lte")).toHaveLength(0);
  });

  it("an old snapshot extends the window back to the snapshot", async () => {
    const fake = createFakeClient(responder({ total: 0, profile: profileRow({ balance_snapshot_at: "2025-01-01T00:00:00+00:00" }) }));
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    expect(res.windowStart).toEqual(new Date("2025-01-01T00:00:00Z"));
  });

  it("pages in chunks of 1000 and does not flag truncation at exactly the cap", async () => {
    const fake = createFakeClient(responder({ total: MAX_TRANSACTIONS }));
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    expect(res.transactions).toHaveLength(MAX_TRANSACTIONS);
    expect(res.transactionsTruncated).toBe(false);
    const txQueries = fake.queries.filter((q) => q.table === "transactions");
    expect(txQueries).toHaveLength(MAX_TRANSACTIONS / TRANSACTION_PAGE_SIZE + 1); // 5 pages + 1 probe
  });

  it("reports truncation when more than the cap exists", async () => {
    const fake = createFakeClient(responder({ total: MAX_TRANSACTIONS + 1, profile: profileRow({ balance_snapshot_at: "2020-01-01T00:00:00+00:00" }) }));
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    expect(res.transactions).toHaveLength(MAX_TRANSACTIONS);
    expect(res.transactionsTruncated).toBe(true);
    expect(res.truncated).toBe(true);
    // Oldest loaded row is newer than the snapshot, so balances would be incomplete.
    expect(res.balanceReliable).toBe(false);
  });

  it("truncation is reported but balance stays reliable if rows reach back to the snapshot", async () => {
    const rows = txRows(MAX_TRANSACTIONS);
    const oldest = rows[rows.length - 1]!.occurred_at as string;
    const fake = createFakeClient((q) => {
      if (q.table === "financial_profiles") return { data: profileRow({ balance_snapshot_at: oldest }) };
      if (q.table === "recurring_items") return { data: [] };
      const [from, to] = callsOf(q, "range")[0]!.args as [number, number];
      return { data: from >= MAX_TRANSACTIONS ? [{ id: uuid(99999) }] : rows.slice(from, to + 1) };
    });
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    expect(res.transactionsTruncated).toBe(true);
    expect(res.balanceReliable).toBe(true);
  });

  it("reports recurring truncation", async () => {
    const many = Array.from({ length: MAX_RECURRING_ITEMS + 1 }, (_, i) => recurringRow({ id: uuid(i + 1) }));
    const fake = createFakeClient(responder({ total: 0, recurring: many }));
    const res = await loadFinanceInputs(fake.client, owner, NOW);
    expect(res.recurringItems).toHaveLength(MAX_RECURRING_ITEMS);
    expect(res.recurringTruncated).toBe(true);
    expect(res.balanceReliable).toBe(false);
  });

  it("fails with profile_missing and rejects an invalid clock", async () => {
    const fake = createFakeClient(responder({ total: 0, profile: null }));
    await expect(loadFinanceInputs(fake.client, owner, NOW)).rejects.toMatchObject({ safeDetails: { reason: "profile_missing" } });
    await expect(loadFinanceInputs(fake.client, owner, new Date("nope"))).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("propagates database errors as typed errors", async () => {
    const fake = createFakeClient(() => ({ error: { code: "XX000", message: "boom SECRET" } }));
    const err = await loadFinanceInputs(fake.client, owner, NOW).catch((e) => e);
    expect(err).toMatchObject({ code: "internal", safeDetails: { reason: "db_error" } });
    expect(JSON.stringify({ m: err.userMessage, d: err.safeDetails })).not.toContain("SECRET");
  });
});
