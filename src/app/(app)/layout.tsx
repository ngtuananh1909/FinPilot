import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { AppShell, type ShellSession } from "@/components/shell/AppShell";
import { loadViewer } from "@/lib/auth/server-viewer";

// Reads the verified session on every request; the Demo badge must never come from a cache.
export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const viewer = await loadViewer({ withProfile: true });
  if (!viewer) redirect("/"); // middleware already guards these routes; this is defense in depth
  const session: ShellSession = {
    isGuest: viewer.isAnonymous,
    isDemo: viewer.isDemo,
    displayName: viewer.displayName,
    profile: viewer.profile,
  };
  return <AppShell session={session}>{children}</AppShell>;
}
