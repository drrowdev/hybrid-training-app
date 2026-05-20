/**
 * Custom-block builder model + wave templates + compiler.
 *
 * Goal: let the user assemble an Archetype day-by-day from a small palette
 * of building blocks, pick an intensity wave from a curated list, hit submit.
 * Output flows through the SAME buildPrescription pipeline as curated
 * archetypes — no parallel code path.
 *
 * v1 constraints: 4-week block, deload always at week 4, daysPerWeek
 * derived from the count of non-rest days, single strength wave applied
 * across all strength days.
 */
import type {
  Archetype,
  ArchetypeId,
  CardioDay,
  DayTemplate,
  StrengthDay,
  StrengthRole,
  TendonDay,
  WeekProfile,
} from "./archetypes";
import { STRENGTH_ROLE_CANDIDATES, STRENGTH_ROLE_LABELS } from "./archetypes";

/** What the user can place in each day slot of the custom builder. */
export type CustomDayKind =
  | "rest"
  | "strength_squat"
  | "strength_horizontal_press"
  | "strength_deadlift"
  | "strength_vertical_press"
  | "cardio_z2_short"
  | "cardio_z2_long"
  | "cardio_z2_long_plus_alactic"
  | "cardio_vo2"
  | "cardio_alactic"
  | "tendon_hsr_knee"
  | "tendon_hsr_hinge";

export type CustomDayInput = {
  /** 0=Mon .. 6=Sun */
  dayIndex: number;
  kind: CustomDayKind;
};

export type WaveTemplateId = "fives" | "threes" | "five_three_one" | "hypertrophy" | "maintenance" | "rebuild_flat";

export type CustomArchetypeInput = {
  /** Optional user-supplied block name; falls back to "Custom block". */
  name?: string;
  /** 3–6 weeks; always includes a final deload week. */
  weeks: number;
  startedOn: string;
  daysPerWeek: number;
  waveTemplate: WaveTemplateId;
  days: CustomDayInput[];
};

// ─── Wave template library ─────────────────────────────────────────
// Each template is a 4-week shape. For < 4 week blocks we drop the
// earliest weeks; for > 4 we extend the build phase.

const FIVES_WAVE: WeekProfile[] = [
  { weekIndex: 0, setIntensities: [0.65, 0.75, 0.85], setReps: 5, intensityLabel: "5s wave" },
  { weekIndex: 1, setIntensities: [0.70, 0.80, 0.85], setReps: 5, intensityLabel: "5s build" },
  { weekIndex: 2, setIntensities: [0.70, 0.80, 0.90], setReps: 5, intensityLabel: "5s peak" },
  {
    weekIndex: 3,
    setIntensities: [0.40, 0.50, 0.60],
    setReps: 5,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.5,
    z2DurationMinOverride: 30,
  },
];

const THREES_WAVE: WeekProfile[] = [
  { weekIndex: 0, setIntensities: [0.70, 0.80, 0.90], setReps: 3, intensityLabel: "3s wave" },
  { weekIndex: 1, setIntensities: [0.75, 0.85, 0.90], setReps: 3, intensityLabel: "3s build" },
  { weekIndex: 2, setIntensities: [0.75, 0.85, 0.95], setReps: 3, intensityLabel: "3s peak" },
  {
    weekIndex: 3,
    setIntensities: [0.40, 0.50, 0.60],
    setReps: 5,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.5,
    z2DurationMinOverride: 30,
  },
];

const FIVE_THREE_ONE_WAVE: WeekProfile[] = [
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
];

const HYPERTROPHY_WAVE: WeekProfile[] = [
  { weekIndex: 0, setIntensities: [0.60, 0.65, 0.70, 0.70], setReps: [10, 10, 8, 8], intensityLabel: "Volume base" },
  { weekIndex: 1, setIntensities: [0.60, 0.65, 0.70, 0.75], setReps: [10, 10, 8, 8], intensityLabel: "Volume build" },
  { weekIndex: 2, setIntensities: [0.65, 0.70, 0.75, 0.75], setReps: [10, 8, 8, 6], intensityLabel: "Volume peak" },
  {
    weekIndex: 3,
    setIntensities: [0.50, 0.60, 0.65],
    setReps: 8,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.75,
    z2DurationMinOverride: 25,
  },
];

const MAINTENANCE_WAVE: WeekProfile[] = [
  { weekIndex: 0, setIntensities: [0.75, 0.85, 0.90], setReps: [5, 3, 3], intensityLabel: "Maintenance base" },
  { weekIndex: 1, setIntensities: [0.75, 0.85, 0.90], setReps: [5, 3, 3], intensityLabel: "Maintenance build" },
  { weekIndex: 2, setIntensities: [0.80, 0.85, 0.90], setReps: [3, 3, 3], intensityLabel: "Maintenance peak" },
  {
    weekIndex: 3,
    setIntensities: [0.50, 0.60, 0.70],
    setReps: 5,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.5,
    z2DurationMinOverride: 30,
  },
];

