/**
 * Archetype library + planned-session generator.
 *
 * An archetype is the shape of a block — what role each day plays. The
 * concrete prescription (kg/reps for strength; minutes / HR cap for cardio)
 * is computed at generation time from the user's training maxes and the
 * archetype's per-week intensity profile.
 *
 * v2 ships two archetypes: Strength Anchor (4 main lifts + 2 polarized
 * cardio days) and Endurance Anchor (cardio-led with strength maintenance).
 */

import type { PrescriptionItem, PrescriptionItemKind } from "@hta/db";

export type ArchetypeId = "strength_anchor" | "endurance_anchor";

export type WeekProfile = {
  weekIndex: number;
  /** Per-set %TM. Strength wave; ignored for cardio days unless explicitly used. */
  setIntensities: number[];
  setReps: number | number[];
  intensityLabel: string;
  /** Strength volume scaler — applied to strength day prescription. 1.0 = normal, <1 = lighter. */
  strengthVolumeScale?: number;
  /** Optional duration override (min) for the default Z2 day this week. Deload weeks may shorten. */
  z2DurationMinOverride?: number;
};

export type StrengthDay = {
  kind: "strength";
  dayIndex: number;
  role: string;
  title: string;
  movementSlug: string;
};

export type CardioDay = {
  kind: "cardio";
  dayIndex: number;
  role: string;
  title: string;
  movementSlug: string;
  cardioKind: Extract<PrescriptionItemKind, `cardio_${string}`>;
  durationMin: number;
  hrCap?: string;
  protocolNote?: string;
  finisher?: {
    movementSlug: string;
    durationMin: number;
    protocolNote: string;
  };
};

export type DayTemplate = StrengthDay | CardioDay;

export type Archetype = {
  id: ArchetypeId;
  name: string;
  oneLiner: string;
  weeks: number;
  days: DayTemplate[];
  weekProfiles: WeekProfile[];
};

export const STRENGTH_ANCHOR: Archetype = {
  id: "strength_anchor",
  name: "Strength Anchor",
  oneLiner:
    "Strength-led concurrent training. Four main lifts hit a weekly intensity wave with a deload at week 4. Two polarized cardio days (easy Z2 + long Z2 with alactic finisher) preserve aerobic base without competing with strength.",
  weeks: 4,
  days: [
    { kind: "strength", dayIndex: 0, role: "heavy_squat", title: "Squat day", movementSlug: "back_squat" },
    { kind: "strength", dayIndex: 1, role: "heavy_bench", title: "Bench day", movementSlug: "bench_press" },
    {
      kind: "cardio",
      dayIndex: 2,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
    },
    { kind: "strength", dayIndex: 3, role: "heavy_deadlift", title: "Deadlift day", movementSlug: "conventional_deadlift" },
    { kind: "strength", dayIndex: 4, role: "heavy_press", title: "Overhead press day", movementSlug: "overhead_press" },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "long_z2_plus_alactic",
      title: "Long Z2 + alactic finisher",
      movementSlug: "run-long-z2",
      cardioKind: "cardio_z2",
      durationMin: 75,
      hrCap: "≤ 70% HRR, conversational",
      finisher: {
        movementSlug: "run-hill-sprints",
        durationMin: 10,
        protocolNote: "6–10 × 10–15s near-max, walk-down recovery",
      },
    },
  ],
  weekProfiles: [
    { weekIndex: 0, setIntensities: [0.65, 0.75, 0.85], setReps: 5, intensityLabel: "5s wave" },
    { weekIndex: 1, setIntensities: [0.70, 0.80, 0.90], setReps: 3, intensityLabel: "3s wave" },
    { weekIndex: 2, setIntensities: [0.75, 0.85, 0.95], setReps: [5, 3, 1], intensityLabel: "5/3/1 peak" },
    {
      weekIndex: 3,
      setIntensities: [0.40, 0.50, 0.60],
      setReps: 5,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.5,
      z2DurationMinOverride: 30,
    },
  ],
};

export const ENDURANCE_ANCHOR: Archetype = {
  id: "endurance_anchor",
  name: "Endurance Anchor",
  oneLiner:
    "Cardio-led concurrent training. Five aerobic exposures per week (polarized 80/20: easy Z2 + 1× VO2 intervals), two strength maintenance days using heavy low-volume work to keep strength from drifting.",
  weeks: 4,
  days: [
    {
      kind: "cardio",
      dayIndex: 0,
      role: "easy_z2",
      title: "Easy Z2",
      movementSlug: "run-easy-z2",
      cardioKind: "cardio_z2",
      durationMin: 60,
      hrCap: "≤ 70% HRR, conversational",
    },
    { kind: "strength", dayIndex: 1, role: "maintain_squat", title: "Squat maintenance", movementSlug: "back_squat" },
    {
      kind: "cardio",
      dayIndex: 2,
      role: "z2_plus_alactic",
      title: "Z2 + alactic finisher",
      movementSlug: "bike-indoor-z2",
      cardioKind: "cardio_z2",
      durationMin: 45,
      hrCap: "≤ 70% HRR, conversational",
      finisher: {
        movementSlug: "bike-indoor-sprints",
        durationMin: 10,
        protocolNote: "6–8 × 10–15s near-max, 1:10 rest",
      },
    },
    { kind: "strength", dayIndex: 3, role: "maintain_deadlift", title: "Deadlift maintenance", movementSlug: "conventional_deadlift" },
    {
      kind: "cardio",
      dayIndex: 4,
      role: "vo2_intervals",
      title: "VO2 intervals",
      movementSlug: "run-vo2-4x4",
      cardioKind: "cardio_vo2",
      durationMin: 35,
      hrCap: "90–95% HRmax during work",
      protocolNote: "4 × 4 min @ 90–95% HRmax, 3 min easy recovery",
    },
    {
      kind: "cardio",
      dayIndex: 5,
      role: "long_z2",
      title: "Long Z2",
      movementSlug: "run-long-z2",
      cardioKind: "cardio_z2",
      durationMin: 100,
      hrCap: "≤ 70% HRR, conversational",
    },
  ],
  weekProfiles: [
    {
      weekIndex: 0,
      setIntensities: [0.75, 0.85, 0.90],
      setReps: [5, 3, 3],
      intensityLabel: "Maintenance base",
    },
    {
      weekIndex: 1,
      setIntensities: [0.75, 0.85, 0.90],
      setReps: [5, 3, 3],
      intensityLabel: "Maintenance build",
    },
    {
      weekIndex: 2,
      setIntensities: [0.80, 0.85, 0.90],
      setReps: [3, 3, 3],
      intensityLabel: "Maintenance peak",
    },
    {
      weekIndex: 3,
      setIntensities: [0.50, 0.60, 0.70],
      setReps: 5,
      intensityLabel: "Deload",
      strengthVolumeScale: 0.5,
      z2DurationMinOverride: 30,
    },
  ],
};

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  strength_anchor: STRENGTH_ANCHOR,
  endurance_anchor: ENDURANCE_ANCHOR,
};

