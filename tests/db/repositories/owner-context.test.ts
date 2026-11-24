import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { User } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import {
  assertOwnerContext,
  isOwnerContext,
  ownerContextFromVerifiedUser,
  requireOwner,
  type OwnerContext,
} from "@/lib/auth/owner-context";
import type { AuthVerifier } from "@/lib/auth/require-user";
import { getProfile } from "@/lib/db/repositories/profile";
import { listTransactions } from "@/lib/db/repositories/transactions";
import { createFakeClient, makeOwner, OTHER_ID, OWNER_ID } from "./support/fake-client";

describe("OwnerContext brand (adversarial)", () => {
  it("cannot be built from an arbitrary string or a plain object (type-level)", () => {
    const { client } = createFakeClient();
    // @ts-expect-error a raw id string is not an OwnerContext
    void getProfile(client, OTHER_ID).catch(() => undefined);
    // @ts-expect-error a structurally similar object lacks the unique-symbol brand
    void getProfile(client, { userId: OTHER_ID, isAnonymous: false }).catch(() => undefined);
    // @ts-expect-error the brand symbol is not exported, so it cannot be written by callers
    const forged: OwnerContext = { userId: OTHER_ID, isAnonymous: false };
    expect(forged.userId).toBe(OTHER_ID);
  });

  it("runtime: a forged cast is rejected by every repository entry point", async () => {
    const { client, queries } = createFakeClient();
    const forged = { userId: OTHER_ID, isAnonymous: false } as unknown as OwnerContext;
    expect(isOwnerContext(forged)).toBe(false);
    expect(() => assertOwnerContext(forged)).toThrowError();
    await expect(getProfile(client, forged)).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(listTransactions(client, forged, {})).rejects.toMatchObject({ code: "unauthenticated" });
    expect(queries).toHaveLength(0);
  });

  it("runtime: a copy of a genuine context is not trusted", async () => {
    const real = makeOwner();
    const copy = { ...real } as unknown as OwnerContext;
    expect(isOwnerContext(real)).toBe(true);
    expect(isOwnerContext(copy)).toBe(false);
  });

  it("the factory rejects non-uuid ids and mismatching user objects", () => {
    const bad = (userId: string, id: string) => () =>
      ownerContextFromVerifiedUser({ userId, user: { id } as User, isAnonymous: false });
    expect(bad("verified-id", "verified-id")).toThrowError();
    expect(bad("", "")).toThrowError();
    expect(bad(OWNER_ID, OTHER_ID)).toThrowError();
    expect(bad("1' or '1'='1", "1' or '1'='1")).toThrowError();
  });

  it("issues frozen contexts that carry the verified id and anonymity flag", () => {
    const ctx = ownerContextFromVerifiedUser({ userId: OWNER_ID.toUpperCase(), user: { id: OWNER_ID.toUpperCase() } as User, isAnonymous: true });
    expect(ctx.userId).toBe(OWNER_ID);
    expect(ctx.isAnonymous).toBe(true);
    expect(Object.isFrozen(ctx)).toBe(true);
  });

  it("requireOwner derives the id only from auth.getUser()", async () => {
    const verifier = {
      auth: { getUser: async () => ({ data: { user: { id: OWNER_ID, is_anonymous: true } as User }, error: null }) },
    } as unknown as AuthVerifier;
    const owner = await requireOwner(verifier);
    expect(owner.userId).toBe(OWNER_ID);
    expect(owner.isAnonymous).toBe(true);
    const failing = { auth: { getUser: async () => ({ data: { user: null }, error: new Error("jwt expired") }) } } as unknown as AuthVerifier;
    await expect(requireOwner(failing)).rejects.toMatchObject({ code: "unauthenticated" });
  });

  it("static: only src/lib/auth calls ownerContextFromVerifiedUser", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (/\.tsx?$/.test(name) && !full.includes(join("src", "lib", "auth"))) {
          if (readFileSync(full, "utf8").includes("ownerContextFromVerifiedUser")) offenders.push(full);
        }
      }
    };
    walk(join(process.cwd(), "src"));
    expect(offenders).toEqual([]);
  });

  it("static: repositories never import the admin client (server-only wrappers are the only exception)", () => {
    const dir = join(process.cwd(), "src/lib/db/repositories");
    const files = readdirSync(dir).filter((n) => n.endsWith(".ts"));
    expect(files.length).toBeGreaterThan(5);
    for (const f of files) {
      const src = readFileSync(join(dir, f), "utf8");
      expect(src, f).not.toMatch(/createSupabaseAdminClient|SERVICE_ROLE/);
    }
  });
});
