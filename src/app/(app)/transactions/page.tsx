import { TransactionsView } from "@/features/transactions/TransactionsView";
import { isAiConfigured } from "@/lib/ai/config";

export const metadata = { title: "Thu chi · FinPilot AI" };
// AI availability is a runtime (server env) fact, so the page is rendered per request.
export const dynamic = "force-dynamic";

export default function Page() {
  return <TransactionsView aiConfigured={isAiConfigured()} />;
}