const REBUILD_FLAT_WAVE: WeekProfile[] = [
  { weekIndex: 0, setIntensities: [0.60, 0.65, 0.70], setReps: 5, intensityLabel: "Reload" },
  { weekIndex: 1, setIntensities: [0.65, 0.70, 0.75], setReps: 5, intensityLabel: "Build" },
  { weekIndex: 2, setIntensities: [0.65, 0.75, 0.80], setReps: 5, intensityLabel: "Consolidate" },
  {
    weekIndex: 3,
    setIntensities: [0.50, 0.55, 0.60],
    setReps: 5,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.66,
    z2DurationMinOverride: 25,
  },
];

export const WAVE_TEMPLATES: Record<
  WaveTemplateId,
  { id: WaveTemplateId; name: string; description: string; weeks: WeekProfile[] }
> = {
  fives: {
    id: "fives",
    name: "5s wave",
    description: "Three weeks of 5s building toward a top set near 90% TM, then deload. Sustainable; high volume per session.",
    weeks: FIVES_WAVE,
  },
  threes: {
    id: "threes",
    name: "3s wave",
    description: "Heavier weekly progression peaking near 95% TM with 3s. More CNS cost than 5s; classic strength block.",
    weeks: THREES_WAVE,
  },
  five_three_one: {
    id: "five_three_one",
    name: "5 / 3 / 1 peak",
    description: "Strength Anchor's wave — 5s → 3s → 5/3/1 peak with top single. Best for short focused strength blocks.",
    weeks: FIVE_THREE_ONE_WAVE,
  },
  hypertrophy: {
    id: "hypertrophy",
    name: "Hypertrophy",
    description: "4 working sets per pattern at 60–75% TM, 6–10 reps. Volume + moderate intensity for muscle building.",
    weeks: HYPERTROPHY_WAVE,
  },
  maintenance: {
    id: "maintenance",
    name: "Maintenance",
    description: "Endurance Anchor's wave — heavy low-volume work to hold strength while cardio leads. Top set at the Bickel ≥85% 1RM floor.",
    weeks: MAINTENANCE_WAVE,
  },
  rebuild_flat: {
    id: "rebuild_flat",
    name: "Rebuild (flat)",
    description: "Rebuild's wave — capped intensity (top set ≤80% TM), no peak. For coming back from injury or layoff.",
    weeks: REBUILD_FLAT_WAVE,
  },
};

// ─── Day kind → label mapping for the UI ───────────────────────────

export const CUSTOM_DAY_OPTIONS: { value: CustomDayKind; label: string; group: string }[] = [
  { value: "rest", label: "Rest", group: "—" },
  { value: "strength_squat", label: "Squat (your variant)", group: "Strength" },
  { value: "strength_horizontal_press", label: "Bench (your variant)", group: "Strength" },
  { value: "strength_deadlift", label: "Deadlift (your variant)", group: "Strength" },
  { value: "strength_vertical_press", label: "Overhead press (your variant)", group: "Strength" },
  { value: "cardio_z2_short", label: "Easy Z2 — short (45 min)", group: "Cardio" },
  { value: "cardio_z2_long", label: "Long Z2 (75 min)", group: "Cardio" },
  { value: "cardio_z2_long_plus_alactic", label: "Long Z2 + alactic finisher (85 min)", group: "Cardio" },
  { value: "cardio_vo2", label: "VO2 intervals (4×4)", group: "Cardio" },
  { value: "cardio_alactic", label: "Alactic sprints", group: "Cardio" },
  { value: "tendon_hsr_knee", label: "HSR — knee (leg press)", group: "Tendon" },
  { value: "tendon_hsr_hinge", label: "HSR — posterior chain (RDL)", group: "Tendon" },
];

// Slugs each cardio/tendon kind resolves to in the catalog.
const KIND_TO_FIXED_SLUG: Partial<Record<CustomDayKind, { primary: string; finisher?: string }>> = {
  cardio_z2_short: { primary: "bike-indoor-z2" },
  cardio_z2_long: { primary: "run-long-z2" },
  cardio_z2_long_plus_alactic: { primary: "run-long-z2", finisher: "run-hill-sprints" },
  cardio_vo2: { primary: "run-vo2-4x4" },
  cardio_alactic: { primary: "run-hill-sprints" },
  tendon_hsr_knee: { primary: "hsr-leg-press" },
  tendon_hsr_hinge: { primary: "hsr-rdl" },
};

const KIND_TO_STRENGTH_ROLE: Partial<Record<CustomDayKind, StrengthRole>> = {
  strength_squat: "squat",
  strength_horizontal_press: "horizontal_press",
  strength_deadlift: "deadlift",
  strength_vertical_press: "vertical_press",
};

