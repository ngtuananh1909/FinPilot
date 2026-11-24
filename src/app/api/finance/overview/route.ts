import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { getOverviewForOwner } from "@/features/dashboard/overview-service";
import { jsonNoStore } from "@/lib/transactions/http";

// Node runtime only (Amplify does not support Edge API routes). Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/finance/overview -> OverviewDto (see src/features/dashboard/overview-types.ts).
 * Read-only. RLS-bound client; the owner comes only from the verified session; the clock is the
 * server's. No service-role client.
 */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    return jsonNoStore(await getOverviewForOwner(supabase, owner, new Date()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
