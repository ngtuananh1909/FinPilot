import { describe, expect, it } from "vitest";
import { getViewer } from "@/lib/auth/viewer";
import { OWNER_ID, createFakeClient, profileRow } from "../db/repositories/support/fake-client";

const clientFor = (user: { id: string; is_anonymous?: boolean; email?: string } | null, profile: Record<string, unknown> | null | "error") => {
  const fake = createFakeClient(() => (profile === "error" ? { data: null, error: { code: "XX000", message: "boom" } } : { data: profile }));
  return {
    auth: { getUser: async () => ({ data: { user }, error: null }) },
    from: (t: string) => (fake.client as unknown as { from: (t: string) => unknown }).from(t),
  } as never;
};

describe("getViewer", () => {
  it("returns null when signed out", async () => {
    expect(await getViewer(clientFor(null, null), { withProfile: true })).toBeNull();
  });
  it("flags anonymous users as demo even without a profile", async () => {
    const v = await getViewer(clientFor({ id: OWNER_ID, is_anonymous: true }, null), { withProfile: true });
    expect(v).toMatchObject({ isAnonymous: true, isDemo: true, profile: "missing" });
  });
  it("flags is_demo sample accounts and reports no badge for real users", async () => {
    const demo = await getViewer(clientFor({ id: OWNER_ID, email: "a@b.co" }, profileRow({ is_demo: true })), { withProfile: true });
    expect(demo).toMatchObject({ isAnonymous: false, isDemo: true, profile: "present" });
    const real = await getViewer(clientFor({ id: OWNER_ID, email: "a@b.co" }, profileRow({ is_demo: false })), { withProfile: true });
    expect(real).toMatchObject({ isDemo: false, profile: "present", email: "a@b.co" });
  });
  it("reports missing and unknown profile states instead of throwing", async () => {
    expect((await getViewer(clientFor({ id: OWNER_ID }, null), { withProfile: true }))?.profile).toBe("missing");
    expect((await getViewer(clientFor({ id: OWNER_ID }, "error"), { withProfile: true }))?.profile).toBe("unknown");
  });
  it("skips the profile read when not requested", async () => {
    expect((await getViewer(clientFor({ id: OWNER_ID }, null), { withProfile: false }))?.profile).toBe("not_loaded");
  });
});
