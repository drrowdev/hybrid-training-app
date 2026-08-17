/**
 * Actual-vs-prescribed session load — Finding 1 fix from the
 * "engine-actual-vs-prescribed" audit. Pure helper; no DB, no I/O.
 *
 * The prescribed `effective_stress_load` is stamped at plan-generation
 * time from `prescription.items[].sets`. Once the user logs real sets
 * (or skips them, or appends 30 min of Z2), the stamp goes stale. This
 * helper rebuilds ESL from the LOGGED data and the post-hoc modality,
 * preserving the existing `MODALITY_STRESS_MULTIPLIER` scale so the
 * downstream ceiling/recovery math doesn't move under it.
 *
 * Contract:
 *   strengthEsl = (non-warmup, non-skipped logged sets) × modality_mult
 *   cardioEsl   = Σ per cardio_log (
 *                   inferred_kind ? eslFor(kind, min)   // classified
 *                                 : durationMin × mode_multiplier      // internal fallback
 *                 )
 *   effectiveStressLoad = round2(strengthEsl + cardioEsl)
 *   sessionModality = classifySessionModality(reconstructed movements)
 *
 * Reusing `classifySessionModality` for the post-hoc modality means a
 * prescribed `pure_strength` that actually got 30 min of Z2 appended
 * lands as `mixed_modal` — fixing Finding 7 as a side effect.
 *
 * Scale note (intentional, documented): adding strength ESL +
 * cardio ESL changes the relative weighting between internal and
 * external cardio compared to today (internal cardio sessions
 * currently sit at strength_modality-scaled ESL; external cardio is
 * already on the cardio-minute scale). This is the unification the
 * `classify-cardio.ts` ESL-scale follow-up note flagged.
 *
 * v1 keeps the simple set-count model (one logged hard set = 1.0).
 * TODO(v2, post-feedback): scale each set's contribution by RPE
 *   (e.g. clamp(rpe/8, 0.5, 1.5)). Held back from v1 to keep the
 *   "swap prescribed-set-count for actual-set-count" change isolated.
 */
import {
  classifySessionModality,
  MODALITY_STRESS_MULTIPLIER,
  type ClassifierMovement,
  type SessionModality,
} from "@/lib/planner/session-modality";
import {
  cardioEslFromKind,
  type ClassifiedCardioKind,
} from "@/lib/cardio/classify-cardio";
import { isCountableSet } from "./set-load";

/** Logged strength set, post-filter friendly (the helper double-checks). */
export type SetLogRow = {
  movementId: string;
  setKind: "warmup" | "main" | "back_off" | "accessory" | "tendon" | string;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
  isSkipped: boolean;
};

/**
 * Logged cardio block. `inferredKind` comes from the cardio classifier
 * (cardio_logs.inferred_kind). The schema does NOT carry a stored
 * cardio_logs.inferred_esl column — ESL is always re-derived from
 * (kind, durationMin) here via `cardioEslFromKind`. If a caller has a
 * pre-computed ESL (e.g. classifier output during a write path), pass it
 * via `precomputedEsl` to skip the re-derivation.
 */
export type CardioLogRow = {
  movementId: string | null;
  /** Free-text cardio_logs.modality, used as last-resort heuristic. */
  modality: string;
  durationSec: number;
  /** cardio_logs.inferred_kind — null on pre-classified or internal logs. */
  inferredKind: ClassifiedCardioKind | string | null;
  /**
   * Pre-computed ESL (rare; only the manual activity-link write path
   * produces one). Null = re-derive from inferredKind or fall back.
   */
  precomputedEsl?: number | null;
};

export type ActualLoadInput = {
  /** Existing planned_sessions.session_modality. Falls back to "pure_hypertrophy". */
  prescribedModality: string | null;
  setLogs: ReadonlyArray<SetLogRow>;
  cardioLogs: ReadonlyArray<CardioLogRow>;
};

export type CardioSource = "kind-classified" | "duration-modality" | "none";

export type ActualLoadOutput = {
  /** Round-2 value to write to planned_sessions.effective_stress_load. */
  effectiveStressLoad: number;
  /** Recomputed planned_sessions.session_modality. */
  sessionModality: SessionModality;
  breakdown: {
    strengthEsl: number;
    cardioEsl: number;
    cardioSource: CardioSource;
    /** Count of non-warmup, non-skipped logged sets. */
    hardSets: number;
  };
};

const STRENGTH_BUCKET_FOR_SET_KIND: Record<string, "main" | "back_off" | "accessory" | null> = {
  warmup: null,
  main: "main",
  back_off: "back_off",
  accessory: "accessory",
  // "tendon" is Baar protocol isometric — counts as accessory volume so
  // it contributes to set count but doesn't trip the rule-6 "pure_strength
  // requires all main/back_off to be strength_anchor" branch.
  tendon: "accessory",
};

/** Map free-text cardio_logs.modality / inferred_kind → classifier mode. */
function cardioMode(
  inferredKind: string | null,
  modality: string,
): "z2" | "hiit" | "mixed" {
  if (inferredKind === "cardio_z2") return "z2";
  if (
    inferredKind === "cardio_vo2" ||
    inferredKind === "cardio_alactic" ||
    inferredKind === "cardio_threshold"
  ) {
    return "hiit";
  }
  if (inferredKind === "cardio_mixed") return "mixed";
  const m = (modality || "").toLowerCase();
  if (m.includes("z2") || m.includes("easy") || m.includes("zone 2")) return "z2";
  if (
    m.includes("hiit") ||
    m.includes("vo2") ||
    m.includes("intervals") ||
    m.includes("sprint") ||
    m.includes("alactic")
  ) {
    return "hiit";
  }
  return "mixed";
}

