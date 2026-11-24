import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { patchProfileForOwner } from "@/lib/settings/service";
import { jsonNoStore } from "@/lib/transactions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * PATCH /api/settings/profile. Editable: displayName, expectedMonthlyIncomeVnd, paydayDay,
 * expectedDailyExpenseVnd, projectedMonthlyBudgetVnd, minimumReserveVnd. The balance snapshot
 * has its own explicit route; persona_code / is_demo / user_id are rejected.
 */
export async function PATCH(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore(await patchProfileForOwner(supabase, owner, body));
  } catch (error) {
    return toErrorResponse(error);
  }
}
