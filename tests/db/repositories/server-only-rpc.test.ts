import { describe, expect, it } from "vitest";
import {
  bootstrapProfile,
  callRpc,
  createAiProposal,
  getAiUsage,
  listPendingAiProposals,
  resetUserToPersona,
} from "@/lib/db/repositories/server-only";
import { callsOf, createFakeClient, hasCall, isOwnerScoped, makeOwner, OTHER_ID, OWNER_ID, ROW_ID } from "./support/fake-client";

const owner = makeOwner();

describe("callRpc", () => {
  it.each([
    ["PostgREST PGRST202", { code: "PGRST202", message: "Could not find the function public.reserve_ai_quota" }],
    ["Postgres 42883", { code: "42883" }],
    ["HTTP 404", { status: 404 }],
  ])("maps a missing function (%s) to rpc_unavailable, never to success", async (_n, error) => {
    const fake = createFakeClient(undefined, () => ({ error }));
    const err = await callRpc(fake.client, "commit_ai_quota", { p_user_id: OWNER_ID, p_request_id: ROW_ID }).catch((e) => e);
    expect(err).toMatchObject({ reason: "rpc_unavailable", code: "config_missing", safeDetails: { rpc: "commit_ai_quota" } });
  });

  it("maps other errors without leaking messages", async () => {
    const fake = createFakeClient(undefined, () => ({ error: { code: "42501", message: "permission denied for SECRET" } }));
    const err = await callRpc(fake.client, "commit_ai_quota", { p_user_id: OWNER_ID, p_request_id: ROW_ID }).catch((e) => e);
    expect(err).toMatchObject({ reason: "db_forbidden", code: "forbidden" });
    expect(JSON.stringify({ m: err.userMessage, d: err.safeDetails })).not.toContain("SECRET");
  });

  it("rejects unexpected result shapes", async () => {
    const fake = createFakeClient(undefined, () => ({ data: "yes" }));
    await expect(callRpc(fake.client, "release_ai_quota", { p_user_id: OWNER_ID, p_request_id: ROW_ID })).rejects.toMatchObject({ reason: "db_row_invalid" });
  });
});

describe("bootstrapProfile / resetUserToPersona", () => {
  it("bootstrap sends the verified owner id and validated persona", async () => {
    const fake = createFakeClient(undefined, () => ({ data: true }));
    expect(await bootstrapProfile(fake.client, owner, { personaCode: "student", displayName: " Minh " })).toBe(true);
    expect(fake.rpcCalls[0]).toEqual({ fn: "bootstrap_profile", args: { p_user_id: OWNER_ID, p_persona_code: "student", p_display_name: "Minh" } });
    await expect(bootstrapProfile(fake.client, owner, { personaCode: "admin" })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(bootstrapProfile(fake.client, owner, { user_id: OTHER_ID })).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("bootstrap reports rpc_unavailable before the migration", async () => {
    const fake = createFakeClient();
    await expect(bootstrapProfile(fake.client, owner)).rejects.toMatchObject({ reason: "rpc_unavailable" });
  });

  it("reset passes the template under the owner's id and rejects a smuggled user id", async () => {
    const fake = createFakeClient(undefined, () => ({ data: { applied: true, replay: false, deleted_transactions: 3 } }));
    const template = { persona_code: "student", profile: {}, recurring_items: [], transactions: [], goal: {} };
    const res = await resetUserToPersona(fake.client, owner, { template, idempotencyKey: "reset-1" });
    expect(res).toEqual({ applied: true, replay: false });
    expect(fake.rpcCalls[0]!.args).toMatchObject({ p_user_id: OWNER_ID, p_idempotency_key: "reset-1" });
    await expect(resetUserToPersona(fake.client, owner, { template, idempotencyKey: "k", userId: OTHER_ID })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(resetUserToPersona(fake.client, owner, { template, idempotencyKey: "" })).rejects.toMatchObject({ code: "validation_failed" });
    await expect(resetUserToPersona(fake.client, owner, { template: { blob: "x".repeat(1_100_000) }, idempotencyKey: "k" })).rejects.toMatchObject({ code: "validation_failed" });
    expect(fake.rpcCalls).toHaveLength(1);
  });

  it("reset replay is surfaced", async () => {
    const fake = createFakeClient(undefined, () => ({ data: { applied: false, replay: true } }));
    expect(await resetUserToPersona(fake.client, owner, { template: {}, idempotencyKey: "k" })).toEqual({ applied: false, replay: true });
  });
});

describe("ai usage and proposals (server-only reads/writes)", () => {
  it("getAiUsage is owner-scoped and defaults to zero", async () => {
    const fake = createFakeClient(() => ({ data: null }));
    expect(await getAiUsage(fake.client, owner, "2026-11-23")).toEqual({ usageDate: "2026-11-23", chatCalls: 0, scanCalls: 0 });
    expect(isOwnerScoped(fake.queries[0]!, OWNER_ID)).toBe(true);
    expect(hasCall(fake.queries[0]!, "eq", "usage_date", "2026-11-23")).toBe(true);
    await expect(getAiUsage(fake.client, owner, "2026-02-30")).rejects.toMatchObject({ code: "validation_failed" });
  });

  it("createAiProposal writes a pending proposal with user_id from the owner only", async () => {
    const row = { id: ROW_ID, kind: "budget_update", status: "pending", payload: { a: 1 }, baseline: {}, expires_at: "2026-11-24T00:00:00+00:00", created_at: "2026-11-23T00:00:00+00:00" };
    const fake = createFakeClient(() => ({ data: row }));
    const p = await createAiProposal(fake.client, owner, { kind: "budget_update", payload: { a: 1 }, expiresAt: "2026-11-24T00:00:00Z" });
    const payload = callsOf(fake.queries[0]!, "insert")[0]!.args[0] as Record<string, unknown>;
    expect(payload).toMatchObject({ user_id: OWNER_ID, status: "pending", kind: "budget_update" });
    expect(p.status).toBe("pending");
    for (const bad of [{ user_id: OTHER_ID }, { status: "approved" }]) {
      await expect(createAiProposal(fake.client, owner, { kind: "goal_update", payload: {}, expiresAt: "2026-11-24T00:00:00Z", ...bad })).rejects.toMatchObject({ code: "validation_failed" });
    }
    expect(fake.queries).toHaveLength(1);
  });

  it("listPendingAiProposals is scoped and bounded", async () => {
    const fake = createFakeClient(() => ({ data: [] }));
    await listPendingAiProposals(fake.client, owner);
    const q = fake.queries[0]!;
    expect(isOwnerScoped(q, OWNER_ID)).toBe(true);
    expect(hasCall(q, "eq", "status", "pending")).toBe(true);
    expect(callsOf(q, "limit")[0]!.args).toEqual([20]);
  });
});
