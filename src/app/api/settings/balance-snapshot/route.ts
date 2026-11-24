import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { setBalanceSnapshotForOwner } from "@/lib/settings/service";
import { jsonNoStore } from "@/lib/transactions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/settings/balance-snapshot { amountVnd, confirm: true }.
 * Explicit rebase: sets the snapshot amount and stamps it with the SERVER time. Earlier
 * transactions are not re-applied. Responds with the previous snapshot for the UI.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore(await setBalanceSnapshotForOwner(supabase, owner, body, new Date()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
