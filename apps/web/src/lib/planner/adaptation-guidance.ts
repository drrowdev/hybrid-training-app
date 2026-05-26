/**
 * Adaptation-horizon guidance per (goal × secondary).
 *
 * Pure lookup over the residual-training-effect numbers in
 * `docs/knowledge/hybrid-training-research-new.md` §5.1 (Issurin 2010,
 * HIGH confidence) and the emphasis-block window in §5.2 (4–8 wk).
 *
 * This module is **information only** — the engine never reads it. The
 * planner UI uses it to tell the user "expect a noticeable change in
 * N–M blocks" at the moment they're picking a focus, and to surface
 * the same hint on the Plan page header for an active block.
 *
 * Confidence label is `HIGH` per the research file (`research-new.md` §5.1):
 * Issurin's residual training effect numbers (25–35 days for strength
 * and aerobic, 5–15 days for speed/power) are labelled HIGH.
 */
import type { ArchetypeId } from "./archetypes";
import type { Goal, Secondary } from "./wizard/wizard-mapping";

export type AdaptationGuidance = {
  /** Min/max blocks to see meaningful adaptation for this combo. */
  blocks: { min: number; max: number };
  /** Min/max weeks (blocks × the archetype's nominal 4-week cadence). */
  weeks: { min: number; max: number };
  /** Approx weeks the trained quality is maintained after concentration ends. */
  decayWeeks: number | null;
  /** "Rotate, no fixed count" combos (concurrent / tendon). */
  rotates: boolean;
  /** One-line summary for the UI. */
  summary: string;
  /** Short citation label for the tooltip. */
  citation: string;
};

/** Canonical citation string. Kept short on purpose — no full bibliography. */
const CITATION = "Issurin 2010 · research §5.1 · HIGH";

type Row = {
  blocks: { min: number; max: number };
  weeks: { min: number; max: number };
  decayWeeks: number | null;
  note: string;
};

/**
 * Encoded recommendations per (goal, secondary). Wizard "cardio" is the
 * user-facing "endurance" in the research table — the wizard's literal
 * value lives here so the lookup is direct.
 *
 * `"skip"` and `"maintenance"` both resolve to the table's
 * "X | maintenance" row (shortest single-focus path). `null` secondary
 * also resolves there so Step 2 of the wizard can show a useful preview
 * before the user has reached Step 3.
 */
type SecKey = Goal | "skip-or-null";
const TABLE: Partial<Record<Goal, Partial<Record<SecKey, Row>>>> = {
  strength: {
    muscle: {
      blocks: { min: 2, max: 3 },
      weeks: { min: 8, max: 12 },
      decayWeeks: 4,
      note: "Neural gains land in block 1; hypertrophic CSA accrues over 2–3.",
    },
    cardio: {
      blocks: { min: 2, max: 3 },
      weeks: { min: 8, max: 12 },
      decayWeeks: 4,
      note: "Aerobic maintained through the strength emphasis.",
    },
    "skip-or-null": {
      blocks: { min: 2, max: 2 },
      weeks: { min: 8, max: 8 },
      decayWeeks: 4,
      note: "Shortest path to a strength signal.",
    },
  },
  muscle: {
    strength: {
      blocks: { min: 2, max: 4 },
      weeks: { min: 8, max: 16 },
      decayWeeks: 4,
      note: "Visible cross-sectional change typically lands at 8–12 wk for trained lifters.",
    },
    cardio: {
      blocks: { min: 3, max: 4 },
      weeks: { min: 12, max: 16 },
      decayWeeks: 4,
      note: "Slower due to the interference effect.",
    },
    "skip-or-null": {
      blocks: { min: 2, max: 3 },
      weeks: { min: 8, max: 12 },
      decayWeeks: 4,
      note: "Pure hypertrophy path.",
    },
  },
  cardio: {
    strength: {
      blocks: { min: 3, max: 4 },
      weeks: { min: 12, max: 16 },
      decayWeeks: 4,
      note: "VO₂ / Z2 mitochondrial + capillarisation timeline.",
    },
    muscle: {
      blocks: { min: 3, max: 4 },
      weeks: { min: 12, max: 16 },
      decayWeeks: 4,
      note: "Same aerobic timeline; muscle work tempered by interference.",
    },
    "skip-or-null": {
      blocks: { min: 3, max: 3 },
      weeks: { min: 12, max: 12 },
      decayWeeks: 4,
      note: "Aerobic emphasis only.",
    },
  },
};

