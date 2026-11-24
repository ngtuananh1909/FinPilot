import { describe, expect, it } from "vitest";
import { resetDemo, startGuestSession, type DemoClientDeps } from "@/lib/demo/client";

function deps(over: Partial<DemoClientDeps> = {}) {
  const posts: Array<{ url: string; body: unknown }> = [];
  let signIns = 0;
  const d: DemoClientDeps = {
    signInAnonymously: async () => {
      signIns += 1;
      return { error: null };
    },
    fetchJson: async (url, body) => {
      posts.push({ url, body });
      return { ok: true, status: 200, json: { status: "started" } };
    },
    newKey: () => "key-0000-1111",
    ...over,
  };
  return { d, posts, signIns: () => signIns };
}

describe("startGuestSession", () => {
  it("signs in anonymously, then posts only persona and idempotency key", async () => {
    const { d, posts, signIns } = deps();
    const out = await startGuestSession(d, "student");
    expect(out.ok).toBe(true);
    expect(signIns()).toBe(1);
    expect(posts).toEqual([{ url: "/api/demo/start", body: { personaCode: "student", idempotencyKey: "key-0000-1111" } }]);
  });
  it("sends no owner id and passes confirmReplace only when asked", async () => {
    const { d, posts } = deps();
    await startGuestSession(d, "worker", { confirmReplace: true, reuseSession: true });
    expect(posts[0]!.body).toEqual({ personaCode: "worker", idempotencyKey: "key-0000-1111", confirmReplace: true });
    expect(JSON.stringify(posts[0]!.body)).not.toMatch(/user/i);
  });
  it("does not call the server when anonymous sign-in fails", async () => {
    const { d, posts } = deps({ signInAnonymously: async () => ({ error: new Error("disabled") }) });
    const out = await startGuestSession(d, "student");
    expect(out.ok).toBe(false);
    expect(posts).toHaveLength(0);
  });
});

describe("resetDemo", () => {
  it("always sends confirm: true with a fresh key", async () => {
    const { d, posts } = deps();
    await resetDemo(d, "at_risk");
    expect(posts[0]).toEqual({ url: "/api/demo/reset", body: { confirm: true, idempotencyKey: "key-0000-1111", personaCode: "at_risk" } });
  });
});
