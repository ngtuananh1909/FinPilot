import { EmptyState } from "./EmptyState";

export function PlaceholderPage({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold text-on-surface">{title}</h1>
      <EmptyState title="Đang xây dựng" description={description} />
    </div>
  );
}
