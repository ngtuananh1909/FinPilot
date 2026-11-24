import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { jsonNoStore } from "@/lib/transactions/http";
import { updateRecurringForOwner } from "@/lib/transactions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/recurring/:id. Edits fields; `{ "active": false }` soft-deactivates.
 * There is deliberately no DELETE: items referenced by transactions are never removed.
 */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore({ item: await updateRecurringForOwner(supabase, owner, id, body) });
  } catch (error) {
    return toErrorResponse(error);
  }
}
