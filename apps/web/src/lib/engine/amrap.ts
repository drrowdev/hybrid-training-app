/**
 * Detect open-rep main-lift AMRAP items in a planned-session prescription.
 *
 * The curated archetypes mark their open-rep top set by storing the rep
 * target as a string suffixed with "+" (e.g. "5+", "3+", "1+") OR as a
 * single rep on a "Heavy peak" wave's top set.
 *
 * Custom blocks without explicit open-rep markers do NOT trigger
 * AMRAP-driven bumps — they fall back to the block-complete trigger
 * (a gentler default progression).
 *
 * AMRAP (As Many Reps As Possible) on a top set is a generally-proven
 * autoregulation technique used in research-backed programming
 * (Helms 2018; Zourdos 2016; Schoenfeld 2017 — repetitions-in-reserve
 * literature). The "+" suffix convention is widely shared across
 * powerlifting strength templates.
 */
import type { Prescription, PrescriptionItem } from "@hta/db";

export type AmrapTarget = 5 | 3 | 1;

export type AmrapInfo = {
  /** The AMRAP target reps (5+, 3+, or 1+). */
  target: AmrapTarget;
  /** Zero-indexed wave week. Week 2 = the heavy / peaking week in a 4-week wave. */
  weekIndex: number;
  /** The prescription item that carries the AMRAP. */
  item: PrescriptionItem;
};

/**
 * Inspect a prescription + week index and return the AMRAP info if one
 * exists. Returns null when the day is not an AMRAP day.
 *
 * Recognises:
 *  - reps as a string ending in "+" ("5+", "3+", "1+")
 *  - reps = 1 on a top set tagged as the heavy peak (intensityLabel match)
 *  - the curated peaking wave's top set specifically (reps array [5, 3, 1])
 */
export function detectAmrap(
  prescription: Prescription,
  weekIndex: number,
): AmrapInfo | null {
  if (!prescription?.items?.length) return null;

  // Strategy 1: any main item whose reps is a string ending in "+".
  for (const item of prescription.items) {
    if (item.kind !== "main") continue;
    const target = parseAmrapReps(item.reps);
    if (target != null) {
      return { target, weekIndex, item };
    }
  }

  // Strategy 2: a top set with reps = 1 and a "peak" / "peaking" label.
  for (const item of prescription.items) {
    if (item.kind !== "main") continue;
    const label = item.intensityLabel?.toLowerCase() ?? "";
    if (item.reps === 1 && (label.includes("peak") || label.includes("heavy single"))) {
      return { target: 1, weekIndex, item };
    }
    // Top set detection — first/middle weeks of the peaking wave carry an
    // implicit AMRAP on the top set when the runtime emits reps as 5 or 3.
    if (item.notes?.toLowerCase() === "top set" && typeof item.reps === "number") {
      if (item.reps === 5 || item.reps === 3 || item.reps === 1) {
        return { target: item.reps as AmrapTarget, weekIndex, item };
      }
    }
  }

  return null;
}

/** Parse "5+", "3+", "1+" reps strings. Returns null when not an AMRAP marker. */
function parseAmrapReps(reps: unknown): AmrapTarget | null {
  if (typeof reps !== "string") return null;
  const m = reps.match(/^(\d+)\+$/);
  if (!m) return null;
  const n = Number(m[1]);
  if (n === 5 || n === 3 || n === 1) return n as AmrapTarget;
  return null;
}

/**
 * Heavy-week heuristic: in a 4-week peaking wave (early / middle / heavy / deload),
 * the heavy week's open-rep top set carries the strongest progression signal.
 */
export function isHeavyWeek(weekIndex: number): boolean {
  return weekIndex === 2;
}

/** AMRAP-detection signal types used by the bump gate. */
export type AmrapPerformance = {
  /** Reps actually performed. */
  reps: number;
  /** Target the prescription called for (5+, 3+, 1+). */
  target: AmrapTarget;
  /** Was this the heavy-week peaking top set? */
  isHeavyWeek: boolean;
  /** Was this the early-wave (first or middle week) top set? */
  isEarlyWeek: boolean;
};

export function summariseAmrap(
  performed: number,
  target: AmrapTarget,
  weekIndex: number,
): AmrapPerformance {
  return {
    reps: performed,
    target,
    isHeavyWeek: isHeavyWeek(weekIndex),
    isEarlyWeek: weekIndex === 0 || weekIndex === 1,
  };
}
