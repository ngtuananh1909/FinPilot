export interface DatedItem {
  id: string;
  localDate: string;
}
export interface DayGroup<T extends DatedItem> {
  localDate: string;
  items: T[];
}
/**
 * Groups items (already ordered newest first by the API) into consecutive local-date buckets.
 * Duplicate ids (a "load more" page overlapping after a concurrent insert) are dropped.
 */
export function groupByLocalDate<T extends DatedItem>(items: readonly T[]): DayGroup<T>[] {
  const groups: DayGroup<T>[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id)) continue;
    seen.add(item.id);
    const last = groups[groups.length - 1];
    if (last && last.localDate === item.localDate) last.items.push(item);
    else groups.push({ localDate: item.localDate, items: [item] });
  }
  return groups;
}
