/**
 * Day-order placements — the bridge between the wizard's Step 5 schedule
 * grid and the server-side block materialiser.
 *
 * The wizard's `state.schedule: ScheduleCell[]` captures the user's
 * exact session-to-day arrangement (e.g. Mon=Strength, Tue=Z2, Thu=Strength,
 * Sat=VO2). Before this module existed only `{ days, twoADay }` survived
 * the trip to the server — just which days were picked, not which session
 * landed on each day — so the persisted block always reflected the
 * archetype's canonical template order instead of the user's arrangement.
 *
 * This file owns:
 *   - The `Placement` wire shape (1 entry per filled AM/PM slot).
 *   - `buildPlacementsFromSchedule()` — wizard-side serialiser.
 *   - `placementSchema` / `dayIndexOverridesSchema` — Zod parsers for
 *     the JSON payload stored in `training_blocks.day_index_overrides`.
 *   - `applyPlacementsToActiveDays()` — server-side remap from the
 *     canonical `daysForFrequency()` output to the user's arrangement.
 *
 * Pure (no React / no Supabase imports) so it unit-tests in milliseconds
 * and stays usable on both sides of the server-action boundary.
 */
import { z } from "zod";
import type { DayTemplate } from "../archetypes";
import type { ScheduleCell, WeightKey } from "./schedule";

export type PlacementKind = "strength" | "cardio" | "tendon";
export type PlacementSlot = "single" | "am" | "pm";

/**
 * One filled AM/PM slot in the wizard's calendar grid. Carries enough
 * identity (`kind` + `weightKey`) for the materialiser to rebind the
 * correct canonical day template to this user-chosen day.
 */
export type Placement = {
  dayIndex: number; // 0..6 Mon..Sun
  slot: PlacementSlot;
  kind: PlacementKind;
  weightKey: string;
};

export const placementSchema: z.ZodType<Placement> = z.object({
  dayIndex: z.number().int().min(0).max(6),
  slot: z.enum(["single", "am", "pm"]),
  kind: z.enum(["strength", "cardio", "tendon"]),
  weightKey: z.string().min(1),
});

/**
 * The full JSON payload stored in `training_blocks.day_index_overrides`.
 * `placements` is optional during the rollout transition: blocks created
 * before this fix have `{ days, twoADay }` only, and submissions that
 * race the deploy may also lack it. Materialiser + queries must tolerate
 * both shapes.
 */
export const dayIndexOverridesSchema = z.object({
  days: z.array(z.number().int().min(0).max(6)),
  twoADay: z.boolean(),
  placements: z.array(placementSchema).optional(),
});

export type DayIndexOverrides = z.infer<typeof dayIndexOverridesSchema>;

/**
 * Map a wizard `WeightKey` to the materialiser's `kind` bucket. Tendon
 * is the only modality with a dedicated weightKey; everything cardio-shaped
 * carries Z2 / VO2 / "Easy Z2 (recovery)" copy; anything else is a lift.
 */
export function kindFromWeightKey(weightKey: WeightKey): PlacementKind {
  switch (weightKey) {
    case "Tendon day":
      return "tendon";
    case "Easy Z2 (recovery)":
    case "Polarized Z2":
    case "VO2 intervals":
    case "Long Z2 + alactic finisher":
    case "Maintenance Z2":
      return "cardio";
    default:
      return "strength";
  }
}

/**
 * Within a `kind`, split into finer buckets so the materialiser doesn't
 * accidentally swap a VO2 day with a Z2 day when both live on the same
 * archetype. Strength and tendon collapse to a single sub-kind because
 * the wizard doesn't expose intensity discriminators that match cleanly
 * onto `StrengthDay.role` / `TendonDay` template shape.
 */
export function placementSubKind(p: Placement): string {
  if (p.kind === "cardio") {
    return /VO2/i.test(p.weightKey) ? "vo2" : "z2";
  }
  return "default";
}

/** Template-side mirror of `placementSubKind` (operates on `DayTemplate`). */
export function templateSubKind(d: DayTemplate): string {
  if (d.kind === "cardio") {
    return d.cardioKind === "cardio_vo2" ? "vo2" : "z2";
  }
  return "default";
}

/**
 * Build the wire-form `placements` array from the wizard's Step 5
 * schedule grid. Two-a-day cells emit two placements (`am` then `pm`);
 * single-a-day cells emit one with `slot: "single"`. Empty cells are
 * skipped.
 */
