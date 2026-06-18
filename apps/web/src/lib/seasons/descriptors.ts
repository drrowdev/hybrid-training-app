/**
 * Periodization descriptors (ADR 0051 amendment A2–A5).
 *
 * Each sequenceable training option — a program, and where it matters a specific
 * template within it — describes *where it sits in a training arc* via a small,
 * coarse descriptor. The Season planner then reasons GENERICALLY over these
 * descriptors (see `select-next-block.ts`) instead of hard-coding "if TB and
 * week 6 use Zulu" rules. Adding a new program later means shipping its
 * descriptor here; the planner picks it up with zero changes.
 *
 * This is METADATA, not engine math — coarse bands + one-sig-fig weights, all
 * CP-1 heuristics (practitioner-consensus, no RCT values). It never enters
 * `buildPrescription`, the ceiling chain, or any CP-2 row. Per ADR 0051 A6 the
 * descriptors are reviewed like copy. They live in one place for Phase 1; they
 * could later migrate onto each engine's `meta` (the registry) without changing
 * the planner, which only consumes the resolved descriptor.
 */

/** Coarse quality weights (0..1, one sig fig). Absent = the quality isn't a focus. */
export interface EmphasisVector {
  strength?: number;
  power?: number;
  hypertrophy?: number;
  endurance?: number;
  conditioning?: number;
}

/** Where an option naturally sits in a training arc (a SET — many fit several). */
export type ArcRole =
  | "base"
  | "accumulation"
  | "intensification"
  | "realization"
  | "peak"
  | "maintenance";

export type Band = "low" | "moderate" | "high";

/** Some programs ARE arcs (they self-sequence multiple phases); others are a
 *  single sequenceable block. The planner must not wrap extra periodization
 *  around an `arc` (that would double-periodize — ADR 0051 A3). */
export type Granularity = "block" | "arc";

export interface PeriodizationDescriptor {
  /** Qualities developed, coarse weights (CP-1 heuristic, one sig fig). */
  emphasis: EmphasisVector;
  /** Arc positions this option fits. */
  arcRoles: ArcRole[];
  /** Sessions/week band. */
  frequencyBand: Band;
  /** Weekly volume band. */
  volumeBand: Band;
  /** Room to run the OTHER quality alongside (the maintenance-floor lever). */
  concurrencyHeadroom: Band;
  granularity: Granularity;
  /** Optional eligibility gate, reusing existing experience/equipment gates. */
  requires?: { experienceMin?: number };
}

/** A resolved, selectable Season candidate (program + optional template). */
export interface CandidateDescriptor {
  programId: string;
  templateRef: string | null;
  /** Human label for the reason string (e.g. "Tactical Barbell · Zulu"). */
  label: string;
  descriptor: PeriodizationDescriptor;
}

/**
 * The descriptor catalogue, grounded against today's program lineup (ADR 0051
 * A5). Weights are illustrative one-sig-fig heuristics — CP-1, practitioner-
 * consensus, no calibration data. Program-level entries use templateRef `null`;
 * template-level entries refine the program for a specific variant.
 */
