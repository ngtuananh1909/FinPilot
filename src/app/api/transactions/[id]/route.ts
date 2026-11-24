import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { jsonNoStore } from "@/lib/transactions/http";
import { parseDeleteConfirmation } from "@/lib/transactions/schemas";
import { deleteTransactionForOwner, updateTransactionForOwner } from "@/lib/transactions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext {
  // Next 15: dynamic route params are a Promise.
  params: Promise<{ id: string }>;
}

/** PATCH /api/transactions/:id. Returns { transaction, impact }; 404 if missing or not owned. */
export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore(await updateTransactionForOwner(supabase, owner, id, body, new Date()));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/**
 * DELETE /api/transactions/:id with JSON body {"confirm": true}. Without it the request is
 * rejected before any database call. Missing and not-owned ids both answer 404.
 */
export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    parseDeleteConfirmation(await readJsonObject(request));
    return jsonNoStore(await deleteTransactionForOwner(supabase, owner, id));
  } catch (error) {
    return toErrorResponse(error);
  }
}
