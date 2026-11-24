import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toAppError } from "@/lib/errors";
import type { DashboardState } from "./DashboardView";
import { getOverviewForOwner } from "./overview-service";

export type DashboardLoad = { kind: "unauthenticated" } | DashboardState;

/**
 * Server-side data for /dashboard: the same service the API route uses, called directly (no
 * self-HTTP). Failures become an error state; a missing session is reported so the page can redirect.
 */
export async function loadDashboard(now: Date = new Date()): Promise<DashboardLoad> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    return { kind: "overview", overview: await getOverviewForOwner(supabase, owner, now) };
  } catch (error) {
    const app = toAppError(error);
    if (app.code === "unauthenticated") return { kind: "unauthenticated" };
    console.error(`[dashboard] ${app.code}`);
    const reason = app.safeDetails?.reason ?? app.safeDetails?.financeCode;
    return { kind: "error", message: app.userMessage, code: typeof reason === "string" ? reason : app.code };
  }
}