const CATALOG: CandidateDescriptor[] = [
  // ── Hybrid (native, block) — balanced concurrent, bias-tunable ─────────────
  {
    programId: "hybrid",
    templateRef: null,
    label: "Hybrid",
    descriptor: {
      // heuristic — balanced concurrent (CP-1), practitioner-consensus
      emphasis: { strength: 0.5, hypertrophy: 0.4, endurance: 0.5, conditioning: 0.5 },
      arcRoles: ["base", "accumulation"],
      frequencyBand: "moderate",
      volumeBand: "moderate",
      concurrencyHeadroom: "high",
      granularity: "block",
    },
  },

  // ── 5/3/1 (block) — strength-leaning ──────────────────────────────────────
  {
    programId: "wendler-531",
    templateRef: "5spro-fsl",
    label: "5/3/1 · 5's PRO + FSL",
    descriptor: {
      // heuristic — strength-dominant, low-fatigue (CP-1)
      emphasis: { strength: 0.8, hypertrophy: 0.3 },
      arcRoles: ["accumulation", "intensification"],
      frequencyBand: "moderate",
      volumeBand: "moderate",
      concurrencyHeadroom: "moderate",
      granularity: "block",
    },
  },
  {
    programId: "wendler-531",
    templateRef: "bbb-leader",
    label: "5/3/1 · Boring But Big",
    descriptor: {
      // heuristic — high supplemental volume, hypertrophy lean (CP-1)
      emphasis: { strength: 0.6, hypertrophy: 0.7 },
      arcRoles: ["accumulation"],
      frequencyBand: "moderate",
      volumeBand: "high",
      concurrencyHeadroom: "low",
      granularity: "block",
    },
  },
  {
    programId: "wendler-531",
    templateRef: "original-531-fsl",
    label: "5/3/1 + FSL",
    descriptor: {
      // heuristic — AMRAP top sets, strength expression (CP-1)
      emphasis: { strength: 0.8, hypertrophy: 0.3 },
      arcRoles: ["intensification"],
      frequencyBand: "moderate",
      volumeBand: "moderate",
      concurrencyHeadroom: "moderate",
      granularity: "block",
    },
  },

  // ── Tactical Barbell (block) — strength with conditioning headroom ─────────
  {
    programId: "tactical-barbell",
    templateRef: "operator",
    label: "Tactical Barbell · Operator",
    descriptor: {
      // heuristic — 3-day strength, leaves room for conditioning (CP-1)
      emphasis: { strength: 0.7 },
      arcRoles: ["intensification", "maintenance"],
      frequencyBand: "moderate",
      volumeBand: "moderate",
      concurrencyHeadroom: "high",
      granularity: "block",
    },
  },
  {
    programId: "tactical-barbell",
    templateRef: "fighter",
    label: "Tactical Barbell · Fighter",
    descriptor: {
      // heuristic — 2-day minimalist, strength maintenance (CP-1)
      emphasis: { strength: 0.6 },
      arcRoles: ["maintenance"],
      frequencyBand: "low",
      volumeBand: "low",
      concurrencyHeadroom: "high",
      granularity: "block",
    },
  },
  {
    programId: "tactical-barbell",
    templateRef: "zulu",
    label: "Tactical Barbell · Zulu",
    descriptor: {
      // heuristic — 4-day, higher volume, accumulation (CP-1)
      emphasis: { strength: 0.7, hypertrophy: 0.5 },
      arcRoles: ["accumulation"],
      frequencyBand: "high",
      volumeBand: "high",
      concurrencyHeadroom: "moderate",
      granularity: "block",
    },
  },

  // ── Green Protocol (arc) — concurrent strength + endurance, self-sequences ─
  {
    programId: "green-protocol",
    templateRef: null,
    label: "Green Protocol",
    descriptor: {
      // heuristic — endurance-led concurrent, self-periodizes base→build→peak (CP-1)
      emphasis: { endurance: 0.6, strength: 0.5, conditioning: 0.6 },
      arcRoles: ["base", "accumulation", "peak"],
      frequencyBand: "moderate",
      volumeBand: "moderate",
      concurrencyHeadroom: "high",
      granularity: "arc",
    },
  },

  // ── HYROX (arc) — conditioning-dominant race build, self-sequences to race ─
  {
    programId: "hyrox",
    templateRef: null,
    label: "HYROX",
    descriptor: {
      // heuristic — conditioning-led race build, self-periodizes to race week (CP-1)
      emphasis: { conditioning: 0.9, endurance: 0.7, strength: 0.4 },
      arcRoles: ["accumulation", "peak"],
      frequencyBand: "high",
      volumeBand: "high",
      concurrencyHeadroom: "moderate",
      granularity: "arc",
    },
  },
];

/** Every sequenceable candidate (program + template), for the planner to score. */
export function listCandidateDescriptors(): CandidateDescriptor[] {
  return CATALOG.map((c) => ({ ...c }));
}

/**
 * Resolve the descriptor for a (program, template). Prefers an exact
 * template-level entry; falls back to the program's first entry (its default
 * variant) when the template is unknown/null. Returns null for an unknown
 * program (the planner then simply skips it).
 */
export function getDescriptor(
  programId: string,
  templateRef?: string | null,
): PeriodizationDescriptor | null {
  if (templateRef) {
    const exact = CATALOG.find(
      (c) => c.programId === programId && c.templateRef === templateRef,
    );
    if (exact) return exact.descriptor;
  }
  const programLevel =
    CATALOG.find((c) => c.programId === programId && c.templateRef === null) ??
    CATALOG.find((c) => c.programId === programId);
  return programLevel?.descriptor ?? null;
}

/** Whether a program self-periodizes (an `arc` — the planner won't wrap phases around it). */
export function isArcProgram(programId: string): boolean {
  const d = getDescriptor(programId);
  return d?.granularity === "arc";
}
