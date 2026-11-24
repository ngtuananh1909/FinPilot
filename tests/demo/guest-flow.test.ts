import { describe, expect, it, vi } from "vitest";
import type { DemoClientDeps } from "@/lib/demo/client";
import { createSubmitGuard, runGuestStart } from "@/lib/demo/guest-flow";

type Reply = { ok: boolean; status: number; json: unknown };
const deps = (reply: Reply | (() => Promise<Reply>), signIn: DemoClientDeps["signInAnonymously"] = async () => ({ error: null })) => {
  const fetchJson = vi.fn<DemoClientDeps["fetchJson"]>(typeof reply === "function" ? reply : async () => reply);
  const signInAnonymously = vi.fn(signIn);
  let n = 0;
  const value: DemoClientDeps = { signInAnonymously, fetchJson, newKey: () => `key-${++n}-0000` };
  return { value, fetchJson, signInAnonymously };
};

describe("runGuestStart", () => {
  it("signs in anonymously, posts the persona and reports success", async () => {
    const d = deps({ ok: true, status: 200, json: { status: "started", personaCode: "student", replay: false } });
    expect(await runGuestStart(d.value, "student")).toEqual({ kind: "started", personaCode: "student", replaced: false });
    expect(d.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(d.fetchJson).toHaveBeenCalledWith("/api/demo/start", { personaCode: "student", idempotencyKey: "key-1-0000" });
  });

  it("returns existing without writing, then replaces only after confirmation", async () => {
    const first = deps({ ok: true, status: 200, json: { status: "existing", personaCode: "worker" } });
    expect(await runGuestStart(first.value, "student", { reuseSession: true })).toEqual({ kind: "existing", personaCode: "worker" });
    expect(first.signInAnonymously).not.toHaveBeenCalled(); // never creates a second identity
    expect(first.fetchJson.mock.calls[0]?.[1]).not.toHaveProperty("confirmReplace");

    const second = deps({ ok: true, status: 200, json: { status: "replaced", personaCode: "student", replay: false } });
    expect(await runGuestStart(second.value, "student", { reuseSession: true, confirmReplace: true })).toEqual({
      kind: "started",
      personaCode: "student",
      replaced: true,
    });
    expect(second.fetchJson.mock.calls[0]?.[1]).toMatchObject({ confirmReplace: true });
  });

  it("reports anonymous sign-in failure without calling the API", async () => {
    const d = deps({ ok: true, status: 200, json: {} }, async () => ({ error: { message: "Anonymous sign-ins are disabled" } }));
    const out = await runGuestStart(d.value, "student");
    expect(out).toMatchObject({ kind: "error", code: "unauthenticated" });
    expect(JSON.stringify(out)).not.toContain("Anonymous sign-ins are disabled");
    expect(d.fetchJson).not.toHaveBeenCalled();
  });

  it("shows the server's Vietnamese message from the error envelope", async () => {
    const d = deps({ ok: false, status: 429, json: { error: { code: "rate_limited", message: "Bạn đã dùng hết lượt hôm nay." } } });
    expect(await runGuestStart(d.value, "worker")).toEqual({ kind: "error", code: "rate_limited", message: "Bạn đã dùng hết lượt hôm nay." });
  });

  it("falls back to a generic message for a non-envelope failure", async () => {
    const d = deps({ ok: false, status: 502, json: null });
    expect(await runGuestStart(d.value, "worker")).toMatchObject({ kind: "error", code: "internal", message: expect.stringContaining("Vui lòng") });
  });

  it("turns thrown network errors into an error outcome", async () => {
    const d = deps(async () => {
      throw new TypeError("Failed to fetch");
    });
    const out = await runGuestStart(d.value, "at_risk");
    expect(out).toMatchObject({ kind: "error", code: "network" });
    expect(JSON.stringify(out)).not.toContain("Failed to fetch");
  });

  it("rejects an unexpected success payload", async () => {
    const d = deps({ ok: true, status: 200, json: { status: "weird" } });
    expect(await runGuestStart(d.value, "student")).toMatchObject({ kind: "error" });
  });
});

describe("createSubmitGuard", () => {
  it("lets only the first of two rapid calls through until released", async () => {
    const guard = createSubmitGuard();
    const d = deps(async () => ({ ok: true, status: 200, json: { status: "started", personaCode: "student" } }));
    const attempt = async () => {
      if (!guard.tryEnter()) return "ignored";
      await runGuestStart(d.value, "student");
      return "ran";
    };
    const results = await Promise.all([attempt(), attempt()]);
    expect(results).toEqual(["ran", "ignored"]);
    expect(d.fetchJson).toHaveBeenCalledTimes(1);
    guard.leave();
    expect(guard.tryEnter()).toBe(true);
  });
});
