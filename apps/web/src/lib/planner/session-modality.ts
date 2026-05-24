/**
 * Session modality classifier.
 *
 * Phase 5 of the bodyweight progression plan. Examines a planned
 * session's movement list and assigns one of 7 modality classes. The
 * classification drives two downstream consumers:
 *
 *   1. The ceiling / stress-budget engine — `effective_stress_load`
 *      is the session's raw hard-set count scaled by the modality's
 *      stress multiplier. Mixed-modal sessions impose a higher
 *      recovery cost than the sum of their parts (Source: addendum
 *      §6 — "interference and translation imperfect"; a 20-min AMRAP
 *      of pull-ups and push-ups isn't a Z2 session and isn't a strength
 *      session, it's a third thing that budgets against both).
 *
 *   2. The BW prescription system can soften per-movement intensity
 *      when the overall session is mixed (Phase 7 hook — wired in
 *      future iteration; the classifier output is the contract).
 *
 * Pure module. No I/O, no DB, no React. Mirrors the structural pattern
 * in `accessory-intensity.ts` (bucket inference) and `bw-prescription.ts`
 * (deterministic, archetype-aware).
 *
 * Citations (kept here, never in user-facing UI copy — DC-Q6):
 *   - Bodyweight addendum §6 — conditioning classifier; mixed-modal
 *     budgets against both strength and aerobic.
 *   - Bodyweight addendum §5 — skill work is neurologically demanding
 *     even when "light"; skill-focused sessions get their own CNS
 *     multiplier rather than being scored as raw hypertrophy.
 *   - Wilson 2012 (interference model) — concurrent strength + endurance
 *     blunts both adaptations; the BW addendum §6 picks the same
 *     model up under the "third thing" framing.
 */
import type { MovementFamily } from "@hta/db";
import type { ArchetypeId } from "./archetypes";

/**
 * The seven session classes. First match in the rules table below wins.
 *
 * `mixed_modal` is the "third thing" from addendum §6 — strength +
 * conditioning in the same session, scored higher than either part on
 * its own. `skill_focused` covers CNS-heavy isometric work
 * (planche / lever / handstand / flag) that taxes the nervous system
 * out of proportion to its raw hard-set count.
 */
export type SessionModality =
  | "pure_strength"
  | "pure_hypertrophy"
  | "pure_z2_aerobic"
  | "pure_hiit"
  | "mixed_modal"
  | "skill_focused"
  | "restorative";

/**
 * Minimal movement shape needed for classification. Strength + accessory
 * items carry `bucket`; cardio items carry `cardioBlock`; BW main lifts
 * also carry the `bw` block from `bw-prescription.ts`. `estimatedHardSets`
 * is what the stress multiplier multiplies into for the ceiling math.
 */
export type ClassifierMovement = {
  kind: "main" | "back_off" | "accessory" | "conditioning" | "warmup";
  archetype?: ArchetypeId;
  bucket?: "main" | "back_off" | "accessory";
  cardioBlock?: {
    mode: "z2" | "hiit" | "mixed";
    durationMinutes: number;
  };
  bw?: {
    prescriptionType: "reps" | "isometric_hold" | "tempo_reps";
    family: MovementFamily;
    nodeDifficulty: number;
  };
  estimatedHardSets: number;
};

/**
 * Stress multiplier per class. Applied to the session's hard-set count
 * to produce `effective_stress_load` (persisted on `planned_sessions`
 * and consumed by the ceiling / recovery aggregator).
 *
 * Sources:
 *   - 1.25× for mixed-modal — addendum §6 (interference + imperfect
 *     translation; the bout costs more than the sum of its parts).
 *   - 1.3× for HIIT — practitioner consensus + Wilson 2012 (very high
 *     CNS + cardiovascular load per minute).
 *   - 1.2× for skill-focused — addendum §5 (CNS demand on heavy
 *     isometric / planche / lever / handstand work).
 *   - 0.4× for Z2 — addendum §6 (Z2 is the cheapest adaptation; barely
 *     touches the strength budget).
 *   - 0.2× for restorative — active recovery; nominal load only.
 *   - 1.0× baseline for strength + hypertrophy.
 */
