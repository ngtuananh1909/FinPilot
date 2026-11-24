import { redirect } from "next/navigation";
import { AssistantView } from "@/features/assistant/AssistantView";
import { isAiConfigured } from "@/lib/ai/config";
import { readChatQuota } from "@/lib/assistant/chat";
import { sanitizePrefill } from "@/lib/assistant/question";
import { requireOwner } from "@/lib/auth/owner-context";
import { createSupabaseServerClient } from "@/lib/db/server";
import { isAppError } from "@/lib/errors";

export const metadata = { title: "Trợ lý AI · FinPilot AI" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const supabase = await createSupabaseServerClient();
  let quota = null;
  try {
    const owner = await requireOwner(supabase);
    quota = await readChatQuota(supabase, owner, new Date());
  } catch (error) {
    if (isAppError(error) && error.code === "unauthenticated") redirect("/");
    // Quota display is best effort; the server still enforces it on every message.
  }
  const params = await searchParams;
  return <AssistantView aiConfigured={isAiConfigured()} initialQuota={quota} prefill={sanitizePrefill(params.q)} />;
}
