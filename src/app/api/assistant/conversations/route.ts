import { requireOwner } from "@/lib/auth/owner-context";
import { isAiConfigured } from "@/lib/ai/config";
import { readChatQuota } from "@/lib/assistant/chat";
import { createSupabaseServerClient } from "@/lib/db/server";
import { listConversations } from "@/lib/db/repositories/server-only/ai-chat";
import { toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Assistant status for the caller: whether AI is configured (boolean only), quota, conversations. */
export async function GET(): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const now = new Date();
    const [quota, conversations] = await Promise.all([readChatQuota(supabase, owner, now), listConversations(supabase, owner)]);
    return Response.json({ aiConfigured: isAiConfigured(), quota, conversations }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return toErrorResponse(error);
  }
}
