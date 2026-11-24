import { describe, expect, it, vi } from "vitest";
import type { SeedAdmin } from "@/lib/demo/seed-accounts";
import { main } from "@/lib/demo/seed-cli";
import { createFakeSeedAdmin } from "@/lib/demo/seed-fake-admin";
import { GOOD_ENV } from "./support/seed-env";

const REF = "abcdefghijklmnop";
const GATED_ENV = {
  ...GOOD_ENV,
  NEXT_PUBLIC_SUPABASE_URL: `https://${REF}.supabase.co`,
  SEED_ALLOWED_PROJECT_REF: REF,
  SEED_CONFIRM_PROJECT_REF: REF,
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key-should-never-print",
};
const NOW = () => new Date("2026-12-05T03:00:00Z");

function harness() {
  const lines: string[] = [];
  return { lines, io: { out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

describe("seed CLI", () => {
  it("default run is an offline dry-run and never builds the real admin", async () => {
    const createRealAdmin = vi.fn<() => Promise<SeedAdmin>>();
    const { io, lines } = harness();
    const code = await main([], GATED_ENV, io, { createRealAdmin, now: NOW });
    expect(code).toBe(0);
    expect(createRealAdmin).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("DRY-RUN");
  });

  it.each([
    ["no refs", { SEED_ALLOWED_PROJECT_REF: undefined, SEED_CONFIRM_PROJECT_REF: undefined }],
    ["no allowed ref", { SEED_ALLOWED_PROJECT_REF: undefined }],
    ["confirm mismatch", { SEED_CONFIRM_PROJECT_REF: "zzzzzzzzzzzzzzzz" }],
    ["local URL", { NEXT_PUBLIC_SUPABASE_URL: "http://127.0.0.1:54321" }],
  ])("--apply refuses before constructing the admin: %s", async (_label, override) => {
    const createRealAdmin = vi.fn<() => Promise<SeedAdmin>>();
    const { io, lines } = harness();
    const code = await main(["--apply"], { ...GATED_ENV, ...override }, io, { createRealAdmin, now: NOW });
    expect(code).toBe(1);
    expect(createRealAdmin).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("gate_apply_not_allowed");
  });

  it("--apply with a matching gate uses the injected admin and writes", async () => {
    const admin = createFakeSeedAdmin();
    const createRealAdmin = vi.fn(async () => admin);
    const { io } = harness();
    const code = await main(["--apply"], GATED_ENV, io, { createRealAdmin, now: NOW });
    expect(code).toBe(0);
    expect(createRealAdmin).toHaveBeenCalledTimes(1);
    expect(admin.users.size).toBe(3);
    expect(admin.profiles.size).toBe(3);
  });

  it("--fake never builds the real admin, even with --apply and no gate", async () => {
    const createRealAdmin = vi.fn<() => Promise<SeedAdmin>>();
    const { io, lines } = harness();
    const code = await main(["--fake", "--apply"], GOOD_ENV, io, { createRealAdmin, now: NOW });
    expect(code).toBe(0);
    expect(createRealAdmin).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain("FAKE MODE");
  });

  it("output never contains passwords, keys or full e-mails", async () => {
    const admin = createFakeSeedAdmin();
    const { io, lines } = harness();
    await main(["--apply", "--force"], GATED_ENV, io, { createRealAdmin: async () => admin, now: NOW });
    await main([], GATED_ENV, io, { now: NOW });
    await main(["--apply"], { ...GATED_ENV, SEED_CONFIRM_PROJECT_REF: "nope" }, io, { now: NOW });
    const text = lines.join("\n");
    for (const secret of [
      "placeholder-pass",
      "service-role-key",
      "alice.student@example.test",
      "bob.worker@example.test",
      "carol.risk@example.test",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("rejects unknown arguments without echoing them", async () => {
    const { io, lines } = harness();
    expect(await main(["--password=hunter2hunter2"], GOOD_ENV, io, { now: NOW })).toBe(2);
    expect(lines.join("\n")).not.toContain("hunter2");
  });

  it("reports invalid configuration with exit code 1 and no values", async () => {
    const { io, lines } = harness();
    const code = await main([], { ...GOOD_ENV, SEED_USER_2_EMAIL: GOOD_ENV.SEED_USER_1_EMAIL }, io, { now: NOW });
    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("duplicate_email");
    expect(lines.join("\n")).not.toContain("example.test");
  });

  it("exits non-zero when an account is blocked", async () => {
    const admin = createFakeSeedAdmin({ users: [{ email: "alice.student@example.test", id: "99999999-9999-4999-8999-999999999999" }] });
    admin.profiles.set("99999999-9999-4999-8999-999999999999", { isDemo: false, personaCode: null });
    const { io } = harness();
    expect(await main(["--apply"], GATED_ENV, io, { createRealAdmin: async () => admin, now: NOW })).toBe(1);
  });
});
