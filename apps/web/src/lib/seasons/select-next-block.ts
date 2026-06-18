/**
 * Season next-block selection (ADR 0051 amendment A4).
 *
 * A PURE, advisory scoring function: given a Season slot's target emphasis and
 * the user's context (recent block, experience, an upcoming A-event), it ranks
 * every eligible `(program, template)` candidate by descriptor fit and returns a
 * top proposal *with a plain-English reason* — or nothing, when no candidate is
 * a confident fit (silence beats a low-confidence pick). It PROPOSES, never
 * auto-applies: the user accepts or overrides in the wizard like everywhere else.
 *
 * All weights/thresholds here are CP-1 heuristics (practitioner-consensus, no
 * calibration data) with a validation plan in ADR 0051 A6: proposal-acceptance
 * rate + off-track frequency. None of this touches `buildPrescription` or any
 * CP-2 row — it only orders intentions.
 */
import type { SeasonEmphasis } from "@hta/db";
import {
  listCandidateDescriptors,
  type ArcRole,
  type CandidateDescriptor,
  type EmphasisVector,
} from "./descriptors";

/** The user/context the planner scores against. All optional — more context
 *  just sharpens the ranking; with none it still scores on emphasis + arc fit. */
export interface SelectionContext {
  /** The program just run (down-weight repeating the exact same template). */
  lastProgramId?: string | null;
  lastTemplateRef?: string | null;
  /** Coarse experience level for the eligibility gate (0 = beginner). */
  experience?: number;
  /** True when an A-priority event is near — prefer peak / arc candidates. */
  nearEvent?: boolean;
}

export interface SlotTarget {
  /** Desired quality mix for this slot (from the block's emphasis). */
  desired: EmphasisVector;
  /** Where this slot sits in the arc. */
  arcRole: ArcRole;
  /** Which quality is concentrated (bias slots prefer concurrency headroom). */
  biased: "strength" | "endurance" | null;
}

export interface RankedCandidate {
  candidate: CandidateDescriptor;
  score: number;
  reason: string;
}

export interface SelectionResult {
  /** Best confident pick, or null when nothing clears the confidence floor. */
  top: RankedCandidate | null;
  /** Full ranking (highest first) for debugging / "see other options". */
  ranked: RankedCandidate[];
}

/**
 * Map a Season emphasis tag to a scoring slot: the desired quality vector, the
 * arc role, and which quality (if any) is concentrated. CP-1 heuristic vectors.
 */
export function emphasisToSlot(emphasis: SeasonEmphasis): SlotTarget {
  switch (emphasis) {
    case "strength_bias":
      return { desired: { strength: 1.0, hypertrophy: 0.4 }, arcRole: "intensification", biased: "strength" };
    case "endurance_bias":
      return { desired: { endurance: 1.0, conditioning: 0.8 }, arcRole: "accumulation", biased: "endurance" };
    case "build":
      return { desired: { strength: 0.6, endurance: 0.5, hypertrophy: 0.5, conditioning: 0.5 }, arcRole: "accumulation", biased: null };
    case "peak":
      return { desired: { strength: 0.6, conditioning: 0.6 }, arcRole: "peak", biased: null };
    case "realize":
      return { desired: { strength: 0.8 }, arcRole: "realization", biased: null };
    case "recovery":
      return { desired: { strength: 0.3, endurance: 0.3 }, arcRole: "maintenance", biased: null };
    case "base":
    default:
      return { desired: { strength: 0.5, endurance: 0.5, conditioning: 0.4, hypertrophy: 0.4 }, arcRole: "base", biased: null };
  }
}