export function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

export function requiredLiftSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  for (const d of archetype.days) {
    if (d.kind === "strength") set.add(d.movementSlug);
  }
  return Array.from(set);
}

export function requiredCardioSlugs(archetype: Archetype): string[] {
  const set = new Set<string>();
  for (const d of archetype.days) {
    if (d.kind === "cardio") {
      set.add(d.movementSlug);
      if (d.finisher) set.add(d.finisher.movementSlug);
    }
  }
  return Array.from(set);
}

export function buildPrescription(
  archetype: Archetype,
  weekIndex: number,
  day: DayTemplate,
  movement: { id: string; slug: string; displayName: string },
  finisherMovement?: { id: string; slug: string; displayName: string },
): PrescriptionItem[] {
  const profile = archetype.weekProfiles.find((w) => w.weekIndex === weekIndex);
  if (!profile) return [];

  if (day.kind === "strength") {
    const items: PrescriptionItem[] = profile.setIntensities.map((pct, i) => {
      const reps = Array.isArray(profile.setReps) ? profile.setReps[i] ?? 5 : profile.setReps;
      return {
        movementId: movement.id,
        movementSlug: movement.slug,
        movementName: movement.displayName,
        kind: "main",
        sets: 1,
        reps,
        percentTm: Math.round(pct * 100),
        intensityLabel: `${Math.round(pct * 100)}% TM`,
        notes: i === profile.setIntensities.length - 1 ? "top set" : undefined,
      };
    });
    if (profile.strengthVolumeScale != null && profile.strengthVolumeScale < 1) {
      const keep = Math.max(1, Math.round(items.length * profile.strengthVolumeScale));
      return items.slice(0, keep);
    }
    return items;
  }

  // Cardio day.
  const durationMin = profile.z2DurationMinOverride ?? day.durationMin;
  const items: PrescriptionItem[] = [
    {
      movementId: movement.id,
      movementSlug: movement.slug,
      movementName: movement.displayName,
      kind: day.cardioKind,
      durationMin,
      hrCap: day.hrCap,
      protocolNote: day.protocolNote,
      intensityLabel:
        day.cardioKind === "cardio_z2"
          ? "Easy Z2"
          : day.cardioKind === "cardio_vo2"
            ? "VO2"
            : day.cardioKind === "cardio_alactic"
              ? "Alactic"
              : "Threshold",
    },
  ];
  if (day.finisher && finisherMovement) {
    items.push({
      movementId: finisherMovement.id,
      movementSlug: finisherMovement.slug,
      movementName: finisherMovement.displayName,
      kind: "cardio_alactic",
      durationMin: day.finisher.durationMin,
      protocolNote: day.finisher.protocolNote,
      intensityLabel: "Alactic finisher",
    });
  }
  return items;
}

export function formatPrescriptionItem(item: PrescriptionItem, tmKg?: number): string {
  if (item.kind.startsWith("cardio_")) {
    const parts: string[] = [];
    if (item.durationMin != null) parts.push(`${item.durationMin} min`);
    if (item.protocolNote) parts.push(item.protocolNote);
    else if (item.hrCap) parts.push(item.hrCap);
    return parts.join(" · ") || "cardio";
  }
  const weight =
    item.percentTm != null && tmKg
      ? `${roundToPlate(tmKg * (item.percentTm / 100))} kg`
      : null;
  const intensity = item.intensityLabel ?? (item.percentTm ? `${item.percentTm}% TM` : null);
  const reps = item.reps != null ? `× ${item.reps}` : "";
  if (weight && intensity) return `${weight} (${intensity}) ${reps}`.trim();
  if (weight) return `${weight} ${reps}`.trim();
  if (intensity) return `${intensity} ${reps}`.trim();
  return reps;
}

export function summarisePrescription(items: PrescriptionItem[]): string {
  if (items.length === 0) return "";
  const cardio = items.filter((i) => i.kind.startsWith("cardio_"));
  if (cardio.length > 0 && cardio.length === items.length) {
    const totalMin = cardio.reduce((a, i) => a + (i.durationMin ?? 0), 0);
    const labels = Array.from(new Set(cardio.map((i) => i.intensityLabel ?? "cardio")));
    return `${totalMin} min · ${labels.join(" + ")}`;
  }
  const pcts = items.filter((i) => i.percentTm != null).map((i) => i.percentTm!);
  if (pcts.length > 0) {
    return `${pcts.length} sets · ${pcts.join("/")}% TM`;
  }
  return `${items.length} items`;
}
