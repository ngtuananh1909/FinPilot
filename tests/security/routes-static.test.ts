import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Static audit of every API route handler (docs/08 "Mandatory controls"). Reads source text only.
 */
const ROOT = join(process.cwd(), "src/app");
function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : name === "route.ts" ? [p] : [];
  });
}
const routes = walk(ROOT).map((file) => ({ file: relative(process.cwd(), file), src: readFileSync(file, "utf8") }));
const MUTATING = /export\s+async\s+function\s+(POST|PUT|PATCH|DELETE)\b/;
const PUBLIC_ROUTES = new Set(["src/app/auth/callback/route.ts"]);

describe("API route security invariants", () => {
  it("finds the route handlers", () => {
    expect(routes.length).toBeGreaterThanOrEqual(20);
  });

  it.each(routes.map((r) => [r.file, r] as const))("%s runs on Node and is never cached", (_f, r) => {
    expect(r.src).toMatch(/export const runtime = "nodejs"/);
    expect(r.src).toMatch(/export const dynamic = "force-dynamic"/);
    expect(r.src).not.toMatch(/runtime = "edge"|unstable_after|ReadableStream|text\/event-stream/);
  });

  it.each(routes.filter((r) => MUTATING.test(r.src) && !PUBLIC_ROUTES.has(r.file)).map((r) => [r.file, r] as const))(
    "%s checks the Origin header before doing anything else (CSRF)",
    (_f, r) => {
      const body = r.src.slice(r.src.search(MUTATING));
      const origin = body.indexOf("assertSameOrigin(request)");
      expect(origin).toBeGreaterThan(-1);
      expect(origin).toBeLessThan(body.indexOf("requireOwner("));
    },
  );

  it.each(routes.filter((r) => !PUBLIC_ROUTES.has(r.file)).map((r) => [r.file, r] as const))(
    "%s derives the owner from the verified session",
    (_f, r) => {
      expect(r.src).toMatch(/requireOwner\(/);
    },
  );

  it.each(routes.map((r) => [r.file, r] as const))("%s never reads an owner id from the request", (_f, r) => {
    expect(r.src).not.toMatch(/body\.(user_?id|owner)|searchParams\.get\(["'](user_?id|owner)/i);
  });

  it.each(routes.filter((r) => r.src.includes("createSupabaseAdminClient")).map((r) => [r.file, r] as const))(
    "%s creates the service-role client only after requireOwner()",
    (_f, r) => {
      expect(r.src.indexOf("createSupabaseAdminClient()")).toBeGreaterThan(r.src.indexOf("requireOwner("));
    },
  );

  it.each(routes.map((r) => [r.file, r] as const))("%s returns errors through toErrorResponse (no stack traces)", (_f, r) => {
    if (PUBLIC_ROUTES.has(r.file)) return;
    expect(r.src).toMatch(/toErrorResponse\(error\)/);
    expect(r.src).not.toMatch(/error\.stack|String\(error\)/);
  });

  it("server-only secrets are never referenced through NEXT_PUBLIC_ names", () => {
    const all = walk(join(process.cwd(), "src")).length; // route files only; full scan below
    expect(all).toBeGreaterThan(0);
    const srcFiles: string[] = [];
    const scan = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) scan(p);
        else if (/\.(ts|tsx)$/.test(n)) srcFiles.push(p);
      }
    };
    scan(join(process.cwd(), "src"));
    for (const f of srcFiles) {
      const s = readFileSync(f, "utf8");
      expect(s, f).not.toMatch(/NEXT_PUBLIC_[A-Z_]*(SERVICE_ROLE|AI_API_KEY|SECRET)/);
      if (s.startsWith('"use client"')) {
        expect(s, f).not.toMatch(/server-env|db\/admin|SUPABASE_SERVICE_ROLE_KEY|AI_API_KEY/);
      }
    }
  });
});
