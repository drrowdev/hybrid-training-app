/**
 * Recap-row grouping for a completed movement card.
 *
 * Takes the logged set rows + the movement's prescription items and
 * collapses them into a small set of human-readable lines, bucketed
 * by set kind. The card body uses this when it auto-collapses after
 * the last prescribed slot is covered.
 */
import type { PrescriptionItem } from "@hta/db";
import type { FocusLoggedSet } from "@/components/session/MovementFocusView";

export type RecapBucketKey = "warmup" | "main" | "back_off" | "accessory" | "tendon";

export type RecapLine = {
  /** One of the strength buckets, or `"skipped"` for the skip aggregation row. */
  kind: RecapBucketKey | "skipped";
  /** Already-formatted one-line summary; the caller renders it verbatim. */
  text: string;
};

type WorkSet = { weightKg: number; reps: number };
type CarryWorkSet = { weightKg: number; distanceM: number };

const BUCKET_LABEL: Record<RecapBucketKey, string> = {
  warmup: "Warm-ups",
  main: "Working",
  back_off: "Volume",
  accessory: "Accessory",
  tendon: "Tendon",
};

// `power_potentiation` lives next to the main work in the recap.
function resolveBucket(kind: string | undefined): RecapBucketKey | null {
  if (!kind) return null;
  if (kind === "power_potentiation") return "main";
  if (
    kind === "warmup" ||
    kind === "main" ||
    kind === "back_off" ||
    kind === "accessory" ||
    kind === "tendon"
  ) {
    return kind;
  }
  return null;
}

function formatWeight(kg: number): string {
  return Number.isInteger(kg) ? `${kg}` : `${kg}`;
}

function formatRange(min: number, max: number): string {
  if (Math.abs(max - min) < 0.001) return `${formatWeight(min)} kg`;
  return `${formatWeight(min)} – ${formatWeight(max)} kg`;
}

function summariseBucket(bucket: RecapBucketKey, sets: WorkSet[]): string {
  const label = BUCKET_LABEL[bucket];
  if (sets.length === 0) return label;

  const weights = sets.map((s) => s.weightKg);
  const reps = sets.map((s) => s.reps);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const sameReps = reps.every((r) => r === reps[0]);
  const sameWeight = Math.abs(maxW - minW) < 0.001;

  if (bucket === "warmup") {
    // Warm-ups: range across an arbitrary slope, e.g. `Warm-ups · 4 sets · 40 – 60 kg`.
    return `${label} · ${sets.length} set${sets.length === 1 ? "" : "s"} · ${formatRange(minW, maxW)}`;
  }

  if (sameReps && sameWeight) {
    return `${label} · ${sets.length}×${reps[0]} @ ${formatWeight(minW)} kg`;
  }
  if (sameReps) {
    return `${label} · ${sets.length}×${reps[0]} @ ${formatRange(minW, maxW)}`;
  }
  // Mixed reps — show the rep list (e.g. `5/5/3 @ 80 kg`).
  return `${label} · ${reps.join("/")} @ ${formatRange(minW, maxW)}`;
}

/**
 * Carry recap formatter. Loaded carries are logged as distance + weight
 * (never reps), so they need their own summariser. Output examples:
 *   "Accessory · 2×30m @ 24 kg"      (uniform)
 *   "Accessory · 30/40m @ 24 kg"     (varying distance)
 *   "Accessory · 2×30m @ 22 – 26 kg" (varying load)
 */
function summariseCarryBucket(
  bucket: RecapBucketKey,
  sets: CarryWorkSet[],
): string {
  const label = BUCKET_LABEL[bucket];
  if (sets.length === 0) return label;
  const weights = sets.map((s) => s.weightKg);
  const dists = sets.map((s) => s.distanceM);
  const minW = Math.min(...weights);
  const maxW = Math.max(...weights);
  const sameDist = dists.every((d) => d === dists[0]);
  const sameWeight = Math.abs(maxW - minW) < 0.001;
  if (sameDist && sameWeight) {
    return `${label} · ${sets.length}×${dists[0]}m @ ${formatWeight(minW)} kg`;
  }
  if (sameDist) {
    return `${label} · ${sets.length}×${dists[0]}m @ ${formatRange(minW, maxW)}`;
  }
  return `${label} · ${dists.join("/")}m @ ${formatRange(minW, maxW)}`;
}

export function buildMovementRecap(
  items: PrescriptionItem[],
  loggedSets: FocusLoggedSet[],
): RecapLine[] {
  // First, partition logged sets into (working, skipped).
  const skipped = loggedSets.filter((s) => s.skipped);

  // We need a per-logged-set kind. The canonical join is via the
  // prescription_item_index that the focus view writes when saving;
  // here we don't have that mapping handed in. Fall back to lining
  // up sets with items in their stored order (the focus view always
  // writes sets in cursor order) but only when the counts make sense.
  const byBucket: Record<RecapBucketKey, WorkSet[]> = {
    warmup: [],
    main: [],
    back_off: [],
    accessory: [],
    tendon: [],
  };
  const carryByBucket: Record<RecapBucketKey, CarryWorkSet[]> = {
    warmup: [],
    main: [],
    back_off: [],
    accessory: [],
    tendon: [],
  };
  // Pair each logged set with the prescription item at the same index
  // (skip placeholders for skipped sets so the indexing stays aligned
  // even when some slots were skipped).
  const allLoggedInOrder = loggedSets.slice();
  for (let i = 0; i < allLoggedInOrder.length; i++) {
    const s = allLoggedInOrder[i]!;
    if (s.skipped) continue;
    const item = items[i];
    const bucket = resolveBucket(item?.kind) ?? "main";
    // Loaded carry — `distance_m > 0` is the canonical signal; the
    // focus view writes `reps: 0` for carries so the standard branch
    // would otherwise drop the row.
    if (s.distanceM != null && s.distanceM > 0) {
      carryByBucket[bucket].push({
        weightKg: s.weightKg ?? 0,
        distanceM: s.distanceM,
      });
      continue;
    }
    if (s.weightKg == null || s.reps == null || s.reps <= 0) continue;
    byBucket[bucket].push({ weightKg: s.weightKg, reps: s.reps });
  }

  const lines: RecapLine[] = [];
  (Object.keys(byBucket) as RecapBucketKey[]).forEach((k) => {
    if (byBucket[k].length > 0) {
      lines.push({ kind: k, text: summariseBucket(k, byBucket[k]) });
    }
    if (carryByBucket[k].length > 0) {
      lines.push({ kind: k, text: summariseCarryBucket(k, carryByBucket[k]) });
    }
  });

  if (skipped.length > 0) {
    const reasons = Array.from(
      new Set(
        skipped
          .map((s) => s.skipReason)
          .filter((r): r is NonNullable<typeof r> => Boolean(r)),
      ),
    );
    const tail = reasons.length > 0 ? ` (${reasons.join(", ")})` : "";
    lines.push({
      kind: "skipped",
      text: `${skipped.length} skipped${tail}`,
    });
  }

  return lines;
}
