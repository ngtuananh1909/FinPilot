import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { resetDemoData } from "@/lib/demo/service";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";

// Node runtime only (Amplify does not support Edge API routes). Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The owner id comes only from the verified Supabase session; the body never carries it.
 * The service-role client is created AFTER verification and is used only for the RPC.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    const result = await resetDemoData(
      { userClient: supabase, adminClient: createSupabaseAdminClient() },
      owner,
      body,
      new Date(),
    );
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
