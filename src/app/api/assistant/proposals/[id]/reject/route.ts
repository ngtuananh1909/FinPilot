import { requireOwner } from "@/lib/auth/owner-context";
import { rejectProposal } from "@/lib/assistant/proposals";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Explicit user decision on an AI proposal. Body must be exactly {"confirm": true}. The owner
 * comes from the verified session; the proposal id is checked against that owner.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = (await readJsonObject(request, 1024)) as Record<string, unknown>;
    if (Object.keys(body).length !== 1 || body.confirm !== true) {
      throw new AppError("validation_failed", { safeDetails: { rule: "confirm_required" } });
    }
    const { id } = await context.params;
    const proposal = await rejectProposal({ client: supabase, admin: createSupabaseAdminClient() }, owner, id, new Date());
    return Response.json({ proposal }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