export function buildPlacementsFromSchedule(schedule: ScheduleCell[]): Placement[] {
  const out: Placement[] = [];
  for (const cell of schedule) {
    const hasAm = cell.am !== null;
    const hasPm = cell.pm !== null;
    const both = hasAm && hasPm;
    if (cell.am) {
      out.push({
        dayIndex: cell.day,
        slot: both ? "am" : "single",
        kind: kindFromWeightKey(cell.am.weightKey),
        weightKey: cell.am.weightKey,
      });
    }
    if (cell.pm) {
      out.push({
        dayIndex: cell.day,
        slot: both ? "pm" : "single",
        kind: kindFromWeightKey(cell.pm.weightKey),
        weightKey: cell.pm.weightKey,
      });
    }
  }
  return out;
}

const SLOT_ORDER: Record<PlacementSlot, number> = { am: 0, single: 1, pm: 2 };

function bucketKey(kind: string, sub: string): string {
  return `${kind}|${sub}`;
}

/**
 * Remap the canonical `daysForFrequency()` output to honour the user's
 * Step-5 arrangement. Returns a new array — input is not mutated.
 *
 * Matching strategy (in priority order):
 *   1. `(kind, subKind)` bucket — most specific available given the
 *      data shapes (cardio splits VO2 vs Z2; strength + tendon each
 *      collapse to one bucket per kind).
 *   2. `kind` alone — fallback for any template that didn't find a
 *      match in its (kind, subKind) bucket (count mismatch).
 *   3. Canonical `dayIndex` / `slot` — final fallback when a template
 *      can't be matched to any placement (user added something
 *      client-side the canonical can't materialise).
 *
 * Placements that don't match any template are silently skipped
 * (defensive — shouldn't happen in normal flow because the wizard's
 * `buildWeekShape()` and `daysForFrequency()` produce structurally
 * matching session counts per `kind`).
 *
 * When `placements` is null / undefined / empty, returns the input
 * unchanged — preserves behaviour for blocks created before this fix
 * and for in-progress wizard submissions that race the rollout.
 */
export function applyPlacementsToActiveDays(
  activeDays: DayTemplate[],
  placements: Placement[] | null | undefined,
): DayTemplate[] {
  if (!placements || placements.length === 0) return activeDays;

  // Sort placements by (dayIndex, slot) so "i-th placement within a
  // bucket" is deterministic regardless of the order the wizard serialised
  // its grid in.
  const sorted = [...placements].sort((a, b) => {
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    return SLOT_ORDER[a.slot] - SLOT_ORDER[b.slot];
  });

  const byKindSub = new Map<string, Placement[]>();
  const byKind = new Map<string, Placement[]>();
  for (const p of sorted) {
    const k1 = bucketKey(p.kind, placementSubKind(p));
    const k2 = bucketKey(p.kind, "default");
    if (!byKindSub.has(k1)) byKindSub.set(k1, []);
    byKindSub.get(k1)!.push(p);
    if (!byKind.has(k2)) byKind.set(k2, []);
    byKind.get(k2)!.push(p);
  }

  // Track which placements have already been consumed so the kind-only
  // fallback bucket never hands out the same placement twice.
  const subCursor = new Map<string, number>();
  const consumed = new WeakSet<Placement>();
  const kindCursor = new Map<string, number>();

  return activeDays.map((day) => {
    const subKey = bucketKey(day.kind, templateSubKind(day));
    const subBucket = byKindSub.get(subKey);
    const subIdx = subCursor.get(subKey) ?? 0;
    const placement = subBucket?.[subIdx];
    if (placement) {
      subCursor.set(subKey, subIdx + 1);
      consumed.add(placement);
      return { ...day, dayIndex: placement.dayIndex, slot: placement.slot } as DayTemplate;
    }

    // Fall back to kind-only — pick the next unconsumed placement of
    // the same kind regardless of subKind.
    const kindKey = bucketKey(day.kind, "default");
    const kindBucket = byKind.get(kindKey);
    if (kindBucket) {
      let idx = kindCursor.get(kindKey) ?? 0;
      while (idx < kindBucket.length && consumed.has(kindBucket[idx]!)) idx++;
      if (idx < kindBucket.length) {
        const fallback = kindBucket[idx]!;
        kindCursor.set(kindKey, idx + 1);
        consumed.add(fallback);
        return { ...day, dayIndex: fallback.dayIndex, slot: fallback.slot } as DayTemplate;
      }
    }

    return day;
  });
}
