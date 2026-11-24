import { requireOwner } from "@/lib/auth/owner-context";
import { getServerEnv } from "@/lib/config/server-env";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http/request";
import { importBodyCap, readCappedJson } from "@/lib/import/http";
import { csvLimits } from "@/lib/import/limits";
import { previewCsv } from "@/lib/import/service";

// Node runtime only (Amplify does not support Edge API routes). Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner comes only from the verified session. Uses the user-scoped (RLS) Supabase client;
 * there is no service-role client on this path. The body is size-capped while it is read.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const limits = csvLimits(getServerEnv().CSV_MAX_BYTES);
    const body = await readCappedJson(request, importBodyCap(limits));
    const result = await previewCsv(supabase, owner, body, limits);
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