/**
 * Compile a CustomArchetypeInput into an Archetype that buildPrescription
 * can chew on. All days from the user input are marked as anchors so the
 * frequency-trimming logic doesn't strip them — the user explicitly picked
 * which days they want.
 */
export function compileCustomArchetype(input: CustomArchetypeInput): Archetype {
  const template = WAVE_TEMPLATES[input.waveTemplate];
  if (!template) throw new Error(`Unknown wave template: ${input.waveTemplate}`);

  const days: DayTemplate[] = [];
  let rank = 1;
  for (const d of input.days) {
    if (d.kind === "rest") continue;

    const strengthRole = KIND_TO_STRENGTH_ROLE[d.kind];
    if (strengthRole) {
      const sd: StrengthDay = {
        kind: "strength",
        dayIndex: d.dayIndex,
        role: strengthRole,
        title: `${STRENGTH_ROLE_LABELS[strengthRole]} day`,
        candidateSlugs: STRENGTH_ROLE_CANDIDATES[strengthRole],
        priority: "anchor",
        rank: rank++,
      };
      days.push(sd);
      continue;
    }

    const fixed = KIND_TO_FIXED_SLUG[d.kind];
    if (!fixed) continue;

    if (d.kind === "tendon_hsr_knee" || d.kind === "tendon_hsr_hinge") {
      const td: TendonDay = {
        kind: "tendon",
        dayIndex: d.dayIndex,
        role: d.kind === "tendon_hsr_knee" ? "hsr_knee" : "hsr_hinge",
        title: d.kind === "tendon_hsr_knee" ? "HSR — knee" : "HSR — posterior chain",
        movementSlug: fixed.primary,
        sets: 3,
        reps: 8,
        protocolNote: "70–80% 1RM, 3-0-3-0 tempo, 3 min rest",
        intensityLabel: d.kind === "tendon_hsr_knee" ? "HSR knee" : "HSR hinge",
        priority: "anchor",
        rank: rank++,
      };
      days.push(td);
      continue;
    }

    // cardio
    const cardioKind =
      d.kind === "cardio_vo2"
        ? "cardio_vo2"
        : d.kind === "cardio_alactic"
          ? "cardio_alactic"
          : "cardio_z2";
    const durationMin =
      d.kind === "cardio_z2_short"
        ? 45
        : d.kind === "cardio_z2_long" || d.kind === "cardio_z2_long_plus_alactic"
          ? 75
          : d.kind === "cardio_vo2"
            ? 35
            : 10;
    const cd: CardioDay = {
      kind: "cardio",
      dayIndex: d.dayIndex,
      role: d.kind,
      title:
        CUSTOM_DAY_OPTIONS.find((o) => o.value === d.kind)?.label ?? "Cardio",
      movementSlug: fixed.primary,
      cardioKind,
      durationMin,
      hrCap:
        cardioKind === "cardio_z2"
          ? "≤ 70% HRR, conversational"
          : cardioKind === "cardio_vo2"
            ? "90–95% HRmax during work"
            : undefined,
      protocolNote:
        cardioKind === "cardio_vo2"
          ? "4 × 4 min @ 90–95% HRmax, 3 min easy recovery"
          : cardioKind === "cardio_alactic"
            ? "6–10 × 10–15s near-max, walk-down recovery"
            : undefined,
      finisher: fixed.finisher
        ? {
            movementSlug: fixed.finisher,
            durationMin: 10,
            protocolNote: "6–10 × 10–15s near-max, walk-down recovery",
          }
        : undefined,
      priority: "anchor",
      rank: rank++,
    };
    days.push(cd);
  }

  // Truncate or extend the wave to match requested weeks.
  // For v1 we just take the first `weeks-1` weeks of the build phase + always
  // append the deload as the last week.
  const sourceWeeks = template.weeks;
  const buildPhase = sourceWeeks.slice(0, sourceWeeks.length - 1);
  const deload = sourceWeeks[sourceWeeks.length - 1]!;
  const targetBuild = Math.max(1, input.weeks - 1);
  const profiles: WeekProfile[] = [];
  for (let i = 0; i < targetBuild; i++) {
    const src = buildPhase[i] ?? buildPhase[buildPhase.length - 1]!;
    profiles.push({ ...src, weekIndex: i });
  }
  profiles.push({ ...deload, weekIndex: profiles.length });

  return {
    id: "custom" as ArchetypeId,
    name: input.name?.trim() || "Custom block",
    oneLiner: "Custom block you built day-by-day.",
    weeks: profiles.length,
    days,
    weekProfiles: profiles,
  };
}

export function customInputMinDays(input: CustomArchetypeInput): number {
  return input.days.filter((d) => d.kind !== "rest").length;
}
