/**
 * Next-block suggestion nudge (ADR 0010) — lightweight macrocycle guidance.
 *
 * The platform is a mesocycle generator: it builds one well-formed block at a
 * time and stops. There is no annual planner and deliberately won't be one
 * (ADR 0010 rejected a Gantt-style timeline). Instead, at the moment the user
 * is finishing a block, we surface ONE dismissible suggestion for which PROGRAM
 * to run next with a one-line reason. It pre-selects but never forces; the full
 * manual choice is always available in the program picker.
 *
 * De-archetype note (ADR 0046): this nudge predates the program platform and
 * used to suggest one of the six legacy archetypes. New blocks are created via
 * the program picker (5/3/1, Tactical Barbell, Green Protocol, Hybrid) and store
 * `archetype` NULL, so suggesting an archetype name pointed the user at a block
 * they could no longer create. The suggestion now speaks the program lineup and
 * the CTA deep-links into the matching picker card.
 *
 * Everything here is PURE and advice-only: it reads recent program history + the
 * upcoming A-event modality + recent reactive-deload count, and returns a
 * suggestion or null. It never touches `buildPrescription`, the engines, or any
 * completion path. Returning `null` (no confident rule fires) is a feature —
 * silence beats a low-confidence nudge.
 *
 * Evidence base (all MODERATE, framework-level — not RCT-grade, so the copy and
 * the constants both say "heuristic"):
 *   - Block periodization (Issurin 2010; Bompa): vary the emphasis between
 *     concentrated blocks rather than running one stimulus indefinitely.
 *   - Variation of emphasis drives continued adaptation; an identical stimulus
 *     run indefinitely stalls.
 *   - Event-specific peaking is handled by ADR 0008; the nudge just routes the
 *     user toward the matching program ahead of an event.
 */
import { getProgramEngine, getNativeProgramEngine } from "@/lib/platform/registry";
import type { TaperModality } from "./taper";

// heuristic — periodization sequencing thresholds (CP-1), practitioner-consensus.
// None of these are RCT-calibrated; they encode coaching convention and must
// not be treated as precise. See ADR 0010.
/** ≥ this many recent reactive deloads ⇒ back off to a block you can run lighter. */
const REACTIVE_DELOAD_BACKOFF = 2;
/** Same program this many times in a row ⇒ surface an anti-staleness nudge. */
const STALENESS_RUN = 3;
/** ≥ this many consecutive strength-program blocks (event-less) ⇒ a realization week is earned. */
const REALIZATION_MIN_STRENGTH_RUN = 2;

/** The user-selectable programs the nudge can route to (matches the picker). */
export type SuggestProgramId =
  | "wendler-531"
  | "tactical-barbell"
  | "green-protocol"
  | "hybrid";

/** Membership set for filtering recent block program ids to the known lineup. */
export const KNOWN_SUGGEST_PROGRAMS: ReadonlySet<string> = new Set<SuggestProgramId>([
  "wendler-531",
  "tactical-barbell",
  "green-protocol",
  "hybrid",
]);

export type NextBlockSuggestion = {
  /** Stable program id — also the picker deep-link (`/app/program?program=<id>`). */
  programId: SuggestProgramId;
  /** Display name resolved from the program registry (single source of truth). */
  programName: string;
  /** One-sentence, suggestion-framed rationale (never a mandate). */
  reason: string;
};

export type SuggestNextProgramInput = {
  /**
   * Recent block programs, MOST-RECENT FIRST. Unknown / legacy entries are
   * filtered out at the read boundary (they break runs — a block outside the
   * known lineup is not part of a sequence). Typically the last 3–4 blocks.
   */
  recentPrograms: SuggestProgramId[];
  /**
   * Peaking modality of the next upcoming A-priority event, or null when no
   * A-event is on the horizon. Derived from the event via ADR 0008's
   * `taperModalityForEvent`.
   */
  upcomingEventModality: TaperModality | null;
  /** Count of reactive (auto-triggered) deloads in the recent window. */
  recentReactiveDeloads: number;
};

/** Resolve a program's display name from the registry (foreign or native engine). */
function resolveProgramName(programId: SuggestProgramId): string {
  const meta =
    getProgramEngine(programId)?.meta ?? getNativeProgramEngine(programId)?.meta;
  return meta?.name ?? programId;
}

/** Build a suggestion, resolving the display name from the registry. */
function suggest(programId: SuggestProgramId, reason: string): NextBlockSuggestion {
  return { programId, programName: resolveProgramName(programId), reason };
}