/**
 * Treat a logged set as "hard" (counts toward strength ESL) when it's
 * neither a warmup nor a skipped row. Delegates to the shared
 * `isCountableSet` rule so every consumer of set_logs uses the same
 * skip/warmup filter. Empty rows (no reps + no duration + no distance)
 * are still counted — the caller controls whether such rows exist via
 * the per-set logger's input validation.
 */
function isHardSet(s: SetLogRow): boolean {
  return isCountableSet(s);
}

function strengthModalityMultiplier(modality: SessionModality): number {
  return MODALITY_STRESS_MULTIPLIER[modality] ?? 1.0;
}

/** Internal-cardio modality multiplier — matches the prescribed-side scale. */
function internalCardioModalityMultiplier(
  mode: "z2" | "hiit" | "mixed",
): number {
  switch (mode) {
    case "z2":
      return MODALITY_STRESS_MULTIPLIER.pure_z2_aerobic; // 0.4
    case "hiit":
      return MODALITY_STRESS_MULTIPLIER.pure_hiit; // 1.3
    case "mixed":
      return MODALITY_STRESS_MULTIPLIER.mixed_modal; // 1.25
  }
}

/**
 * Re-classify the session from the LOGGED data. Strength sets become
 * synthetic ClassifierMovements grouped by (movement_id, set_kind);
 * cardio_logs become conditioning blocks.
 */
function reclassify(input: ActualLoadInput): SessionModality {
  const movs: ClassifierMovement[] = [];

  // Group hard sets by (movement_id, set_kind) — one ClassifierMovement
  // per group with estimatedHardSets = group size.
  const byMovKind = new Map<string, { kind: string; n: number }>();
  for (const s of input.setLogs) {
    if (!isHardSet(s)) continue;
    const key = `${s.movementId}::${s.setKind}`;
    const cur = byMovKind.get(key);
    if (cur) cur.n += 1;
    else byMovKind.set(key, { kind: s.setKind, n: 1 });
  }
  for (const [, group] of byMovKind) {
    const bucket = STRENGTH_BUCKET_FOR_SET_KIND[group.kind];
    if (!bucket) continue;
    movs.push({
      kind: bucket === "accessory" ? "accessory" : (bucket as "main" | "back_off"),
      // Use strength_anchor for main/back_off so rule 6 (pure_strength)
      // can fire for sessions that were prescribed strength and stayed
      // strength. Accessories use hypertrophy_anchor.
      archetype: bucket === "accessory" ? "hypertrophy_anchor" : "strength_anchor",
      bucket,
      estimatedHardSets: group.n,
    });
  }

  // Cardio: one conditioning movement per cardio_log.
  for (const c of input.cardioLogs) {
    const durationMinutes = Math.max(0, Math.round(c.durationSec / 60));
    if (durationMinutes <= 0) continue;
    movs.push({
      kind: "conditioning",
      cardioBlock: {
        mode: cardioMode(
          typeof c.inferredKind === "string" ? c.inferredKind : null,
          c.modality,
        ),
        durationMinutes,
      },
      estimatedHardSets: 0,
    });
  }

  return classifySessionModality({ movements: movs });
}

/**
 * Compute the actual ESL + post-hoc modality for a completed session.
 * Pure — no I/O. Callers (sessions/actions.ts) read set_logs +
 * cardio_logs, hand them in, then UPDATE planned_sessions with the
 * returned `effectiveStressLoad` and `sessionModality`.
 */
export function computeActualSessionLoad(
  input: ActualLoadInput,
): ActualLoadOutput {
  const sessionModality = reclassify(input);

  // Strength side: count hard sets × modality multiplier.
  const hardSets = input.setLogs.reduce((n, s) => (isHardSet(s) ? n + 1 : n), 0);
  const strengthEsl = hardSets * strengthModalityMultiplier(sessionModality);

  // Cardio side: walk each log, preferring precomputed → inferred_kind
  // → duration × modality fallback.
  let cardioEsl = 0;
  let cardioSource: CardioSource = "none";
  for (const c of input.cardioLogs) {
    const durationMin = Math.max(0, c.durationSec / 60);
    if (durationMin <= 0) continue;

    if (c.precomputedEsl != null && Number.isFinite(c.precomputedEsl)) {
      cardioEsl += Math.max(0, c.precomputedEsl);
      if (cardioSource === "none") cardioSource = "kind-classified";
      continue;
    }

    if (
      typeof c.inferredKind === "string" &&
      (c.inferredKind === "cardio_z2" ||
        c.inferredKind === "cardio_threshold" ||
        c.inferredKind === "cardio_vo2" ||
        c.inferredKind === "cardio_alactic" ||
        c.inferredKind === "cardio_mixed")
    ) {
      cardioEsl += cardioEslFromKind(
        c.inferredKind as ClassifiedCardioKind,
        Math.max(1, Math.round(durationMin)),
      );
      if (cardioSource === "none") cardioSource = "kind-classified";
      continue;
    }

    const mode = cardioMode(null, c.modality);
    cardioEsl += durationMin * internalCardioModalityMultiplier(mode);
    if (cardioSource !== "kind-classified") cardioSource = "duration-modality";
  }

  // Strength + cardio components are already scaled (modality multiplier
  // on the strength side, per-kind multiplier on the cardio side), so
  // just sum and round to 2 decimals matching `effectiveStressLoad`'s
  // shape.
  const total = Math.round((strengthEsl + cardioEsl) * 100) / 100;

  return {
    effectiveStressLoad: total,
    sessionModality,
    breakdown: {
      strengthEsl: Math.round(strengthEsl * 100) / 100,
      cardioEsl: Math.round(cardioEsl * 100) / 100,
      cardioSource,
      hardSets,
    },
  };
}
