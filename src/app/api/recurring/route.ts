import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { jsonNoStore } from "@/lib/transactions/http";
import { searchParamsToObject } from "@/lib/transactions/schemas";
import { createRecurringForOwner, listRecurringForOwner } from "@/lib/transactions/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/recurring?limit&offset&activeOnly
 * Includes `unreconciledSuggestions`: proposed matches only, never applied automatically.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const query = searchParamsToObject(new URL(request.url).searchParams, {
      numeric: ["limit", "offset"],
      booleans: ["activeOnly"],
    });
    return jsonNoStore(await listRecurringForOwner(supabase, owner, query, new Date()));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/recurring. Returns 201 with the created item. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore({ item: await createRecurringForOwner(supabase, owner, body) }, 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
