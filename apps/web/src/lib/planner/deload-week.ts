/**
 * User-initiated recovery week — pure builder (ADR 0049, loading superseded).
 *
 * Given the user's NEXT programmed week and the program's own recovery-week
 * policy, produce a standalone lighter week. Used both to PREVIEW it (before the
 * user accepts) and to materialise it on insert. Pure: no DB, no React.
 *
 * The CONTENT is the program's, not this file's. 5/3/1 cuts the weight hard and
 * keeps the reps; Tactical Barbell keeps the weight moderate and cuts the reps;
 * Green Protocol rests. Each states its own `RecoveryWeekPolicy` and this
 * mirrors the user's week through it:
 *
 *   - Each distinct MAIN lift → the policy's sets, and warm-ups REGENERATED to
 *     that top set (the week being mirrored is often peak week, whose warm-ups
 *     would be heavier than the recovery work itself).
 *   - Accessories / supplemental / back-off / tendon / power work stripped.
 *   - Easy cardio kept, capped by the policy; hard cardio (VO2 / threshold /
 *     alactic) converted to a short easy Z2 so a hard day becomes a recovery
 *     jog rather than a rest gap.
 *
 * The resulting prescription is OFF-PROGRAM: it carries NO `programRef`, so
 * logging it never advances a stateful engine's instance cursor (ADR 0049).
 */
import type { RecoveryWeekPolicy } from "@hta/program-core";
import type { Prescription, PrescriptionItem } from "@hta/db";

/** Warm-up ramp for the recovery week's own top set. */
const RECOVERY_WARMUP_RAMP = [
  { of: 0.4, reps: 5 },
  { of: 0.7, reps: 3 },
] as const;

/** Reps a bodyweight main is eased to when there is no percentage to reduce. */
const DEFAULT_BODYWEIGHT_REPS = 5;

/** The main sets a policy prescribes, heaviest last. */
export function recoveryMainSets(
  policy: RecoveryWeekPolicy,
): Array<{ percent: number; reps: number; repsMax?: number }> {
  if (policy.restOnly) return [];
  return policy.setOffsets.map((offset) => ({
    percent: Math.max(1, policy.topPercent + offset),
    reps: policy.reps,
    ...(policy.repsMax != null ? { repsMax: policy.repsMax } : {}),
  }));
}

/** Strength kinds removed entirely on a deload week (volume → none). */
const STRENGTH_DROP_KINDS = new Set<PrescriptionItem["kind"]>([
  "accessory",
  "back_off",
  "tendon",
  "power_potentiation",
]);
/** Cardio kinds that are already easy and pass through unchanged. */
const EASY_CARDIO_KINDS = new Set<PrescriptionItem["kind"]>([
  "cardio_z2",
  "cardio_external",
]);
/** Hard cardio kinds converted to a short easy Z2 on a deload week. */
const HARD_CARDIO_KINDS = new Set<PrescriptionItem["kind"]>([
  "cardio_vo2",
  "cardio_threshold",
  "cardio_alactic",
]);
/** Cap (minutes) for a deload-week easy cardio session. */
const DELOAD_EASY_CARDIO_MAX_MIN = 30;

/**
 * Transform one session's prescription into its deload-week form. Returns a
 * clean `{ items }` prescription — every off-program marker (programRef,
 * autoreg/skip flags) is intentionally dropped so the deload session is
 * off-program and byte-clean.
 */
/**
 * Transform one session's prescription into its recovery-week form, following
 * the program's own policy. Returns a clean `{ items }` prescription — every
 * off-program marker (programRef, autoreg/skip flags) is intentionally dropped
 * so the recovery session is off-program and byte-clean.
 *
 * `percentScale` converts a percentage of the lifter's TRUE max into the
 * `percentTm` the renderer expects, for a block that loads off a derived
 * training max. A policy stated against the true max (Tactical Barbell) needs
 * it; one stated against the training max (5/3/1) does not.
 */
