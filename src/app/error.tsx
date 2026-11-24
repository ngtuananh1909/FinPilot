"use client";

import { ErrorState } from "@/components/ui/ErrorState";

// Never render error.message: it may contain internal details.
export default function AppErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-md p-4">
      <ErrorState onRetry={reset} />
    </main>
  );
}
