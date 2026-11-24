import { appendFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";

/**
 * Tracks the anonymous guest ids created by E2E tests and deletes EXACTLY those ids at the end
 * (auth.admin.deleteUser cascades their rows). Never lists users, never matches by pattern.
 * The service-role key is read from the environment Node loaded from .env.local; it is never
 * printed. Approved under G2 item (ii).
 */
const LEDGER = join(process.cwd(), "test-results", "e2e-created-users.txt");
const APPROVED_REF = "llrxhefrqnjdwlmxozul";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function decodeSessionCookie(raw: string): string | null {
  let value = decodeURIComponent(raw);
  if (value.startsWith("base64-")) value = Buffer.from(value.slice(7), "base64url").toString("utf8");
  try {
    const session = JSON.parse(value) as { access_token?: string; user?: { id?: string } };
    if (session.user?.id) return session.user.id;
    const payload = session.access_token?.split(".")[1];
    return payload ? ((JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub?: string }).sub ?? null) : null;
  } catch {
    return null;
  }
}

/** Reads the signed-in user id from the Supabase auth cookie(s) of the browser context. */
export async function currentUserId(context: BrowserContext): Promise<string | null> {
  const cookies = await context.cookies();
  const auth = cookies.filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name)).sort((a, b) => a.name.localeCompare(b.name));
  if (auth.length === 0) return null;
  const joined = auth.map((c) => c.value).join("");
  const id = decodeSessionCookie(joined);
  return id && UUID.test(id) ? id : null;
}

export async function recordCreatedUser(context: BrowserContext): Promise<string | null> {
  const id = await currentUserId(context);
  if (id) appendFileSync(LEDGER, `${id}\n`);
  return id;
}

export async function deleteRecordedUsers(): Promise<{ deleted: number; failed: string[] }> {
  if (!existsSync(LEDGER)) return { deleted: 0, failed: [] };
  const ids = [...new Set(readFileSync(LEDGER, "utf8").split("\n").map((s) => s.trim()).filter((s) => UUID.test(s)))];
  if (ids.length === 0) return { deleted: 0, failed: [] };
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const key = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();
  let origin = "";
  try {
    origin = new URL(url).origin;
  } catch {
    // fall through
  }
  if (!key || origin !== `https://${APPROVED_REF}.supabase.co`) return { deleted: 0, failed: ids };
  const failed: string[] = [];
  let deleted = 0;
  for (const id of ids) {
    const res = await fetch(`${origin}/auth/v1/admin/users/${id}`, {
      method: "DELETE",
      headers: { apikey: key, authorization: `Bearer ${key}` },
    });
    if (res.ok || res.status === 404) deleted += 1;
    else failed.push(id);
  }
  if (failed.length === 0) rmSync(LEDGER, { force: true });
  return { deleted, failed };
}