export function buildDeloadPrescription(
  source: Prescription,
  policy: RecoveryWeekPolicy,
  percentScale = 1,
): Prescription {
  const items: PrescriptionItem[] = [];
  const mainSets = recoveryMainSets(policy);

  // 1. Main lifts first, so their warm-ups can ramp to the RIGHT top set. The
  //    recovery week mirrors the next programmed week, which for a Tactical
  //    Barbell block is often peak week — passing its warm-ups through would
  //    have the lifter warming up heavier than they then work.
  const seenMain = new Set<string>();
  const mainItems: PrescriptionItem[] = [];
  for (const it of source.items) {
    if (it.kind !== "main" || seenMain.has(it.movementId)) continue;
    seenMain.add(it.movementId);
    if (policy.restOnly) continue;

    const hasPercent = source.items.some(
      (s) =>
        s.movementId === it.movementId &&
        s.kind === "main" &&
        typeof s.percentTm === "number",
    );

    if (hasPercent) {
      for (const set of mainSets) {
        mainItems.push({
          movementId: it.movementId,
          ...(it.movementSlug ? { movementSlug: it.movementSlug } : {}),
          ...(it.movementName ? { movementName: it.movementName } : {}),
          kind: "main",
          percentTm: Math.round(set.percent * percentScale),
          reps: set.reps,
          ...(set.repsMax != null && set.repsMax !== set.reps
            ? { repRange: { min: set.reps, max: set.repsMax } }
            : {}),
          isAmrap: false,
          intensityCue: policy.cue,
        });
      }
    } else {
      // Bodyweight / fixed-load main with no %TM basis: there is no percentage
      // to ease, so ease the VOLUME instead — the policy's set count at its rep
      // floor, never AMRAP.
      const lightest = source.items
        .filter((s) => s.movementId === it.movementId && s.kind === "main")
        .reduce((a, b) => ((b.reps ?? 0) <= (a.reps ?? 0) ? b : a), it);
      const reps = Math.min(lightest.reps ?? DEFAULT_BODYWEIGHT_REPS, DEFAULT_BODYWEIGHT_REPS);
      mainItems.push({
        ...lightest,
        sets: 1,
        reps,
        ...(lightest.repRange ? { repRange: undefined } : {}),
        isAmrap: false,
        intensityCue: policy.cue,
      });
    }
  }

  // 2. Warm-ups: regenerated to the recovery week's own top set, not carried
  //    over from the week being mirrored.
  const topPercent = mainSets.length > 0
    ? Math.round(mainSets[mainSets.length - 1]!.percent * percentScale)
    : 0;
  for (const main of mainItems) {
    const warmups = source.items.filter(
      (s) => s.kind === "warmup" && s.movementId === main.movementId,
    );
    if (warmups.length === 0) continue;
    if (main.percentTm == null) {
      items.push(...warmups);
      continue;
    }
    for (const ramp of RECOVERY_WARMUP_RAMP) {
      const percent = Math.round(topPercent * ramp.of);
      if (percent <= 0 || percent >= main.percentTm) continue;
      items.push({
        ...warmups[0]!,
        kind: "warmup",
        percentTm: percent,
        reps: ramp.reps,
        isAmrap: false,
      });
    }
  }
  items.push(...mainItems);

  // 3. Conditioning: keep easy cardio (capped when the policy says so); convert
  //    hard cardio to a short easy Z2.
  for (const it of source.items) {
    if (EASY_CARDIO_KINDS.has(it.kind)) {
      const cap = policy.easyCardioMaxMin;
      items.push(
        cap != null && (it.durationMin ?? 0) > cap
          ? { ...it, durationMin: cap, intensityLabel: "Easy" }
          : it,
      );
    } else if (HARD_CARDIO_KINDS.has(it.kind)) {
      items.push({
        movementId: it.movementId,
        ...(it.movementSlug ? { movementSlug: it.movementSlug } : {}),
        ...(it.movementName ? { movementName: it.movementName } : {}),
        kind: "cardio_z2",
        durationMin: Math.min(
          it.durationMin ?? DELOAD_EASY_CARDIO_MAX_MIN,
          policy.easyCardioMaxMin ?? DELOAD_EASY_CARDIO_MAX_MIN,
        ),
        hrCap: "conversational",
        intensityLabel: "Easy",
      });
    }
    // STRENGTH_DROP_KINDS and anything else are dropped.
  }
  void STRENGTH_DROP_KINDS; // documented drop-list (membership is implicit above)

  return { items };
}

/** One source planned session (the shape the builder needs from the next week). */
export type DeloadWeekSource = {
  dayIndex: number;
  slot: string;
  title: string | null;
  sessionModality: string | null;
  prescription: Prescription | null;
};

/** One materialisable deload-week session. */
export type DeloadSessionSpec = {
  dayIndex: number;
  slot: string;
  title: string;
  sessionModality: string | null;
  prescription: Prescription;
};

/**
 * Build the whole recovery week from the user's next programmed week, through
 * the program's policy. Sessions whose recovery form is empty (an accessory-only
 * day, or any strength day under a rest-only policy) become rest and are
 * omitted. Order mirrors the source week.
 */
export function buildDeloadWeek(
  sources: DeloadWeekSource[],
  policy: RecoveryWeekPolicy,
  percentScale = 1,
): DeloadSessionSpec[] {
  const out: DeloadSessionSpec[] = [];
  for (const s of [...sources].sort((a, b) => a.dayIndex - b.dayIndex || a.slot.localeCompare(b.slot))) {
    if (!s.prescription) continue;
    const prescription = buildDeloadPrescription(
      s.prescription,
      policy,
      percentScale,
    );
    if (prescription.items.length === 0) continue; // becomes a rest day
    out.push({
      dayIndex: s.dayIndex,
      slot: s.slot,
      title: s.title ? `Recovery · ${s.title}` : "Recovery week",
      sessionModality: s.sessionModality,
      prescription,
    });
  }
  return out;
}
