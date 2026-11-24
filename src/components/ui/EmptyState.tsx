import type { ReactNode } from "react";

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="rounded-2xl border border-outline-variant bg-surface-container-lowest p-6 text-center">
      <h2 className="text-lg font-semibold text-on-surface">{title}</h2>
      {description ? <p className="mt-2 text-sm text-on-surface-variant">{description}</p> : null}
      {action ? <div className="mt-4 flex justify-center">{action}</div> : null}
    </div>
  );
}
