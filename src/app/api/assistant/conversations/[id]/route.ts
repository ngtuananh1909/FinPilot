import { requireOwner } from "@/lib/auth/owner-context";
import { proposalToDto } from "@/lib/assistant/proposals";
import { createSupabaseServerClient } from "@/lib/db/server";
import { getConversation, listMessages } from "@/lib/db/repositories/server-only/ai-chat";
import { listProposalsForConversation } from "@/lib/db/repositories/server-only/ai-proposals";
import { AppError, toErrorResponse } from "@/lib/errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Messages and proposals of one of the caller's conversations (RLS client, owner-filtered). */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const supabase = await createSupabaseServerClient();
    const owner = await requireOwner(supabase);
    const { id } = await context.params;
    const conversation = await getConversation(supabase, owner, id);
    if (!conversation) throw new AppError("not_found");
    const now = new Date();
    const [messages, proposals] = await Promise.all([
      listMessages(supabase, owner, conversation.id),
      listProposalsForConversation(supabase, owner, conversation.id),
    ]);
    return Response.json(
      { conversation, messages, proposals: proposals.map((p) => proposalToDto(p, now)) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
