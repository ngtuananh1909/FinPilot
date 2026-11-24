export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-primary-container/60 ${className}`} />;
}

/** Standard page-level loading placeholder announced once to assistive tech. */
export function PageSkeleton({ label = "Đang tải…" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">{label}</span>
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-28 w-full" />
      <Skeleton className="h-16 w-full" />
    </div>
  );
}
