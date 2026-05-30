/**
 * Next-block suggestion nudge (ADR 0010) — lightweight macrocycle guidance.
 *
 * The engine is a mesocycle generator: it builds one well-formed block at a
 * time and stops. There is no annual planner and deliberately won't be one
 * (ADR 0010 rejected a Gantt-style timeline). Instead, at the moment the
 * user starts a new block, we surface ONE dismissible suggestion for the
 * next archetype with a one-line reason. It pre-selects but never forces;
 * the full manual choice is always available.
 *
 * Everything here is PURE and advice-only: it reads recent block history +
 * the upcoming A-event modality + recent reactive-deload count, and returns
 * a suggestion or null. It never touches `buildPrescription`, archetype
 * config, or any completion path. Returning `null` (no confident rule
 * fires) is a feature — silence beats a low-confidence nudge.
 *
 * Evidence base (all MODERATE, framework-level — not RCT-grade, so the copy
 * and the constants both say "heuristic"):
 *   - Block periodization (Issurin 2010; Bompa): sequence concentrated
 *     blocks accumulation → intensification → realization.
 *   - Phase potentiation: a hypertrophy base raises the ceiling for a
 *     subsequent strength block (directional support).
 *   - Variation of emphasis drives continued adaptation; an identical
 *     stimulus run indefinitely stalls.
 *   - Event-specific peaking is handled by ADR 0008; the nudge just routes
 *     the user toward the matching archetype ahead of an event.
 */
import type { ArchetypeId } from "./archetypes";
import type { TaperModality } from "./taper";

// heuristic — periodization sequencing thresholds (CP-1), practitioner-consensus.
// None of these are RCT-calibrated; they encode coaching convention and must
// not be treated as precise. See ADR 0010.
/** ≥ this many recent reactive deloads ⇒ back off to recovery work. */
const REACTIVE_DELOAD_BACKOFF = 2;
/** ≥ this many consecutive accumulation (hypertrophy) blocks ⇒ consolidate with strength. */
const ACCUMULATION_RUN_FOR_CONSOLIDATION = 2;
/** Same archetype this many times in a row ⇒ surface an anti-staleness nudge. */
const STALENESS_RUN = 3;
/** ≥ this many consecutive strength blocks (event-less) ⇒ a realization week is earned. */
const REALIZATION_MIN_STRENGTH_RUN = 2;

export type NextBlockSuggestion = {
  archetypeId: Exclude<ArchetypeId, "custom">;
  /** One-sentence, suggestion-framed rationale (never a mandate). */
  reason: string;
};

export type SuggestNextArchetypeInput = {
  /**
   * Recent block archetypes, MOST-RECENT FIRST. Include `"custom"` entries
   * as-is; they break runs (a custom block is not part of a known phase
   * sequence). Typically the last 3–4 blocks.
   */
  recentArchetypes: ArchetypeId[];
  /**
   * Peaking modality of the next upcoming A-priority event, or null when no
   * A-event is on the horizon. Derived from the event via ADR 0008's
   * `taperModalityForEvent`.
   */
  upcomingEventModality: TaperModality | null;
  /** Count of reactive (auto-triggered) deloads in the recent window. */
  recentReactiveDeloads: number;
};

/** Map an upcoming A-event's peaking modality to the archetype that trains for it. */
function archetypeForEventModality(m: TaperModality): NextBlockSuggestion {
  switch (m) {
    case "strength":
      return {
        archetypeId: "strength_anchor",
        reason: "You have a strength event coming up — a strength block sharpens you for it.",
      };
    case "endurance":
      return {
        archetypeId: "endurance_anchor",
        reason: "You have an endurance event coming up — an endurance block builds toward it.",
      };
    case "mixed":
      return {
        archetypeId: "concurrent_hybrid",
        reason: "You have a hybrid event coming up — a hybrid block keeps both systems sharp.",
      };
  }
}

/** Leading run-length of the most-recent archetype (how many blocks in a row it's been run). */
function leadingRun(recent: ArchetypeId[]): { id: ArchetypeId | null; length: number } {
  if (recent.length === 0) return { id: null, length: 0 };
  const id = recent[0];
  let length = 1;
  for (let i = 1; i < recent.length; i++) {
    if (recent[i] === id) length++;
    else break;
  }
  return { id, length };
}

/**
 * Suggest the next archetype, or null when no rule fires confidently.
 *
 * Rule priority (first match wins):
 *   1. Recovery-aware — repeated reactive deloads ⇒ rebuild (safety first).
 *   2. Event-aware    — an upcoming A-event ⇒ the matching archetype.
 *   3. Phase sequence — a run of accumulation (hypertrophy) ⇒ consolidate
 *                       with strength (phase potentiation).
 *   4. Anti-staleness — the same archetype run to staleness ⇒ a
 *                       complementary emphasis.
 *   5. Otherwise null — let the user choose freely.
 */