/** Map an upcoming A-event's peaking modality to the program that trains for it. */
function programForEventModality(m: TaperModality): NextBlockSuggestion {
  switch (m) {
    case "strength":
      return suggest(
        "wendler-531",
        "You have a strength event coming up — a focused strength cycle sharpens you for it.",
      );
    case "endurance":
      return suggest(
        "green-protocol",
        "You have an endurance event coming up — an endurance-led block builds toward it.",
      );
    case "mixed":
      return suggest(
        "hybrid",
        "You have a hybrid event coming up — a balanced block keeps both engines sharp.",
      );
  }
}

/** Leading run-length of the most-recent program (how many blocks in a row it's been run). */
function leadingRun(recent: SuggestProgramId[]): {
  id: SuggestProgramId | null;
  length: number;
} {
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
 * Suggest the next program, or null when no rule fires confidently.
 *
 * Rule priority (first match wins):
 *   1. Recovery-aware — repeated reactive deloads ⇒ a balanced block the user
 *      can dial back (safety first).
 *   2. Event-aware    — an upcoming A-event ⇒ the program that trains for it.
 *   3. Anti-staleness — the same program run to staleness ⇒ a complementary
 *      emphasis so the stimulus changes.
 *   4. Otherwise null — let the user choose freely.
 */
export function suggestNextProgram(
  input: SuggestNextProgramInput,
): NextBlockSuggestion | null {
  const { recentPrograms, upcomingEventModality, recentReactiveDeloads } = input;

  // 1. Recovery-aware. The body is telling us it's under-recovered; route to a
  //    balanced block that can be run lighter before any more hard pushing.
  if (recentReactiveDeloads >= REACTIVE_DELOAD_BACKOFF) {
    return suggest(
      "hybrid",
      "Your last few blocks needed reactive deloads — a balanced block you can dial back (fewer days, lower intensity) restores capacity before pushing again.",
    );
  }

  // 2. Event-aware. An approaching A-event overrides sequencing: train for the
  //    event's demands (modality from ADR 0008).
  if (upcomingEventModality) {
    return programForEventModality(upcomingEventModality);
  }

  // 3. Anti-staleness — the same program to staleness. Suggest a complementary
  //    emphasis so the stimulus changes.
  const run = leadingRun(recentPrograms);
  if (run.id && run.length >= STALENESS_RUN) {
    return complementaryProgram(run.id);
  }

  // 4. No confident rule — stay silent; the user picks freely.
  return null;
}

/**
 * For a run of the same program, the complementary emphasis that changes the
 * stimulus. A pure-strength run earns conditioning; an endurance-led or balanced
 * run earns a focused strength cycle.
 */
function complementaryProgram(id: SuggestProgramId): NextBlockSuggestion | null {
  switch (id) {
    case "wendler-531":
      return suggest(
        "hybrid",
        "You've stacked several strength cycles — a balanced block adds the conditioning that pure strength work neglects.",
      );
    case "hybrid":
      return suggest(
        "wendler-531",
        "You've run several balanced blocks — a focused strength cycle lets one quality lead instead of splitting the dose.",
      );
    case "tactical-barbell":
      return suggest(
        "hybrid",
        "You've run the same block for a while — a balanced build-your-own block changes the stimulus.",
      );
    case "green-protocol":
      return suggest(
        "wendler-531",
        "You've run several endurance-led blocks — a focused strength cycle rebuilds the strength that high aerobic volume erodes.",
      );
    default:
      return null;
  }
}

/**
 * Decision 6 (absorbed from ADR 0008 D5): a realization-week opportunity.
 *
 * When the user has run enough consecutive strength-program blocks WITHOUT a
 * registered A-event, they've built strength they've never tested. We surface
 * ADVICE to run an opt-in realization microcycle (lighter volume, heavy singles)
 * before backing off. Advice-only: the engine does NOT auto-build or auto-reshape
 * a realization week.
 *
 * Returns a reason string when the opportunity is earned, else null.
 */
export function suggestRealizationWeek(input: {
  recentPrograms: SuggestProgramId[];
  upcomingEventModality: TaperModality | null;
}): { reason: string } | null {
  // An upcoming event already drives a real taper/peak (ADR 0008); don't also
  // offer a synthetic realization week.
  if (input.upcomingEventModality) return null;

  const run = leadingRun(input.recentPrograms);
  if (run.id === "wendler-531" && run.length >= REALIZATION_MIN_STRENGTH_RUN) {
    return {
      reason:
        "You've built strength for a couple of cycles without testing it. Before your next block, consider a lighter week of heavy singles to peak and re-test your maxes.",
    };
  }
  return null;
}
