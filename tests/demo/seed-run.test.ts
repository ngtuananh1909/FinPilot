import { describe, expect, it } from "vitest";
import { formatReport, planSeed, runSeed, seedIdempotencyKey } from "@/lib/demo/seed-accounts";
import { createFakeSeedAdmin } from "@/lib/demo/seed-fake-admin";
import { GOOD_ENV } from "./support/seed-env";

const NOW = new Date("2026-12-05T03:00:00Z");
const plan = planSeed(GOOD_ENV);
const WRITES = ["createUser", "callResetRpc"];
const writesOf = (calls: string[]) => calls.filter((c) => WRITES.includes(c));

describe("runSeed dry-run", () => {
  it("performs no writes, with or without lookups", async () => {
    const offline = createFakeSeedAdmin();
    const r1 = await runSeed(offline, plan, NOW);
    expect(offline.calls).toEqual([]);
    expect(r1.mode).toBe("dry-run");
    expect(r1.entries.every((e) => e.status === "planned")).toBe(true);

    const withLookup = createFakeSeedAdmin();
    const r2 = await runSeed(withLookup, plan, NOW, { lookup: true });
    expect(writesOf(withLookup.calls)).toEqual([]);
    expect(withLookup.users.size).toBe(0);
    expect(r2.entries.map((e) => [e.userAction, e.cloneAction])).toEqual([
      ["create", "clone"],
      ["create", "clone"],
      ["create", "clone"],
    ]);
  });

  it("output has masked e-mails and persona names but no full e-mail or password", async () => {
    const report = await runSeed(createFakeSeedAdmin(), plan, NOW, { lookup: true });
    const text = formatReport(report).join("\n");
    expect(text).toContain("a***@e***.test");
    expect(text).toContain("student");
    expect(text).toContain("at_risk");
    for (const account of plan.accounts) {
      expect(text).not.toContain(account.email);
      expect(text).not.toContain(account.password);
    }
    expect(text).not.toContain("alice");
  });
});

describe("runSeed apply", () => {
  it("creates users with confirmed e-mail and clones each persona with the v1 key", async () => {
    const admin = createFakeSeedAdmin();
    const report = await runSeed(admin, plan, NOW, { apply: true });
    expect(report.entries.map((e) => e.status)).toEqual(["done", "done", "done"]);
    expect(admin.calls.filter((c) => c === "createUser")).toHaveLength(3);
    for (const entry of report.entries) {
      expect(admin.resetKeys).toContain(`${entry.userId}|seed:${entry.personaCode}:${entry.userId}:v1`);
      expect(admin.profiles.get(entry.userId!)).toEqual({ isDemo: true, personaCode: entry.personaCode });
    }
  });

  it("is idempotent: a second run skips every account and writes nothing", async () => {
    const admin = createFakeSeedAdmin();
    await runSeed(admin, plan, NOW, { apply: true });
    admin.calls.length = 0;
    const again = await runSeed(admin, plan, NOW, { apply: true });
    expect(again.entries.map((e) => [e.userAction, e.cloneAction, e.status, e.reason])).toEqual([
      ["reuse", "skip", "skipped", "already_seeded"],
      ["reuse", "skip", "skipped", "already_seeded"],
      ["reuse", "skip", "skipped", "already_seeded"],
    ]);
    expect(writesOf(admin.calls)).toEqual([]);
    expect(admin.users.size).toBe(3);
  });

  it("reuses an existing user and never touches the password or creates a duplicate", async () => {
    const existingId = "99999999-9999-4999-8999-999999999999";
    const admin = createFakeSeedAdmin({
      users: [{ email: "Alice.Student@example.test", id: existingId, password: "owner-chosen-password" }],
    });
    const report = await runSeed(admin, plan, NOW, { apply: true });
    expect(report.entries[0]).toMatchObject({ userAction: "reuse", userId: existingId, status: "done" });
    expect(admin.users.get("alice.student@example.test")).toEqual({ id: existingId, password: "owner-chosen-password" });
    expect(admin.calls.filter((c) => c === "createUser")).toHaveLength(2);
  });

  it("force re-clones with a fresh key; a repeat of the same forced key would be a replay", async () => {
    const admin = createFakeSeedAdmin();
    await runSeed(admin, plan, NOW, { apply: true });
    const forced = await runSeed(admin, plan, NOW, { apply: true, force: true });
    expect(forced.entries.map((e) => [e.status, e.replay])).toEqual([
      ["done", false],
      ["done", false],
      ["done", false],
    ]);
    expect(admin.resetKeys).toHaveLength(6);
    expect(seedIdempotencyKey("student", "u", true, NOW)).toBe(`seed:student:u:v1:force:${NOW.getTime()}`);
    expect(seedIdempotencyKey("student", "u", true, NOW).length).toBeLessThanOrEqual(128);
  });

  it("blocks (and does not write) when the profile is not a demo profile, even with force", async () => {
    const id = "99999999-9999-4999-8999-999999999999";
    const admin = createFakeSeedAdmin({ users: [{ email: "alice.student@example.test", id }] });
    admin.profiles.set(id, { isDemo: false, personaCode: "student" });
    const report = await runSeed(admin, plan, NOW, { apply: true, force: true });
    expect(report.entries[0]).toMatchObject({ status: "blocked", reason: "not_demo_profile" });
    expect(admin.resetKeys.some((k) => k.startsWith(id))).toBe(false);
    expect(report.entries[1]!.status).toBe("done");
  });

  it("blocks a persona mismatch unless forced", async () => {
    const id = "99999999-9999-4999-8999-999999999999";
    const make = () => {
      const admin = createFakeSeedAdmin({ users: [{ email: "alice.student@example.test", id }] });
      admin.profiles.set(id, { isDemo: true, personaCode: "worker" });
      return admin;
    };
    const plain = await runSeed(make(), plan, NOW, { apply: true });
    expect(plain.entries[0]).toMatchObject({ status: "blocked", reason: "persona_mismatch" });
    const forced = await runSeed(make(), plan, NOW, { apply: true, force: true });
    expect(forced.entries[0]!.status).toBe("done");
  });

  it("wraps admin failures without leaking provider messages", async () => {
    const admin = createFakeSeedAdmin();
    admin.createUser = async () => {
      throw new Error("User alice.student@example.test already registered");
    };
    const error = await runSeed(admin, plan, NOW, { apply: true }).catch((e: unknown) => e as Error);
    expect(error).toMatchObject({ name: "SeedError", code: "admin_failure" });
    expect((error as Error).message).not.toContain("alice");
    expect((error as Error).message).not.toContain("example.test");
  });
});

describe("formatReport header", () => {
  it("says nothing changed when every account was reused and skipped", async () => {
    const { formatReport } = await import("@/lib/demo/seed-accounts");
    const base = { slot: 1, maskedEmail: "a***@e***.com", personaCode: "student" } as const;
    const skipped = formatReport({ mode: "apply", entries: [{ ...base, userAction: "reuse", cloneAction: "skip", status: "skipped" }] } as never);
    expect(skipped[0]).toBe("APPLY: nothing to change (all accounts already exist and are seeded).");
    const created = formatReport({ mode: "apply", entries: [{ ...base, userAction: "create", cloneAction: "clone", status: "done", replay: false }] } as never);
    expect(created[0]).toBe("APPLY: changes were made.");
  });
});
