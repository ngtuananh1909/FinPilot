import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { AUXILIARY_ROUTES, PROTECTED_ROUTES, isProtectedPath } from "@/lib/auth/routes";
import { NAV_ITEMS } from "@/components/shell/nav-items";

const state = { user: null as null | { id: string } };
vi.mock("@/lib/db/middleware", async () => {
  const { NextResponse } = await import("next/server");
  return { refreshSession: async () => ({ response: NextResponse.next(), user: state.user }) };
});

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  state.user = null;
});

describe("route table", () => {
  it("keeps exactly the five main routes protected", () => {
    expect([...PROTECTED_ROUTES]).toEqual(["/dashboard", "/transactions", "/assistant", "/simulator", "/settings"]);
    expect(NAV_ITEMS.map((i) => i.href)).toEqual(["/dashboard", "/transactions", "/assistant", "/simulator", "/settings"]);
  });
  it("leaves auxiliary entry routes public and out of the nav", () => {
    for (const route of AUXILIARY_ROUTES) {
      expect(isProtectedPath(route)).toBe(false);
      expect(NAV_ITEMS.some((i) => i.href === route && route !== "/")).toBe(false);
    }
    expect(isProtectedPath("/api/profile/bootstrap")).toBe(false); // API routes authenticate themselves
  });
});

describe("middleware", () => {
  const run = async (path: string) => {
    const { middleware } = await import("@/middleware");
    return middleware(new NextRequest(`http://localhost:3000${path}`));
  };
  it.each(["/", "/login", "/signup", "/onboarding", "/auth/callback"])("lets a signed-out visitor reach %s", async (path) => {
    const res = await run(path);
    expect(res.status).toBe(200);
    expect(res.headers.get("location")).toBeNull();
  });
  it.each(["/dashboard", "/transactions", "/assistant", "/simulator", "/settings"])("redirects a signed-out visitor from %s to /", async (path) => {
    const res = await run(path);
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/");
  });
  it("lets a signed-in visitor into a protected route", async () => {
    state.user = { id: "u" };
    expect((await run("/dashboard")).headers.get("location")).toBeNull();
  });
});