// ── Scoring weights (all CP-1 heuristics — practitioner-consensus, no data) ───
const W_EMPHASIS = 0.45; // heuristic — emphasis-fit weight (CP-1)
const W_ARC = 0.25; // heuristic — arc-role-fit weight (CP-1)
const W_CONCURRENCY = 0.15; // heuristic — concurrency-headroom weight, bias slots (CP-1)
const RECENCY_PENALTY = 0.3; // heuristic — down-weight the just-run template (CP-1)
const W_EVENT = 0.2; // heuristic — event-coherence bonus near an A-event (CP-1)
/** Minimum top score to make a CONFIDENT proposal; below this, return nothing. */
const MIN_CONFIDENCE = 0.5; // heuristic — confidence floor (CP-1)

const QUALITIES = ["strength", "power", "hypertrophy", "endurance", "conditioning"] as const;

/** Cosine similarity of two coarse emphasis vectors, in [0,1]. */
function emphasisFit(a: EmphasisVector, b: EmphasisVector): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (const q of QUALITIES) {
    const av = a[q] ?? 0;
    const bv = b[q] ?? 0;
    dot += av * bv;
    magA += av * av;
    magB += bv * bv;
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function headroomScore(h: "low" | "moderate" | "high"): number {
  return h === "high" ? 1 : h === "moderate" ? 0.6 : 0.2;
}

/**
 * Score + rank every eligible candidate for a slot. Pure; deterministic given
 * its inputs. Returns the ranking and the confident top pick (or null).
 */
export function selectNextBlock(
  slot: SlotTarget,
  ctx: SelectionContext = {},
): SelectionResult {
  const ranked: RankedCandidate[] = [];

  for (const candidate of listCandidateDescriptors()) {
    const d = candidate.descriptor;

    // Eligibility gate — drop candidates the user can't run yet.
    if (d.requires?.experienceMin != null && (ctx.experience ?? 0) < d.requires.experienceMin) {
      continue;
    }

    const eFit = emphasisFit(slot.desired, d.emphasis);
    const aFit = d.arcRoles.includes(slot.arcRole) ? 1 : 0;
    // Concurrency only matters for a bias slot (we must hold the other quality).
    const cFit = slot.biased ? headroomScore(d.concurrencyHeadroom) : 0.5;
    const eventFit =
      ctx.nearEvent && (slot.arcRole === "peak" || d.granularity === "arc") ? 1 : 0;
    const recent =
      ctx.lastProgramId === candidate.programId &&
      (ctx.lastTemplateRef ?? null) === candidate.templateRef;

    const score =
      W_EMPHASIS * eFit +
      W_ARC * aFit +
      W_CONCURRENCY * cFit +
      W_EVENT * eventFit -
      (recent ? RECENCY_PENALTY : 0);

    ranked.push({ candidate, score, reason: buildReason(slot, candidate, { eFit, aFit, eventFit, recent }) });
  }

  ranked.sort((a, b) => b.score - a.score);
  const top = ranked[0] && ranked[0].score >= MIN_CONFIDENCE ? ranked[0] : null;
  return { top, ranked };
}

/** Plain-English, honest rationale for the proposal (never a mandate). */
function buildReason(
  slot: SlotTarget,
  candidate: CandidateDescriptor,
  signals: { eFit: number; aFit: number; eventFit: number; recent: boolean },
): string {
  if (signals.eventFit) {
    return `Builds toward your event — ${candidate.label} carries its own race-week sequence, so nothing extra is layered on top.`;
  }
  if (slot.biased === "strength") {
    return `Leans strength while leaving room to hold your conditioning — ${candidate.label} fits a strength-focus block.`;
  }
  if (slot.biased === "endurance") {
    return `Builds your engine while strength holds at maintenance — ${candidate.label} fits an endurance-focus block.`;
  }
  if (slot.arcRole === "maintenance") {
    return `A lighter, lower-volume block — ${candidate.label} keeps your qualities ticking over while you recover.`;
  }
  if (signals.recent) {
    return `${candidate.label} matches this slot, but you just ran it — consider a change of stimulus.`;
  }
  return `${candidate.label} matches this slot's emphasis.`;
}
