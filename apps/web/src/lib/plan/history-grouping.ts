/**
 * Month-grouping helper for the /app/plan/history page.
 *
 * Buckets blocks by the calendar month of their `startedOn` date so
 * the history surface renders sticky "April 2026", "March 2026" etc.
 * group headers. Pure helper — no DOM, no I/O — sits in its own file
 * so unit tests don't have to import the server page module.
 */
import type { BlockWithCompletionStats } from "@/lib/planner/queries";

export type HistoryMonthGroup = {
  /** Stable key, e.g. "2026-04" or "unknown". */
  key: string;
  /** Display label, e.g. "April 2026". */
  label: string;
  blocks: BlockWithCompletionStats[];
};

export function groupBlocksByMonth(
  blocks: BlockWithCompletionStats[],
  locale?: string,
): HistoryMonthGroup[] {
  const groups = new Map<string, { label: string; blocks: BlockWithCompletionStats[] }>();
  const order: string[] = [];
  for (const b of blocks) {
    const iso = b.startedOn ?? "";
    const d = iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso) : null;
    let key: string;
    let label: string;
    if (d && !Number.isNaN(d.getTime())) {
      key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      label = d.toLocaleDateString(locale, { month: "long", year: "numeric" });
    } else {
      key = "unknown";
      label = "Undated";
    }
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = { label, blocks: [] };
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.blocks.push(b);
  }
  return order.map((key) => ({ key, ...groups.get(key)! }));
}
