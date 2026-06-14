/**
 * User-initiated deload week — pure builder (ADR 0049).
 *
 * Given the user's NEXT programmed week, produce a standalone "recovery week" at
 * 5/3/1-style light loading. Used both to PREVIEW the deload week (before the
 * user accepts) and to materialise it on insert. Pure: no DB, no React.
 *
 * Content recipe ("your next week, lighter"):
 *   - Each distinct MAIN lift → a fixed light ramp, 40/50/60 % of TM × 5, no
 *     AMRAP. Source: 5/3/1 Forever (Wendler 2017) deload wave; the same numbers
 *     the app already ships in `@hta/wendler` `waves.ts`. Weight recomputes from
 *     the user's TM because main sets carry `percentTm` (integer percent), so no
 *     rounding is needed here.
 *   - Warm-ups kept as-is.
 *   - Accessories / supplemental / back-off / tendon / power work stripped.
 *   - Conditioning eased: easy cardio (Z2 / external) kept; hard cardio
 *     (VO2 / threshold / alactic) converted to a short easy Z2 so a hard-cardio
 *     day becomes a recovery jog rather than a rest gap.
 *
 * The resulting prescription is OFF-PROGRAM: it carries NO `programRef`, so
 * logging it never advances a stateful engine's instance cursor (ADR 0049).
 */
import type { Prescription, PrescriptionItem } from "@hta/db";

/**
 * Deload main-lift ramp — integer `percentTm`, 5 reps, no AMRAP. 5/3/1 Forever
 * deload wave (HIGH confidence; identical to the shipped 5/3/1 deload loading).
 */
export const DELOAD_MAIN_RAMP = [40, 50, 60] as const;
const DELOAD_MAIN_REPS = 5;
const DELOAD_MAIN_CUE = "Deload — leave plenty in reserve";

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
export function buildDeloadPrescription(source: Prescription): Prescription {
  const items: PrescriptionItem[] = [];

  // 1. Warm-ups pass through unchanged.
  for (const it of source.items) {
    if (it.kind === "warmup") items.push(it);
  }

  // 2. Each distinct main lift → the 40/50/60 × 5 deload ramp. A TB cluster has
  //    several main movements in one session; each gets its own ramp.
  const seenMain = new Set<string>();
  for (const it of source.items) {
    if (it.kind !== "main" || seenMain.has(it.movementId)) continue;
    seenMain.add(it.movementId);

    const hasPercent = source.items.some(
      (s) =>
        s.movementId === it.movementId &&
        s.kind === "main" &&
        typeof s.percentTm === "number",
    );

    if (hasPercent) {
      for (const pct of DELOAD_MAIN_RAMP) {
        items.push({
          movementId: it.movementId,
          ...(it.movementSlug ? { movementSlug: it.movementSlug } : {}),
          ...(it.movementName ? { movementName: it.movementName } : {}),
          kind: "main",
          percentTm: pct,
          reps: DELOAD_MAIN_REPS,
          isAmrap: false,
          intensityCue: DELOAD_MAIN_CUE,
        });
      }
    } else {
      // Bodyweight / fixed-load main with no %TM basis: carry the movement at
      // its lightest prescribed form, never AMRAP, cued as a deload. No load
      // change (we have no TM to ramp from) — the cue communicates the intent.
      const lightest = source.items
        .filter((s) => s.movementId === it.movementId && s.kind === "main")
        .reduce((a, b) => ((b.reps ?? 0) <= (a.reps ?? 0) ? b : a), it);
      items.push({
        ...lightest,
        isAmrap: false,
        intensityCue: DELOAD_MAIN_CUE,
      });
    }
  }

  // 3. Conditioning: keep easy cardio; convert hard cardio to a short easy Z2.
  for (const it of source.items) {
    if (EASY_CARDIO_KINDS.has(it.kind)) {
      items.push(it);
    } else if (HARD_CARDIO_KINDS.has(it.kind)) {
      items.push({
        movementId: it.movementId,
        ...(it.movementSlug ? { movementSlug: it.movementSlug } : {}),
        ...(it.movementName ? { movementName: it.movementName } : {}),
        kind: "cardio_z2",
        durationMin: Math.min(it.durationMin ?? DELOAD_EASY_CARDIO_MAX_MIN, DELOAD_EASY_CARDIO_MAX_MIN),
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
 * Build the whole deload week from the user's next programmed week. Sessions
 * whose deload form is empty (e.g. an accessory-only day) become rest and are
 * omitted. Order mirrors the source week.
 */
export function buildDeloadWeek(sources: DeloadWeekSource[]): DeloadSessionSpec[] {
  const out: DeloadSessionSpec[] = [];
  for (const s of [...sources].sort((a, b) => a.dayIndex - b.dayIndex || a.slot.localeCompare(b.slot))) {
    if (!s.prescription) continue;
    const prescription = buildDeloadPrescription(s.prescription);
    if (prescription.items.length === 0) continue; // becomes a rest day
    out.push({
      dayIndex: s.dayIndex,
      slot: s.slot,
      title: s.title ? `Deload · ${s.title}` : "Deload week",
      sessionModality: s.sessionModality,
      prescription,
    });
  }
  return out;
}
