import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = { exchanged: [] as string[], error: null as unknown, throws: false };
vi.mock("@/lib/db/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      exchangeCodeForSession: async (code: string) => {
        if (state.throws) throw new Error("boom");
        state.exchanged.push(code);
        return { error: state.error };
      },
    },
  }),
}));

const APP = "https://app.example.com";
const get = async (query: string) => {
  const { GET } = await import("@/app/auth/callback/route");
  // The request host is deliberately different from the configured app origin.
  return GET(new Request(`http://internal-host:3000/auth/callback${query}`));
};
const location = (res: Response) => new URL(res.headers.get("location") ?? "");

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "test-publishable");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP);
  state.exchanged = [];
  state.error = null;
  state.throws = false;
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /auth/callback", () => {
  it("exchanges the code and redirects to the sanitized next path on the app origin", async () => {
    const res = await get("?code=abc&next=%2Fonboarding");
    expect(state.exchanged).toEqual(["abc"]);
    expect(location(res).origin).toBe(APP);
    expect(location(res).pathname).toBe("/onboarding");
  });

  it("defaults to /onboarding when next is absent", async () => {
    expect(location(await get("?code=abc")).pathname).toBe("/onboarding");
  });

  it.each(["//evil.com", "https://evil.com", "/\\evil.com", "javascript:alert(1)", "%2F%2Fevil.com", "/%2Fevil.com", "evil.com"])(
    "never redirects off-site for next=%s",
    async (next) => {
      const res = await get(`?code=abc&next=${encodeURIComponent(next)}`);
      expect(location(res).origin).toBe(APP);
      expect(location(res).hostname).toBe("app.example.com");
      expect(location(res).pathname).toBe("/onboarding");
    },
  );

  it("sends failures to /login?error=callback", async () => {
    const noCode = await get("?next=%2Fdashboard");
    expect(location(noCode).pathname).toBe("/login");
    expect(location(noCode).searchParams.get("error")).toBe("callback");
    expect(state.exchanged).toEqual([]);

    state.error = { message: "invalid grant" };
    const bad = await get("?code=abc");
    expect(location(bad).pathname).toBe("/login");

    state.error = null;
    state.throws = true;
    expect(location(await get("?code=abc")).pathname).toBe("/login");
  });
});
