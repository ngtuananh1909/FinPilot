import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";
import { simulatePurchaseForOwner } from "@/features/simulator/simulation-service";
import { jsonNoStore } from "@/lib/transactions/http";

// Node runtime only (Amplify does not support Edge API routes). Never cached.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/simulations/purchase -> SimulationDto (see src/features/simulator/types.ts).
 * Read-only calculation (POST only because it takes a body); nothing is written. Same-origin check,
 * verified session, RLS-bound client, strict body schema (owner keys are rejected), server clock.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request);
    return jsonNoStore(await simulatePurchaseForOwner(supabase, owner, body, new Date()));
  } catch (error) {
    return toErrorResponse(error);
  }
}
