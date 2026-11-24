import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { ownerContextFromVerifiedUser } from "@/lib/auth/owner-context";
import { resetDemoData, startGuestDemo } from "@/lib/demo/service";
import { AppError } from "@/lib/errors";
import { OWNER_ID, createFakeClient, profileRow } from "../db/repositories/support/fake-client";

const NOW = new Date("2026-12-05T03:00:00Z");
const KEY = "key-1234-abcd";

const ownerOf = (isAnonymous: boolean) =>
  ownerContextFromVerifiedUser({ userId: OWNER_ID, user: { id: OWNER_ID } as User, isAnonymous });

function deps(opts: { profile?: Record<string, unknown> | null; rpc?: Record<string, unknown> } = {}) {
  const user = createFakeClient(() => ({ data: opts.profile === undefined ? null : opts.profile }));
  const admin = createFakeClient(
    () => ({ data: null }),
    () => ({ data: opts.rpc ?? { applied: true, replay: false } }),
  );
  return { user, admin, d: { userClient: user.client, adminClient: admin.client } };
}

async function codeOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AppError ? error.code : `other:${String(error)}`;
  }
  return "no-error";
}

describe("startGuestDemo", () => {
  it("clones the chosen persona into the verified caller's rows", async () => {
    const { d, admin } = deps({ profile: null });
    const result = await startGuestDemo(d, ownerOf(true), { personaCode: "student", idempotencyKey: KEY }, NOW);
    expect(result).toEqual({ status: "started", personaCode: "student", replay: false });
    expect(admin.rpcCalls).toHaveLength(1);
    const call = admin.rpcCalls[0]!;
    expect(call.fn).toBe("reset_user_to_persona");
    expect(call.args.p_user_id).toBe(OWNER_ID);
    expect(call.args.p_idempotency_key).toBe(`start:${KEY}`);
    expect((call.args.p_template as { persona_code: string }).persona_code).toBe("student");
  });

  it("never replaces existing guest data without confirmReplace", async () => {
    const { d, admin } = deps({ profile: profileRow({ persona_code: "worker" }) });
    const result = await startGuestDemo(d, ownerOf(true), { personaCode: "student", idempotencyKey: KEY }, NOW);
    expect(result).toEqual({ status: "existing", personaCode: "worker" });
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("replaces data after explicit confirmation", async () => {
    const { d, admin } = deps({ profile: profileRow({ persona_code: "worker" }) });
    const result = await startGuestDemo(
      d,
      ownerOf(true),
      { personaCode: "at_risk", idempotencyKey: KEY, confirmReplace: true },
      NOW,
    );
    expect(result.status).toBe("replaced");
    expect(admin.rpcCalls).toHaveLength(1);
  });

  it("reports a replayed request without claiming a new write", async () => {
    const { d } = deps({ profile: null, rpc: { applied: false, replay: true } });
    const result = await startGuestDemo(d, ownerOf(true), { personaCode: "student", idempotencyKey: KEY }, NOW);
    expect(result).toMatchObject({ replay: true });
  });

  it("refuses signed-in (non anonymous) callers and real accounts", async () => {
    const a = deps({ profile: null });
    expect(await codeOf(startGuestDemo(a.d, ownerOf(false), { personaCode: "student", idempotencyKey: KEY }, NOW))).toBe("forbidden");
    expect(a.admin.rpcCalls).toHaveLength(0);
    const b = deps({ profile: profileRow({ is_demo: false }) });
    expect(
      await codeOf(startGuestDemo(b.d, ownerOf(true), { personaCode: "student", idempotencyKey: KEY, confirmReplace: true }, NOW)),
    ).toBe("forbidden");
    expect(b.admin.rpcCalls).toHaveLength(0);
  });

  it.each([
    ["user_id smuggled in", { personaCode: "student", idempotencyKey: KEY, user_id: "x" }],
    ["owner smuggled in", { personaCode: "student", idempotencyKey: KEY, owner: "x" }],
    ["template smuggled in", { personaCode: "student", idempotencyKey: KEY, template: {} }],
    ["unknown persona", { personaCode: "admin", idempotencyKey: KEY }],
    ["short key", { personaCode: "student", idempotencyKey: "abc" }],
    ["overlong key", { personaCode: "student", idempotencyKey: "k".repeat(121) }],
    ["missing persona", { idempotencyKey: KEY }],
  ])("rejects invalid input: %s", async (_label, body) => {
    const { d, admin } = deps({ profile: null });
    await expect(startGuestDemo(d, ownerOf(true), body, NOW)).rejects.toThrow();
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("rejects a forged owner context", async () => {
    const { d } = deps();
    const forged = { userId: OWNER_ID, isAnonymous: true } as never;
    expect(await codeOf(startGuestDemo(d, forged, { personaCode: "student", idempotencyKey: KEY }, NOW))).toBe("unauthenticated");
  });
});

describe("resetDemoData", () => {
  it("requires explicit confirmation", async () => {
    const { d, admin } = deps({ profile: profileRow() });
    await expect(resetDemoData(d, ownerOf(true), { idempotencyKey: KEY }, NOW)).rejects.toThrow();
    await expect(resetDemoData(d, ownerOf(true), { confirm: false, idempotencyKey: KEY }, NOW)).rejects.toThrow();
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("resets a guest to their current persona, or switches persona on request", async () => {
    const same = deps({ profile: profileRow({ persona_code: "worker" }) });
    const r1 = await resetDemoData(same.d, ownerOf(true), { confirm: true, idempotencyKey: KEY }, NOW);
    expect(r1).toEqual({ status: "reset", personaCode: "worker", replay: false });
    expect((same.admin.rpcCalls[0]!.args.p_template as { persona_code: string }).persona_code).toBe("worker");
    expect(same.admin.rpcCalls[0]!.args.p_idempotency_key).toBe(`reset:${KEY}`);

    const swap = deps({ profile: profileRow({ persona_code: "worker" }) });
    const r2 = await resetDemoData(swap.d, ownerOf(true), { confirm: true, idempotencyKey: KEY, personaCode: "at_risk" }, NOW);
    expect(r2.personaCode).toBe("at_risk");
  });

  it("lets the sample email accounts reset themselves but not change persona", async () => {
    const ok = deps({ profile: profileRow({ persona_code: "student", is_demo: true }) });
    const result = await resetDemoData(ok.d, ownerOf(false), { confirm: true, idempotencyKey: KEY }, NOW);
    expect(result.personaCode).toBe("student");
    expect(ok.admin.rpcCalls).toHaveLength(1);

    const swap = deps({ profile: profileRow({ persona_code: "student", is_demo: true }) });
    expect(
      await codeOf(resetDemoData(swap.d, ownerOf(false), { confirm: true, idempotencyKey: KEY, personaCode: "worker" }, NOW)),
    ).toBe("forbidden");
    expect(swap.admin.rpcCalls).toHaveLength(0);
  });

  it("never resets a real (non-demo) account", async () => {
    const { d, admin } = deps({ profile: profileRow({ is_demo: false }) });
    expect(await codeOf(resetDemoData(d, ownerOf(false), { confirm: true, idempotencyKey: KEY }, NOW))).toBe("forbidden");
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("reports a missing profile and a persona-less profile", async () => {
    const none = deps({ profile: null });
    expect(await codeOf(resetDemoData(none.d, ownerOf(true), { confirm: true, idempotencyKey: KEY }, NOW))).toBe("not_found");
    const noPersona = deps({ profile: profileRow({ persona_code: null }) });
    expect(await codeOf(resetDemoData(noPersona.d, ownerOf(true), { confirm: true, idempotencyKey: KEY }, NOW))).toBe("validation_failed");
    expect(noPersona.admin.rpcCalls).toHaveLength(0);
  });

  it("rejects smuggled owner ids", async () => {
    const { d, admin } = deps({ profile: profileRow() });
    await expect(resetDemoData(d, ownerOf(true), { confirm: true, idempotencyKey: KEY, user_id: "x" }, NOW)).rejects.toThrow();
    expect(admin.rpcCalls).toHaveLength(0);
  });

  it("surfaces an unavailable RPC instead of faking success", async () => {
    const user = createFakeClient(() => ({ data: profileRow() }));
    const admin = createFakeClient(() => ({ data: null }), () => ({ data: null, error: { code: "PGRST202", message: "not found" } }));
    await expect(
      resetDemoData({ userClient: user.client, adminClient: admin.client }, ownerOf(true), { confirm: true, idempotencyKey: KEY }, NOW),
    ).rejects.toMatchObject({ reason: "rpc_unavailable" });
  });
});
