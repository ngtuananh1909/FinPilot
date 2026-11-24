import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { deleteGoalForOwner, getGoalForOwner, putGoalForOwner } from "@/lib/settings/service";
import { jsonNoStore } from "@/lib/transactions/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/settings/goal -> { goal } (null when none). One goal per user by primary key. */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    return jsonNoStore({ goal: await getGoalForOwner(supabase, owner) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** PUT /api/settings/goal: create or replace the single goal. Omitted targetDate clears it. */
export async function PUT(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore({ goal: await putGoalForOwner(supabase, owner, body, new Date()) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** DELETE /api/settings/goal { confirm: true }. Idempotent. */
export async function DELETE(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    await deleteGoalForOwner(supabase, owner, body);
    return jsonNoStore({ goal: null });
  } catch (error) {
    return toErrorResponse(error);
  }
}