export const MODALITY_STRESS_MULTIPLIER: Record<SessionModality, number> = {
  pure_strength: 1.0,
  pure_hypertrophy: 1.0,
  pure_z2_aerobic: 0.4,
  pure_hiit: 1.3,
  mixed_modal: 1.25,
  skill_focused: 1.2,
  restorative: 0.2,
};

/**
 * Plain-English label and one-line tooltip body per class. Brand-purity:
 * pure descriptors, no methodology names, no external program references.
 */
export const MODALITY_LABEL: Record<SessionModality, string> = {
  pure_strength: "Pure strength",
  pure_hypertrophy: "Pure hypertrophy",
  pure_z2_aerobic: "Z2 aerobic",
  pure_hiit: "HIIT",
  mixed_modal: "Mixed-modal",
  skill_focused: "Skill-focused",
  restorative: "Restorative",
};

export const MODALITY_TOOLTIP: Record<SessionModality, string> = {
  pure_strength:
    "Heavy main lifts, low rep, long rest. Budget against strength only.",
  pure_hypertrophy:
    "Moderate-rep strength + accessories. Budget against strength only.",
  pure_z2_aerobic:
    "Steady aerobic only. Cheapest adaptation — barely touches the strength budget.",
  pure_hiit:
    "High-intent intervals. High CNS + cardiovascular cost; plan recovery.",
  mixed_modal:
    "This is a mixed-modal session (strength + conditioning). Plan recovery accordingly.",
  skill_focused:
    "CNS-demanding skill work as the primary stimulus. Treat fresh, rest long.",
  restorative:
    "Active recovery, low intent. Nominal load only.",
};

/** Skill families per addendum §5 — see `bw-prescription.ts`. */
const SKILL_FAMILIES = new Set<MovementFamily>([
  "planche",
  "lever_front",
  "lever_back",
  "human_flag",
  "handstand",
]);

function totalHardSets(movs: ReadonlyArray<ClassifierMovement>): number {
  let n = 0;
  for (const m of movs) {
    if (m.kind === "warmup") continue;
    n += Math.max(0, m.estimatedHardSets);
  }
  return n;
}

function strengthSetCount(movs: ReadonlyArray<ClassifierMovement>): number {
  let n = 0;
  for (const m of movs) {
    if (m.bucket === "main" || m.bucket === "back_off") {
      n += Math.max(0, m.estimatedHardSets);
    }
  }
  return n;
}

function cardioMinutes(movs: ReadonlyArray<ClassifierMovement>): number {
  let n = 0;
  for (const m of movs) {
    if (m.cardioBlock) n += Math.max(0, m.cardioBlock.durationMinutes);
  }
  return n;
}

function hasHiit(movs: ReadonlyArray<ClassifierMovement>): boolean {
  return movs.some((m) => m.cardioBlock?.mode === "hiit");
}

function hasAnyMainBucket(movs: ReadonlyArray<ClassifierMovement>): boolean {
  return movs.some((m) => m.bucket === "main" || m.bucket === "back_off");
}

function hasOnlyCardio(movs: ReadonlyArray<ClassifierMovement>): boolean {
  const meaningful = movs.filter((m) => m.kind !== "warmup");
  if (meaningful.length === 0) return false;
  return meaningful.every((m) => m.kind === "conditioning" && !!m.cardioBlock);
}

function isSkillNode(m: ClassifierMovement): boolean {
  if (!m.bw) return false;
  if (m.bw.prescriptionType !== "isometric_hold") return false;
  if (m.bw.nodeDifficulty < 50) return false;
  return SKILL_FAMILIES.has(m.bw.family);
}

/**
 * Classify a planned session.
 *
 * Rules run in order, first match wins. The rules mirror the spec in
 * the Phase 5 plan exactly — touch with care, the integration tests
 * pin every class to its expected branch.
 */
