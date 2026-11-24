import { requireOwner } from "@/lib/auth/owner-context";
import { getServerEnv } from "@/lib/config/server-env";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin } from "@/lib/http/request";
import { importBodyCap, readCappedJson } from "@/lib/import/http";
import { csvLimits } from "@/lib/import/limits";
import { commitCsv } from "@/lib/import/service";

// Node runtime only (Amplify does not support Edge API routes). Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Owner comes only from the verified session. Reads use the user-scoped (RLS) client. The
 * service-role client is created only after verification and is used for exactly one call: the
 * atomic `commit_csv_import` RPC, scoped to the verified user id. The body is size-capped.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const limits = csvLimits(getServerEnv().CSV_MAX_BYTES);
    const body = await readCappedJson(request, importBodyCap(limits));
    const result = await commitCsv(supabase, owner, body, limits, createSupabaseAdminClient());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
