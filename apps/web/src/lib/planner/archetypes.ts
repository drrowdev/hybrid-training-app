/**
 * Archetype library + planned-session generator.
 *
 * An archetype is the shape of a block — what role each day plays. The
 * concrete prescription (kg/reps) is computed at generation time from the
 * user's training maxes and the archetype's per-week intensity profile.
 *
 * v1 ships ONE archetype (Strength Anchor) to validate the pipeline. More
 * archetypes (Hypertrophy Anchor, Endurance Anchor, …) plug in by adding a
 * new entry to ARCHETYPES — no other code changes.
 */

import type { PrescriptionItem } from "@hta/db";

export type ArchetypeId = "strength_anchor";

export type WeekProfile = {
  /** 0-based week index within the block. */
  weekIndex: number;
  /** Per-set %TM (length = sets), reps applied uniformly OR per-set rep targets. */
  setIntensities: number[];
  setReps: number | number[];
  intensityLabel: string;
};

export type DayTemplate = {
  /** 0=Mon .. 6=Sun. */
  dayIndex: number;
  /** Stable role identifier, e.g. "heavy_squat". */
  role: string;
  /** Human title shown in UI. */
  title: string;
  /** Slug of the main lift required. The user must have a TM set for this. */
  movementSlug: string;
};

export type Archetype = {
  id: ArchetypeId;
  name: string;
  oneLiner: string;
  weeks: number;
  /** One entry per movement day. Rest days are absence of entries for that day_index. */
  days: DayTemplate[];
  weekProfiles: WeekProfile[];
};

export const STRENGTH_ANCHOR: Archetype = {
  id: "strength_anchor",
  name: "Strength Anchor",
  oneLiner:
    "Four-week strength wave on the canonical four. One main lift per session, three working sets, weekly intensity wave with a deload at week 4.",
  weeks: 4,
  days: [
    { dayIndex: 0, role: "heavy_squat", title: "Squat day", movementSlug: "back_squat" },
    { dayIndex: 1, role: "heavy_bench", title: "Bench day", movementSlug: "bench_press" },
    { dayIndex: 3, role: "heavy_deadlift", title: "Deadlift day", movementSlug: "conventional_deadlift" },
    { dayIndex: 4, role: "heavy_press", title: "Overhead press day", movementSlug: "overhead_press" },
  ],
  weekProfiles: [
    { weekIndex: 0, setIntensities: [0.65, 0.75, 0.85], setReps: 5, intensityLabel: "5s wave" },
    { weekIndex: 1, setIntensities: [0.70, 0.80, 0.90], setReps: 3, intensityLabel: "3s wave" },
    { weekIndex: 2, setIntensities: [0.75, 0.85, 0.95], setReps: [5, 3, 1], intensityLabel: "5/3/1 peak" },
    { weekIndex: 3, setIntensities: [0.40, 0.50, 0.60], setReps: 5, intensityLabel: "Deload" },
  ],
};

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  strength_anchor: STRENGTH_ANCHOR,
};

/**
 * Round to the nearest 2.5 kg (default plate increment for barbells).
 */
export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

/**
 * Build the prescription items for a single planned session.
 */
export function buildPrescription(
  archetype: Archetype,
  weekIndex: number,
  dayTemplate: DayTemplate,
  movement: { id: string; slug: string; displayName: string },
  _tmKg: number,
): PrescriptionItem[] {
  const profile = archetype.weekProfiles.find((w) => w.weekIndex === weekIndex);
  if (!profile) return [];

  return profile.setIntensities.map((pct, i) => {
    const reps = Array.isArray(profile.setReps) ? profile.setReps[i] ?? 5 : profile.setReps;
    return {
      movementId: movement.id,
      movementSlug: movement.slug,
      movementName: movement.displayName,
      sets: 1,
      reps,
      percentTm: Math.round(pct * 100),
      intensityLabel: `${Math.round(pct * 100)}% TM`,
      kind: "main",
      notes: i === profile.setIntensities.length - 1 ? "top set" : undefined,
    };
  });
}

/**
 * Display string for a prescription item — used in plan/today cards.
 */
export function formatPrescriptionItem(
  item: PrescriptionItem,
  tmKg?: number,
): string {
  const weight =
    item.percentTm != null && tmKg
      ? `${roundToPlate(tmKg * (item.percentTm / 100))} kg`
      : null;
  const intensity = item.intensityLabel ?? (item.percentTm ? `${item.percentTm}% TM` : null);
  if (weight && intensity) return `${weight} (${intensity}) × ${item.reps}`;
  if (weight) return `${weight} × ${item.reps}`;
  if (intensity) return `${intensity} × ${item.reps}`;
  return `${item.sets}×${item.reps}`;
}

/**
 * Aggregate a full prescription's sets as a one-liner ("3 sets · 65/75/85% TM").
 */
export function summarisePrescription(items: PrescriptionItem[]): string {
  if (items.length === 0) return "";
  const pcts = items.filter((i) => i.percentTm != null).map((i) => i.percentTm!);
  if (pcts.length > 0) {
    return `${items.length} sets · ${pcts.join("/")}% TM`;
  }
  return `${items.length} sets`;
}