export function classifySessionModality(planned: {
  movements: ReadonlyArray<ClassifierMovement>;
}): SessionModality {
  const m = planned.movements;
  const totalSets = totalHardSets(m);
  const strSets = strengthSetCount(m);
  const cardio = cardioMinutes(m);
  const onlyCardio = hasOnlyCardio(m);
  const hiit = hasHiit(m);

  // 1. restorative — very low total hard-set count, no strength main
  //    lifts, no HIIT, and no meaningful cardio block. Active-recovery
  //    shape (a Z2 hour falls through to rule 2; HIIT to rule 3).
  if (totalSets <= 4 && !hasAnyMainBucket(m) && !hiit && cardio < 10) {
    return "restorative";
  }

  // 2. pure_z2_aerobic — cardio-only session, every block is Z2 or a
  //    long "mixed" block (>30 min — short mixed blocks are HIIT-like
  //    and fall through). No strength items.
  if (onlyCardio && strSets === 0) {
    const blocks = m.filter((x) => !!x.cardioBlock);
    const allZ2 = blocks.every((x) => {
      const cb = x.cardioBlock!;
      if (cb.mode === "z2") return true;
      if (cb.mode === "mixed" && cb.durationMinutes > 30) return true;
      return false;
    });
    if (allZ2 && !hiit) return "pure_z2_aerobic";
  }

  // 3. pure_hiit — cardio-only with HIIT blocks, OR any cardio session
  //    with no main-bucket strength work backing it.
  if ((onlyCardio && hiit) || (cardio > 0 && strSets === 0 && hiit)) {
    return "pure_hiit";
  }

  // 4. skill_focused — ≥ 60% of meaningful movements are heavy
  //    isometric skill nodes, and no long cardio block is present.
  //    Source: addendum §5 (CNS demand from skill nodes — planche /
  //    lever / handstand / flag territory).
  const meaningful = m.filter((x) => x.kind !== "warmup");
  if (meaningful.length > 0) {
    const skillCount = meaningful.filter(isSkillNode).length;
    const longCardio = m.some(
      (x) => x.cardioBlock && x.cardioBlock.durationMinutes > 15,
    );
    if (skillCount / meaningful.length >= 0.6 && !longCardio) {
      return "skill_focused";
    }
  }

  // 5. mixed_modal — the "third thing". Both strength work (≥ 3 sets
  //    across main / back_off) AND meaningful cardio (≥ 10 min) in the
  //    same session. Source: addendum §6.
  if (strSets >= 3 && cardio >= 10) {
    return "mixed_modal";
  }

  // 6. pure_strength — main / back_off only, archetype tagged
  //    strength_anchor, no cardio.
  if (cardio === 0 && strSets > 0) {
    const allStrengthArchetype = m
      .filter((x) => x.bucket === "main" || x.bucket === "back_off")
      .every((x) => x.archetype === "strength_anchor");
    const hasOnlyMainBuckets = m.every(
      (x) =>
        x.kind === "warmup" ||
        x.bucket === "main" ||
        x.bucket === "back_off",
    );
    if (allStrengthArchetype && hasOnlyMainBuckets) {
      return "pure_strength";
    }
  }

  // 7. pure_hypertrophy — main / back_off + accessory work, no
  //    significant cardio (< 10 min).
  if (cardio < 10 && strSets > 0) {
    return "pure_hypertrophy";
  }

  // 8. Fallback — cardio present (otherwise we'd have matched 7) →
  //    treat as mixed_modal; else hypertrophy as a safe default.
  return cardio > 0 ? "mixed_modal" : "pure_hypertrophy";
}

/**
 * Compute the session's effective stress load — raw hard-set count
 * scaled by the modality multiplier. Consumed by the ceiling /
 * recovery aggregator (see `apps/web/src/lib/stats/engine.ts`).
 *
 * Persisted on `planned_sessions.effective_stress_load` (numeric(6,2))
 * via migration 0046 so the engine can read it back without having to
 * re-classify every session on every aggregation pass.
 */
export function effectiveStressLoad(args: {
  modality: SessionModality;
  hardSets: number;
}): number {
  const mult = MODALITY_STRESS_MULTIPLIER[args.modality] ?? 1.0;
  const raw = Math.max(0, args.hardSets) * mult;
  return Math.round(raw * 100) / 100;
}