function summariseStandard(row: Row): string {
  const sameBlocks = row.blocks.min === row.blocks.max;
  const sameWeeks = row.weeks.min === row.weeks.max;
  const blocksStr = sameBlocks ? `${row.blocks.min} block${row.blocks.min === 1 ? "" : "s"}` : `${row.blocks.min}–${row.blocks.max} blocks`;
  const weeksStr = sameWeeks ? `~${row.weeks.min} weeks` : `~${row.weeks.min}–${row.weeks.max} weeks`;
  const head = `Expect noticeable change in ${blocksStr} (${weeksStr}).`;
  const tail =
    row.decayWeeks != null
      ? ` Gains hold ~${row.decayWeeks} weeks after, so you can rotate to a different focus next.`
      : "";
  return head + tail;
}

const CONCURRENT_SUMMARY =
  "Concurrent / hybrid blocks build stable performance rather than a peak. " +
  "Expect gradual progress with no single milestone — rotate emphasis every 4–6 weeks.";

const TENDON_SUMMARY =
  "Tendon and connective-tissue remodelling runs on a months-to-years clock. " +
  "Plan 4+ blocks (16+ weeks) before judging the change.";

function tendonGuidance(): AdaptationGuidance {
  return {
    blocks: { min: 4, max: Infinity },
    weeks: { min: 16, max: Infinity },
    decayWeeks: null,
    rotates: true,
    summary: TENDON_SUMMARY,
    citation: CITATION,
  };
}

function concurrentGuidance(): AdaptationGuidance {
  return {
    blocks: { min: 0, max: Infinity },
    weeks: { min: 0, max: Infinity },
    decayWeeks: null,
    rotates: true,
    summary: CONCURRENT_SUMMARY,
    citation: CITATION,
  };
}

/**
 * Return the adaptation guidance for a chosen Goal × Secondary.
 *
 * - `goal === null` returns `null` (nothing to advise yet).
 * - `secondary === null` falls back to the single-focus ("skip") row,
 *   so Step 2 of the wizard can preview a timeline before Step 3.
 * - `goal === "resilience"` always returns the tendon row, regardless
 *   of `secondary` (the wizard skips Step 3 for resilience anyway).
 */
export function getAdaptationGuidance(
  goal: Goal | null,
  secondary: Secondary | null,
): AdaptationGuidance | null {
  if (goal == null) return null;

  if (goal === "resilience") return tendonGuidance();

  const goalRows = TABLE[goal];
  if (!goalRows) return null;

  const key: SecKey =
    secondary == null || secondary === "skip" || secondary === "maintenance"
      ? "skip-or-null"
      : secondary;

  const row = goalRows[key];
  if (!row) return null;

  return {
    blocks: row.blocks,
    weeks: row.weeks,
    decayWeeks: row.decayWeeks,
    rotates: false,
    summary: summariseStandard(row),
    citation: CITATION,
  };
}

/**
 * Best-effort derivation of (goal, secondary) from a persisted block's
 * archetype id. The `secondary` column is not stored on
 * `training_blocks`, so we can only recover the goal — secondary is
 * treated as "skip" (single-focus / maintenance row in the table).
 *
 * Returns `null` for archetypes that don't map to a single advisable
 * combination (maintenance shortcut, custom, concurrent hybrid).
 */
export function getAdaptationGuidanceForArchetype(
  archetypeId: ArchetypeId | string,
): AdaptationGuidance | null {
  switch (archetypeId) {
    case "strength_anchor":
      return getAdaptationGuidance("strength", "skip");
    case "hypertrophy_anchor":
      return getAdaptationGuidance("muscle", "skip");
    case "endurance_anchor":
      return getAdaptationGuidance("cardio", "skip");
    case "rebuild":
      return getAdaptationGuidance("resilience", null);
    case "concurrent_hybrid":
      // No clear primary persisted on the block (secondary isn't a
      // column on training_blocks) — fall back to the concurrent row.
      return concurrentGuidance();
    case "maintenance":
    case "custom":
    default:
      return null;
  }
}
