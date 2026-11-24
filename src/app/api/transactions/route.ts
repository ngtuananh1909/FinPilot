import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { jsonNoStore } from "@/lib/transactions/http";
import { searchParamsToObject } from "@/lib/transactions/schemas";
import { createTransactionForOwner, listTransactionsForOwner } from "@/lib/transactions/service";

// Node runtime only (Amplify does not support Edge API routes). Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/transactions?limit&offset&kind&category&fromDate&toDate&search
 * RLS-bound client; the owner comes only from the verified session.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const query = searchParamsToObject(new URL(request.url).searchParams, { numeric: ["limit", "offset"] });
    return jsonNoStore(await listTransactionsForOwner(supabase, owner, query));
  } catch (error) {
    return toErrorResponse(error);
  }
}

/** POST /api/transactions. Body: see transactionCreateBodySchema. Returns 201 { transaction, impact }. */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore(await createTransactionForOwner(supabase, owner, body, new Date()), 201);
  } catch (error) {
    return toErrorResponse(error);
  }
}
