import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..", "..");
const SRC = join(ROOT, "src");

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx|mts|js|jsx)$/.test(name) ? [full] : [];
  });
}

const rel = (file: string) => relative(ROOT, file).split("\\").join("/");
const files = walk(SRC).map((file) => ({ path: rel(file), text: readFileSync(file, "utf8") }));

const ADMIN_FILE = "src/lib/db/repositories/server-only/seed-admin.ts";
const ADAPTER_FILE = "src/lib/demo/seed-supabase-admin.ts";

describe("script-only seed admin function", () => {
  it("is referenced only by its own file and the script's real adapter", () => {
    const offenders = files
      .filter((f) => f.path !== ADMIN_FILE && f.path !== ADAPTER_FILE)
      .filter((f) => /resetPersonaForSeededUser|server-only\/seed-admin|\.\/seed-admin/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("is not re-exported from the server-only barrel", () => {
    const barrel = files.find((f) => f.path === "src/lib/db/repositories/server-only/index.ts");
    expect(barrel?.text).not.toMatch(/seed-admin/);
  });

  it("the real adapter is imported only by the seed CLI", () => {
    const importers = files
      .filter((f) => f.path !== ADAPTER_FILE && /seed-supabase-admin/.test(f.text))
      .map((f) => f.path);
    expect(importers).toEqual(["src/lib/demo/seed-cli.ts"]);
  });

  it("nothing under src/app or the app-facing demo barrel touches the seed modules", () => {
    const offenders = files
      .filter((f) => f.path.startsWith("src/app/") || f.path === "src/lib/demo/index.ts")
      .filter((f) => /seed-(accounts|cli|admin|fake-admin|supabase-admin)|resetPersonaForSeededUser/.test(f.text))
      .map((f) => f.path);
    expect(offenders).toEqual([]);
  });

  it("the seed modules never call ownerContextFromVerifiedUser or delete/update users", () => {
    for (const f of files.filter((x) => /\/seed-[a-z-]+\.ts$/.test(x.path))) {
      expect(f.text, f.path).not.toMatch(/ownerContextFromVerifiedUser\(/);
      expect(f.text, f.path).not.toMatch(/deleteUser|updateUserById|\.delete\(|resetPasswordForEmail/);
    }
  });
});
