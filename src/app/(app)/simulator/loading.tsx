import { Skeleton } from "@/components/ui/Skeleton";

/** Mirrors the form (title, four fields, button) so the page does not jump when it loads. */
export default function Loading() {
  return (
    <div role="status" aria-live="polite" className="space-y-4">
      <span className="sr-only">Đang tải Mô phỏng…</span>
      <Skeleton className="h-8 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <div className="space-y-3 rounded-card border border-outline-variant p-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-11 w-40" />
      </div>
    </div>
  );
}
