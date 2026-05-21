/**
 * Detect 5/3/1 AMRAP main-lift items in a planned-session prescription.
 *
 * The curated archetypes mark their AMRAP set by storing the rep target
 * as a string suffixed with "+" (e.g. "5+", "3+", "1+") OR as a number
 * in the canonical wave (5, 3, 1 with intensityLabel "5/3/1 peak").
 *
 * Custom blocks without explicit AMRAP markers do NOT trigger AMRAP-driven
 * bumps — they fall back to the block-complete trigger (a gentler default
 * progression).
 */
import type { Prescription, PrescriptionItem } from "@hta/db";

export type AmrapTarget = 5 | 3 | 1;

export type AmrapInfo = {
  /** The AMRAP target reps (5+, 3+, or 1+). */
  target: AmrapTarget;
  /** Wave week (0-indexed). Week 2 = "Wk3" in user-facing 5/3/1 vocabulary. */
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
 *  - reps as the canonical (5, 3, 1) trio with the right intensity label
 *  - the "5/3/1 peak" wave's top set specifically (reps array [5, 3, 1])
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

  // Strategy 2: the canonical 5/3/1 peak wave — top set has reps [5,3,1].
  // The runtime emits these as separate prescription items (one per setIntensity),
  // so we look for an item with reps = 1 + a "5/3/1 peak" intensityLabel.
  for (const item of prescription.items) {
    if (item.kind !== "main") continue;
    if (item.reps === 1 && item.intensityLabel?.includes("5/3/1")) {
      return { target: 1, weekIndex, item };
    }
    // Same wave at Wk1 (5s wave) and Wk2 (3s wave) carries an AMRAP on the
    // top set; the planner just stores the rep target without the "+".
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
 * Wendler's canonical AMRAP signal: the Wk3 (1+) set is the most reliable
 * progression cue. Helpers to identify which week index in a block IS Wk3.
 */
export function isWk3(weekIndex: number): boolean {
  // 5/3/1 blocks ship 4 weeks (0..3): Wk1=5s, Wk2=3s, Wk3=peak, Wk4=deload.
  return weekIndex === 2;
}

/** AMRAP-detection signal types used by the bump gate. */
export type AmrapPerformance = {
  /** Reps actually performed. */
  reps: number;
  /** Target the prescription called for (5+, 3+, 1+). */
  target: AmrapTarget;
  /** Was this the Wk3 (1+) set? */
  isWk3: boolean;
  /** Was this the Wk1 / Wk2 set? */
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
    isWk3: isWk3(weekIndex),
    isEarlyWeek: weekIndex === 0 || weekIndex === 1,
  };
}
