import { requireOwner } from "@/lib/auth/owner-context";
import { getAiRuntimeConfig } from "@/lib/ai/config";
import { runAssistantChat } from "@/lib/assistant/chat";
import { getPublicEnv } from "@/lib/config/public-env";
import { createSupabaseAdminClient } from "@/lib/db/admin";
import { createSupabaseServerClient } from "@/lib/db/server";
import { toErrorResponse } from "@/lib/errors";
import { assertSameOrigin, readJsonObject } from "@/lib/http/request";

// Node runtime, never cached, no streaming (Amplify does not support Next.js streaming).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Order matters: origin check, verified owner, bounded body, AI configuration (a missing
 * configuration is reported BEFORE any quota is reserved), then the service-role client for
 * quota/message writes. The owner id never comes from the request.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const body = await readJsonObject(request, 16 * 1024);
    const config = getAiRuntimeConfig(undefined, getPublicEnv().NEXT_PUBLIC_APP_URL);
    const result = await runAssistantChat({ client: supabase, admin: createSupabaseAdminClient(), config }, owner, body, new Date());
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
