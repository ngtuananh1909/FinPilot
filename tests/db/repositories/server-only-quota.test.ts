import { afterEach, describe, expect, it } from "vitest";
import { ProviderAmbiguousError, ProviderPreResultError } from "@/lib/ai/errors";
import {
  commitAiQuota,
  quotaLimitFor,
  releaseAiQuota,
  reserveAiQuota,
  withAiQuota,
  type WithAiQuotaDeps,
} from "@/lib/db/repositories/server-only";
import type { OwnerContext } from "@/lib/auth/owner-context";
import { FakeQuotaDb } from "./support/fake-quota-db";
import { createFakeClient, makeOwner, OTHER_ID, OWNER_ID } from "./support/fake-client";

const owner = makeOwner();
const other = makeOwner(OTHER_ID);
let counter = 0;
const nextId = () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(++counter).padStart(12, "0")}`;

function setup(limit = 2) {
  const db = new FakeQuotaDb();
  const fake = createFakeClient(() => ({ data: null }), db.rpc);
  const deps: WithAiQuotaDeps = { client: fake.client, limitFor: () => limit, newRequestId: nextId };
  return { db, fake, deps };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe("quotaLimitFor", () => {
  const env = { GUEST_CHAT_DAILY_LIMIT: 20, GUEST_SCAN_DAILY_LIMIT: 5 } as Parameters<typeof quotaLimitFor>[1];
  it("reads the server env limits and applies to every user kind", () => {
    expect(quotaLimitFor("chat", env)).toBe(20);
    expect(quotaLimitFor("scan", env)).toBe(5);
  });
  it("clamps to the SQL-accepted range", () => {
    expect(quotaLimitFor("chat", { ...env, GUEST_CHAT_DAILY_LIMIT: 10_000_000 } as typeof env)).toBe(100_000);
    expect(quotaLimitFor("chat", { ...env, GUEST_CHAT_DAILY_LIMIT: -3 } as typeof env)).toBe(0);
  });
});

describe("withAiQuota policy", () => {
  it("reserves BEFORE the provider call and commits on success", async () => {
    const { db, deps } = setup();
    const order: string[] = [];
    const result = await withAiQuota(owner, "chat", async ({ requestId }) => {
      order.push(`run:${db.log.join(",")}`);
      expect(db.reservations.get(requestId)?.status).toBe("reserved");
      return "answer";
    }, deps);
    expect(result).toBe("answer");
    expect(order).toEqual(["run:reserve_ai_quota"]);
    expect(db.log).toEqual(["reserve_ai_quota", "commit_ai_quota"]);
    expect(db.used(OWNER_ID, "chat")).toBe(1);
    expect([...db.reservations.values()][0]?.status).toBe("committed");
  });

  it("sends only the verified owner id and a fresh uuid request id per call", async () => {
    const db = new FakeQuotaDb();
    const fake = createFakeClient(() => ({ data: null }), db.rpc);
    await withAiQuota(owner, "scan", async () => 1, { client: fake.client, limitFor: () => 5 });
    await withAiQuota(owner, "scan", async () => 2, { client: fake.client, limitFor: () => 5 });
    const reserves = fake.rpcCalls.filter((c) => c.fn === "reserve_ai_quota");
    expect(reserves).toHaveLength(2);
    for (const c of reserves) {
      expect(c.args.p_user_id).toBe(OWNER_ID);
      expect(c.args.p_request_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(c.args.p_kind).toBe("scan");
      expect(c.args.p_limit).toBe(5);
    }
    expect(reserves[0]!.args.p_request_id).not.toBe(reserves[1]!.args.p_request_id);
  });

  it("limit exceeded -> typed quota_exceeded (Vietnamese message, remaining info); provider never called", async () => {
    const { db, deps } = setup(2);
    let calls = 0;
    const run = async () => ++calls;
    await withAiQuota(owner, "chat", run, deps);
    await withAiQuota(owner, "chat", run, deps);
    const err = await withAiQuota(owner, "chat", run, deps).catch((e) => e);
    expect(err).toMatchObject({
      name: "DbError",
      reason: "quota_exceeded",
      code: "rate_limited",
      httpStatus: 429,
      safeDetails: { reason: "quota_exceeded", kind: "chat", limit: 2, remaining: 0 },
    });
    expect(err.userMessage).toMatch(/Bạn đã dùng hết 2 lượt trò chuyện với trợ lý AI hôm nay/);
    expect(calls).toBe(2);
    expect(db.used(OWNER_ID, "chat")).toBe(2);
  });

  it("quota is independent per user and per kind", async () => {
    const { db, deps } = setup(1);
    await withAiQuota(owner, "chat", async () => 1, deps);
    await expect(withAiQuota(owner, "chat", async () => 1, deps)).rejects.toMatchObject({ reason: "quota_exceeded" });
    await expect(withAiQuota(other, "chat", async () => 1, deps)).resolves.toBe(1);
    await expect(withAiQuota(owner, "scan", async () => 1, deps)).resolves.toBe(1);
    expect(db.used(OTHER_ID, "chat")).toBe(1);
  });

  it("limit 0 means exceeded without any RPC", async () => {
    const { fake, deps } = setup(0);
    await expect(withAiQuota(owner, "scan", async () => 1, deps)).rejects.toMatchObject({ reason: "quota_exceeded" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("ProviderPreResultError -> release once, rethrow the same error, unit is refunded", async () => {
    const { db, deps } = setup(1);
    const failure = new ProviderPreResultError("provider_rejected");
    const err = await withAiQuota(owner, "chat", async () => { throw failure; }, deps).catch((e) => e);
    expect(err).toBe(failure);
    expect(db.log).toEqual(["reserve_ai_quota", "release_ai_quota"]);
    expect(db.used(OWNER_ID, "chat")).toBe(0);
    // the refunded unit is usable by a NEW request
    await expect(withAiQuota(owner, "chat", async () => "ok", deps)).resolves.toBe("ok");
  });

  it("invalid configuration also releases", async () => {
    const { db, deps } = setup(1);
    await expect(withAiQuota(owner, "scan", async () => { throw new ProviderPreResultError("invalid_config"); }, deps)).rejects.toMatchObject({ code: "ai_not_configured" });
    expect(db.used(OWNER_ID, "scan")).toBe(0);
  });

  it("ambiguous timeout keeps the single reservation: no release, no commit, no retry", async () => {
    const { db, deps } = setup(2);
    let runs = 0;
    const err = await withAiQuota(owner, "chat", async () => { runs += 1; throw new ProviderAmbiguousError(); }, deps).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderAmbiguousError);
    expect(runs).toBe(1);
    expect(db.log).toEqual(["reserve_ai_quota"]);
    expect(db.used(OWNER_ID, "chat")).toBe(1);
    expect([...db.reservations.values()].map((r) => r.status)).toEqual(["reserved"]);
  });

  it("unknown errors are treated conservatively (reservation kept)", async () => {
    const { db, deps } = setup(2);
    await expect(withAiQuota(owner, "chat", async () => { throw new Error("socket hang up"); }, deps)).rejects.toThrow("socket hang up");
    expect(db.log).toEqual(["reserve_ai_quota"]);
    expect(db.used(OWNER_ID, "chat")).toBe(1);
  });

  it("a failing release does not mask the provider error", async () => {
    const { db, deps } = setup(2);
    db.failRelease = true;
    const failure = new ProviderPreResultError("provider_rejected");
    await expect(withAiQuota(owner, "chat", async () => { throw failure; }, deps)).rejects.toBe(failure);
    expect(db.used(OWNER_ID, "chat")).toBe(1); // stays counted; never refunded wrongly
  });

  it("a failing commit does not discard a real result", async () => {
    const { db, deps } = setup(2);
    db.failCommit = true;
    await expect(withAiQuota(owner, "chat", async () => "real", deps)).resolves.toBe("real");
    expect(db.used(OWNER_ID, "chat")).toBe(1);
  });

  it("at most `limit` concurrent requests reach the provider", async () => {
    const { db, deps } = setup(5);
    let reached = 0;
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, () => withAiQuota(owner, "chat", async () => { reached += 1; await Promise.resolve(); return 1; }, deps)),
    );
    expect(reached).toBe(5);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(7);
    expect(db.used(OWNER_ID, "chat")).toBe(5);
  });
});

describe("release idempotency (wrapper level)", () => {
  it("double release refunds exactly once, including concurrent duplicates", async () => {
    const { db, fake } = setup(3);
    const id = nextId();
    expect(await reserveAiQuota(fake.client, owner, { requestId: id, kind: "chat", limit: 3 })).toBe(true);
    const [a, b, c] = await Promise.all([
      releaseAiQuota(fake.client, owner, id),
      releaseAiQuota(fake.client, owner, id),
      releaseAiQuota(fake.client, owner, id),
    ]);
    expect([a, b, c].filter(Boolean)).toHaveLength(1);
    expect(await releaseAiQuota(fake.client, owner, id)).toBe(false);
    expect(db.used(OWNER_ID, "chat")).toBe(0);
  });

  it("a released request id cannot be re-reserved (retries need a new id)", async () => {
    const { fake } = setup(3);
    const id = nextId();
    await reserveAiQuota(fake.client, owner, { requestId: id, kind: "chat", limit: 3 });
    await releaseAiQuota(fake.client, owner, id);
    expect(await reserveAiQuota(fake.client, owner, { requestId: id, kind: "chat", limit: 3 })).toBe(false);
  });

  it("a committed reservation can no longer be released", async () => {
    const { db, fake } = setup(3);
    const id = nextId();
    await reserveAiQuota(fake.client, owner, { requestId: id, kind: "scan", limit: 3 });
    expect(await commitAiQuota(fake.client, owner, id)).toBe(true);
    expect(await releaseAiQuota(fake.client, owner, id)).toBe(false);
    expect(db.used(OWNER_ID, "scan")).toBe(1);
  });

  it("another owner cannot release someone else's reservation", async () => {
    const { db, fake } = setup(3);
    const id = nextId();
    await reserveAiQuota(fake.client, owner, { requestId: id, kind: "chat", limit: 3 });
    expect(await releaseAiQuota(fake.client, other, id)).toBe(false);
    expect(db.used(OWNER_ID, "chat")).toBe(1);
  });
});

describe("guards and unavailable RPCs", () => {
  it("surfaces rpc_unavailable when the migration is not applied; provider never runs", async () => {
    const fake = createFakeClient(); // default rpc responder: PGRST202 (function not found)
    let ran = false;
    const err = await withAiQuota(owner, "chat", async () => { ran = true; return 1; }, { client: fake.client, limitFor: () => 20 }).catch((e) => e);
    expect(err).toMatchObject({ reason: "rpc_unavailable", code: "config_missing", httpStatus: 503 });
    expect(ran).toBe(false);
  });

  it("refuses to run in a browser", async () => {
    (globalThis as { window?: unknown }).window = {};
    const fake = createFakeClient();
    await expect(withAiQuota(owner, "chat", async () => 1, { client: fake.client, limitFor: () => 1 })).rejects.toMatchObject({ reason: "server_only" });
    await expect(reserveAiQuota(fake.client, owner, { requestId: nextId(), kind: "chat", limit: 1 })).rejects.toMatchObject({ reason: "server_only" });
    expect(fake.rpcCalls).toHaveLength(0);
  });

  it("rejects forged owner contexts and raw ids", async () => {
    const fake = createFakeClient();
    const forged = { userId: OTHER_ID, isAnonymous: false } as unknown as OwnerContext;
    await expect(withAiQuota(forged, "chat", async () => 1, { client: fake.client, limitFor: () => 1 })).rejects.toMatchObject({ code: "unauthenticated" });
    // @ts-expect-error raw ids are not accepted by privileged wrappers
    await expect(releaseAiQuota(fake.client, OTHER_ID, nextId())).rejects.toMatchObject({ code: "unauthenticated" });
    expect(fake.rpcCalls).toHaveLength(0);
  });
});