export function suggestNextArchetype(
  input: SuggestNextArchetypeInput,
): NextBlockSuggestion | null {
  const { recentArchetypes, upcomingEventModality, recentReactiveDeloads } = input;

  // 1. Recovery-aware. The body is telling us it's under-recovered; route to
  //    a rebuild block before any more hard accumulation/intensification.
  if (recentReactiveDeloads >= REACTIVE_DELOAD_BACKOFF) {
    return {
      archetypeId: "rebuild",
      reason:
        "Your last few blocks needed reactive deloads — a rebuild block restores capacity before pushing again.",
    };
  }

  // 2. Event-aware. An approaching A-event overrides sequencing: train for
  //    the event's demands (modality from ADR 0008).
  if (upcomingEventModality) {
    return archetypeForEventModality(upcomingEventModality);
  }

  const run = leadingRun(recentArchetypes);

  // 3. Phase sequence — accumulation → intensification. A run of hypertrophy
  //    blocks has built a base; a strength block consolidates it (phase
  //    potentiation).
  if (run.id === "hypertrophy_anchor" && run.length >= ACCUMULATION_RUN_FOR_CONSOLIDATION) {
    return {
      archetypeId: "strength_anchor",
      reason:
        "You've run a couple of hypertrophy blocks — a strength block would consolidate those gains into the lifts.",
    };
  }

  // 4. Anti-staleness — the same archetype to staleness. Suggest a
  //    complementary emphasis so the stimulus changes.
  if (run.id && run.id !== "custom" && run.length >= STALENESS_RUN) {
    const complement = complementaryArchetype(run.id);
    if (complement) return complement;
  }

  // 5. No confident rule — stay silent; the user picks freely.
  return null;
}

/**
 * For a run of the same archetype, the complementary emphasis that changes
 * the stimulus. Returns null for archetypes where "run it again" isn't a
 * staleness concern (maintenance / rebuild are intentionally repeatable).
 */
function complementaryArchetype(id: ArchetypeId): NextBlockSuggestion | null {
  switch (id) {
    case "strength_anchor":
      return {
        archetypeId: "hypertrophy_anchor",
        reason:
          "You've stacked several strength blocks — a hypertrophy block rebuilds the muscle base that raises your future ceiling.",
      };
    case "hypertrophy_anchor":
      // A hypertrophy run is caught earlier (rule 3) → strength. Kept for
      // completeness if the consolidation threshold is ever raised above
      // the staleness threshold.
      return {
        archetypeId: "strength_anchor",
        reason:
          "You've stacked several hypertrophy blocks — a strength block expresses that new muscle as force.",
      };
    case "endurance_anchor":
      return {
        archetypeId: "concurrent_hybrid",
        reason:
          "You've run several endurance blocks — a hybrid block adds strength work to protect against the durability cost of pure volume.",
      };
    case "concurrent_hybrid":
      return {
        archetypeId: "strength_anchor",
        reason:
          "You've run several hybrid blocks — a focused strength block lets one quality lead instead of splitting the dose.",
      };
    default:
      return null;
  }
}

/**
 * Decision 6 (absorbed from ADR 0008 D5): a realization-week opportunity.
 *
 * When the user has accumulated enough consecutive strength blocks WITHOUT a
 * registered A-event, they've built strength they've never tested. Suggest
 * an OPT-IN realization microcycle (a terminal-week reshape: volume down,
 * intensity held/raised to heavy singles) before backing off — never
 * auto-applied. Gating on accumulated build (rather than firing every block)
 * is the whole point: a realization peak belongs at the end of a multi-block
 * build, not every 4-week mesocycle.
 *
 * Returns a reason string when the opportunity is earned, else null.
 */
export function suggestRealizationWeek(input: {
  recentArchetypes: ArchetypeId[];
  upcomingEventModality: TaperModality | null;
}): { reason: string } | null {
  // An upcoming event already drives a real taper/peak (ADR 0008); don't
  // also offer a synthetic realization week.
  if (input.upcomingEventModality) return null;

  const run = leadingRun(input.recentArchetypes);
  if (run.id === "strength_anchor" && run.length >= REALIZATION_MIN_STRENGTH_RUN) {
    return {
      reason:
        "You've built strength for a couple of blocks without testing it — consider a realization week (lighter volume, heavy singles) to peak before your next block.",
    };
  }
  return null;
}
