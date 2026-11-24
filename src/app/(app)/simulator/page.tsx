import { redirect } from "next/navigation";
import { loadSimulator } from "@/features/simulator/load-simulator";
import { SimulatorContent } from "@/features/simulator/SimulatorView";

export const metadata = { title: "Mô phỏng · FinPilot AI" };
// The date window depends on today's date: never cached or prerendered.
export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await loadSimulator();
  if (state.kind === "unauthenticated") redirect("/");
  return <SimulatorContent state={state} />;
}
