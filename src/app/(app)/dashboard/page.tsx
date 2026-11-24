import { redirect } from "next/navigation";
import { DashboardContent } from "@/features/dashboard/DashboardView";
import { loadDashboard } from "@/features/dashboard/load-dashboard";

export const metadata = { title: "Tổng quan · FinPilot AI" };
// Per-user, time-dependent data: never cached or prerendered.
export const dynamic = "force-dynamic";

export default async function Page() {
  const state = await loadDashboard();
  if (state.kind === "unauthenticated") redirect("/");
  return <DashboardContent state={state} />;
}
