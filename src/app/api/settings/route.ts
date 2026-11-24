import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { getSettingsForOwner } from "@/lib/settings/service";
import { jsonNoStore } from "@/lib/transactions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings -> { profile, goal, recurringItems, recurringTruncated, forecastReadiness }. */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    return jsonNoStore(await getSettingsForOwner(supabase, owner));
  } catch (error) {
    return toErrorResponse(error);
  }
}
