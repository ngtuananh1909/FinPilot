import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { bootstrapProfile } from "@/lib/db/repositories/server-only";
import { createSupabaseServerClient } from "@/lib/db/server";
import { AppError, toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/profile/bootstrap: creates the default (empty) profile for the verified, signed-in
 * (non-anonymous) caller if none exists. Anonymous guests get theirs from /api/demo/start.
 * The body must be an empty object: the owner id and any profile field are never accepted.
 * The service-role client is created only after the session has been verified.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    if (owner.isAnonymous) throw new AppError("forbidden");
    const body = await readJsonObject(request);
    if (Object.keys(body as Record<string, unknown>).length > 0) throw new AppError("validation_failed");
    const created = await bootstrapProfile(createSupabaseAdminClient(), owner, {});
    return Response.json({ created }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
