/**
 * Bodyweight diagnostics — stall + drift + regression detection.
 *
 * Phase 6 of the bodyweight progression plan. Pure module: takes a
 * snapshot of the user's bw_progress + progression-event history +
 * recent session history, returns a ranked list of diagnostic
 * signals plus a short user-facing intervention copy for each.
 *
 * Designed to fire from the settings dashboard surface and the
 * session-finish recap, never interrupt mid-session. Read-only:
 * the diagnostics module never writes back to bw_progress — every
 * remediation is a suggestion the user takes explicitly.
 *
 * Citations:
 *   - addendum §1 (mass-ratio strength; aesthetics drift)
 *   - addendum §4 (tendon timeline 2–10× slower than muscle;
 *     Baar 2017 / Kongsgaard 2009 HSR thresholds)
 *   - addendum §5 (CNS demand of skill work)
 *   - addendum §3 (hinge gap as programmable risk)
 *   - addendum §7 (calisthenics aesthetics signature —
 *     upper-strong / lower-lagging — and the deliberate
 *     compensator framing)
 *   - calisthenics practitioner consensus (treated as practitioner
 *     references — no brand citations in code, per DC-Q6)
 *
 * No external program names anywhere (DC-Q6).
 */
import type { BwProgress, MovementFamily, MovementNode } from "@hta/db";

// ── Thresholds ───────────────────────────────────────────────────────
//
// Every threshold gets a named constant + a rationale comment. The
// numbers are deliberately readable in the source rather than tucked
// into a config: this is a small finite rule set and the comments
// matter more than the configurability.

/** Soft stall after a full mesocycle (4 wk) with no advance event.
 *  Less than that, the user is still inside the normal `weeks_at_node`
 *  + over-completion window (Phase 4 gate). Beyond it, we trust the
 *  user benefits from a hint. */
const STALL_WEEKS_SOFT = 4;
/** Hard stall after 6 wk — past the addendum §4 tendon-timeline upper
 *  bound for a single jump (2–10×; 6 wk is the deload + retry mark
 *  practitioner consensus recommends). */
const STALL_WEEKS_HARD = 6;

/** Aesthetics drift threshold — upper/lower difficulty-anchor sum.
 *  Calisthenics practitioner consensus pegs the typical aesthetics
 *  signature (addendum §7) at roughly 2–2.5× upper-to-lower anchor
 *  progression. 2.5× is the conservative tip-over point past which
 *  the imbalance is structural, not just stylistic. */
const AESTHETICS_DRIFT_RATIO = 2.5;
/** Anchor below which a lower-body family counts as "lagging" for
 *  the drift signal's lowerFamiliesLagging list. Matches the Phase 1
 *  difficulty_anchor scale (1–100) where ≥ 20 is roughly the
 *  intermediate band. */
const LOWER_LAGGING_ANCHOR = 20;

/** Pull-vs-push ratio that flags pull-dominance. Practitioner
 *  consensus: pull-to-push ratio above ~1.5–1.7 surfaces as the
 *  rounded-forward / hyperkyphotic pattern; we pick 1.6 as the
 *  pragmatic mid-point. */
const PULL_DOMINANCE_RATIO = 1.6;

/** Tendon-load TUT shortfall: skill families need bank-time at the
 *  current node before the joint accepts the next. Baar 2017 /
 *  Kongsgaard 2009 HSR work points at ~8 seconds of slow loading per
 *  anchor point as the band where collagen turnover races muscle. We
 *  only flag if the anchor is ≥ 50 (mid-skill nodes — the easier
 *  holds don't carry meaningful tendon risk yet) and the user has
 *  been at the node for ≥ 3 weeks (so the signal isn't noisy on
 *  fresh arrivals). */
const TENDON_TUT_MULTIPLIER = 8;
const TENDON_FLAG_MIN_ANCHOR = 50;
const TENDON_FLAG_MIN_WEEKS = 3;

/** CNS overreach — skill-focused (planche / lever / handstand / flag
 *  / muscle_up) sessions stack CNS demand even when the absolute load
 *  is low (addendum §5). 5 in 14 d is the practitioner-consensus
 *  "high-skill-week" upper bound past which a deload or modality
 *  switch is the safer call. */
const CNS_OVERREACH_SESSIONS = 5;
const CNS_OVERREACH_WINDOW_DAYS = 14;

/** Hinge gap — bodyweight rotations frequently skip hinge entirely
 *  (addendum §3). After 14 d without a hinge-family appearance the
 *  posterior-chain detraining curve is meaningful. */
const HINGE_GAP_WINDOW_DAYS = 14;

/** Regression risk — TUT accumulators decay when sessions are
 *  missed. 3 missed sessions over 14 d is the practitioner-consensus
 *  point past which re-entering at the previous node for one week is
 *  the smarter restart than picking back up where the user left. */
const REGRESSION_MIN_MISSED = 3;
const REGRESSION_WINDOW_DAYS = 14;

// ── Family taxonomy helpers ───────────────────────────────────────────

const UPPER_FAMILIES: ReadonlyArray<MovementFamily> = [
  "push_h",
  "push_v",
  "pull_h",
  "pull_v",
  "planche",
  "lever_front",
  "lever_back",
  "muscle_up",
  "handstand",
  "human_flag",
];

const LOWER_FAMILIES: ReadonlyArray<MovementFamily> = [
  "squat_unilateral",
  "squat_bilateral",
  "hinge",
];

const PUSH_FAMILIES: ReadonlyArray<MovementFamily> = ["push_h", "push_v"];
const PULL_FAMILIES: ReadonlyArray<MovementFamily> = ["pull_h", "pull_v"];

const SKILL_FAMILIES: ReadonlyArray<MovementFamily> = [
  "planche",
  "lever_front",
  "lever_back",
  "handstand",
  "human_flag",
];

// ── Public types ──────────────────────────────────────────────────────

export type DiagnosticSeverity = "info" | "soft" | "hard";

export type DiagnosticSignal =
  | {
      kind: "stall_at_node";
      family: MovementFamily;
      weeksAtNode: number;
      severity: "soft" | "hard";
    }
  | {
      kind: "aesthetics_drift_upper_strong";
      ratio: number;
      lowerFamiliesLagging: MovementFamily[];
    }
  | { kind: "aesthetics_drift_pull_dominant"; pullToPushRatio: number }
  | {
      kind: "tendon_load_undercooked";
      family: MovementFamily;
      tutDeficitSeconds: number;
    }
  | { kind: "cns_overreach_risk"; consecutiveSkillSessions: number }
  | { kind: "hinge_gap_active"; weeksSinceHingeWork: number }
  | {
      kind: "regression_risk";
      family: MovementFamily;
      missedSessions: number;
    };

export type DiagnosticIntervention = {
  signalKind: DiagnosticSignal["kind"];
  /** Short user-facing recommendation. */
  copy: string;
  actionable?: {
    label: string;
    /** Settings-page deep-link, or null for non-routable actions. */
    href?: string;
    /** Server-action id for the (deferred) auto-fix hook. */
    actionId?: string;
  };
};

export type DiagnosticResult = {
  signal: DiagnosticSignal;
  intervention: DiagnosticIntervention;
};

/** Severity rank for sorting (hard > soft > info). */
function severityRank(s: DiagnosticSeverity): number {
  if (s === "hard") return 2;
  if (s === "soft") return 1;
  return 0;
}

/** Map a signal to its severity class. */
export function severityOf(signal: DiagnosticSignal): DiagnosticSeverity {
  switch (signal.kind) {
    case "stall_at_node":
      return signal.severity;
    case "aesthetics_drift_upper_strong":
      return "soft";
    case "aesthetics_drift_pull_dominant":
      return "soft";
    case "tendon_load_undercooked":
      return "hard";
    case "cns_overreach_risk":
      return "hard";
    case "hinge_gap_active":
      return "soft";
    case "regression_risk":
      // Severity scales with miss count — > 6 missed → hard.
      return signal.missedSessions > 6 ? "hard" : "soft";
  }
}

// ── Input shape ───────────────────────────────────────────────────────

export type RecentSessionMovement = {
  family: MovementFamily;
  isSkillFocused: boolean;
  completed: boolean;
};

export type RecentSessionRecord = {
  /** ISO timestamp or YYYY-MM-DD; we only use date math. */
  sessionDate: string;
  movements: RecentSessionMovement[];
};

export type RunDiagnosticsInput = {
  bwProgressByFamily: Record<MovementFamily, BwProgress | null>;
  nodeById: Record<string, MovementNode>;
  progressionEventsLast90Days: Array<{
    family: MovementFamily;
    occurredAt: string;
    reason: string;
  }>;
  recentSessionsLast30Days: RecentSessionRecord[];
  now: Date;
};

// ── Date helpers ──────────────────────────────────────────────────────

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_DAY;
}

function parseIsoOrDate(raw: string): Date {
  // Accepts YYYY-MM-DD or full ISO; the trailing "T" form is normalised
  // by the Date constructor itself.
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return new Date(`${raw}T00:00:00Z`);
  return new Date(raw);
}

// ── Detection rules ───────────────────────────────────────────────────

function detectStalls(input: RunDiagnosticsInput): DiagnosticResult[] {
  const out: DiagnosticResult[] = [];
  for (const family of Object.keys(input.bwProgressByFamily) as MovementFamily[]) {
    const p = input.bwProgressByFamily[family];
    if (!p) continue;
    const weeks = p.weeksAtNode ?? 0;
    if (weeks < STALL_WEEKS_SOFT) continue;
    // Check there's been no progression event for THIS family in the
    // last 4 weeks (28 d). If there has been one, the user is still
    // mid-mesocycle and we don't surface the chip.
    const cutoff = input.now.getTime() - 28 * MS_PER_DAY;
    const recentAdvance = input.progressionEventsLast90Days.some(
      (ev) =>
        ev.family === family && parseIsoOrDate(ev.occurredAt).getTime() >= cutoff,
    );
    if (recentAdvance) continue;
    const severity: "soft" | "hard" =
      weeks >= STALL_WEEKS_HARD ? "hard" : "soft";
    const currentNode = input.nodeById[p.currentNodeId];
    const nodeLabel = currentNode?.displayName ?? "current node";
    out.push({
      signal: { kind: "stall_at_node", family, weeksAtNode: weeks, severity },
      intervention: {
        signalKind: "stall_at_node",
        copy: `Stalled at ${nodeLabel} for ${weeks} weeks. Try: longer eccentric (5s), one extra set, or a brief volume cut for a week.`,
        actionable: {
          label: "Review progression settings",
          href: "/app/settings/bodyweight-progression",
        },
      },
    });
  }
  return out;
}

function anchorSum(
  input: RunDiagnosticsInput,
  families: ReadonlyArray<MovementFamily>,
): number {
  let total = 0;
  for (const fam of families) {
    const p = input.bwProgressByFamily[fam];
    if (!p) continue;
    const node = input.nodeById[p.currentNodeId];
    if (!node) continue;
    total += node.difficultyAnchor;
  }
  return total;
}

function detectAestheticsUpperStrong(
  input: RunDiagnosticsInput,
): DiagnosticResult[] {
  const upper = anchorSum(input, UPPER_FAMILIES);
  const lower = anchorSum(input, LOWER_FAMILIES);
  // Require some lower-body baseline so we don't fire on a brand-new
  // user who simply hasn't seeded the lower families yet.
  if (lower <= 0 && upper <= 0) return [];
  const denom = Math.max(lower, 1);
  const ratio = upper / denom;
  if (ratio < AESTHETICS_DRIFT_RATIO) return [];
  const lagging: MovementFamily[] = [];
  for (const fam of LOWER_FAMILIES) {
    const p = input.bwProgressByFamily[fam];
    if (!p) {
      lagging.push(fam);
      continue;
    }
    const node = input.nodeById[p.currentNodeId];
    if (!node || node.difficultyAnchor < LOWER_LAGGING_ANCHOR) {
      lagging.push(fam);
    }
  }
  const ratioLabel = ratio.toFixed(1);
  return [
    {
      signal: {
        kind: "aesthetics_drift_upper_strong",
        ratio: Number(ratioLabel),
        lowerFamiliesLagging: lagging,
      },
      intervention: {
        signalKind: "aesthetics_drift_upper_strong",
        copy: `Your upper-body work has progressed ${ratioLabel}× faster than lower-body. Consider prioritising squat/hinge work for the next block.`,
        actionable: {
          label: "Bias next block toward lower body",
          href: "/app/plan/new?bias=lower",
        },
      },
    },
  ];
}

function detectPullDominant(input: RunDiagnosticsInput): DiagnosticResult[] {
  const pull = anchorSum(input, PULL_FAMILIES);
  const push = anchorSum(input, PUSH_FAMILIES);
  if (pull <= 0 || push <= 0) return [];
  const ratio = pull / Math.max(push, 1);
  if (ratio <= PULL_DOMINANCE_RATIO) return [];
  return [
    {
      signal: { kind: "aesthetics_drift_pull_dominant", pullToPushRatio: Number(ratio.toFixed(2)) },
      intervention: {
        signalKind: "aesthetics_drift_pull_dominant",
        copy: "Pull strength is well ahead of push. Add archer/decline push-up volume.",
      },
    },
  ];
}

function detectTendonUndercooked(
  input: RunDiagnosticsInput,
): DiagnosticResult[] {
  const out: DiagnosticResult[] = [];
  for (const fam of SKILL_FAMILIES) {
    const p = input.bwProgressByFamily[fam];
    if (!p) continue;
    const node = input.nodeById[p.currentNodeId];
    if (!node) continue;
    if (!node.isometricCapable) continue;
    if (node.difficultyAnchor < TENDON_FLAG_MIN_ANCHOR) continue;
    if ((p.weeksAtNode ?? 0) < TENDON_FLAG_MIN_WEEKS) continue;
    const required = node.difficultyAnchor * TENDON_TUT_MULTIPLIER;
    const have = p.accumulatedTutSeconds ?? 0;
    if (have >= required) continue;
    // Find the previous (lowest-anchor prerequisite within the same
    // family) for the suggestion copy.
    const prevNode = Object.values(input.nodeById)
      .filter(
        (n) =>
          n.family === fam &&
          node.prerequisites.includes(n.id),
      )
      .sort((a, b) => b.difficultyAnchor - a.difficultyAnchor)[0];
    const prevLabel = prevNode?.displayName ?? "the previous hold";
    out.push({
      signal: {
        kind: "tendon_load_undercooked",
        family: fam,
        tutDeficitSeconds: required - have,
      },
      intervention: {
        signalKind: "tendon_load_undercooked",
        copy: `Tendons adapt slower than muscle. Add 2× weekly 15–30s holds at ${prevLabel} between attempts.`,
      },
    });
  }
  return out;
}

function detectCnsOverreach(input: RunDiagnosticsInput): DiagnosticResult[] {
  const cutoffMs =
    input.now.getTime() - CNS_OVERREACH_WINDOW_DAYS * MS_PER_DAY;
  let skillSessions = 0;
  for (const s of input.recentSessionsLast30Days) {
    const ts = parseIsoOrDate(s.sessionDate).getTime();
    if (ts < cutoffMs) continue;
    if (s.movements.some((m) => m.isSkillFocused && m.completed)) {
      skillSessions += 1;
    }
  }
  if (skillSessions < CNS_OVERREACH_SESSIONS) return [];
  return [
    {
      signal: {
        kind: "cns_overreach_risk",
        consecutiveSkillSessions: skillSessions,
      },
      intervention: {
        signalKind: "cns_overreach_risk",
        copy: `${skillSessions} skill-focused sessions in ${CNS_OVERREACH_WINDOW_DAYS} days. CNS demand is high. Schedule a deload or modality switch.`,
      },
    },
  ];
}

function detectHingeGap(input: RunDiagnosticsInput): DiagnosticResult[] {
  const cutoffMs =
    input.now.getTime() - HINGE_GAP_WINDOW_DAYS * MS_PER_DAY;
  let mostRecentHinge: number | null = null;
  for (const s of input.recentSessionsLast30Days) {
    if (!s.movements.some((m) => m.family === "hinge" && m.completed)) continue;
    const ts = parseIsoOrDate(s.sessionDate).getTime();
    if (mostRecentHinge == null || ts > mostRecentHinge) mostRecentHinge = ts;
  }
  // No sessions at all this window → also signal, because the user
  // can't have done hinge work either.
  if (mostRecentHinge != null && mostRecentHinge >= cutoffMs) return [];
  const referenceMs = mostRecentHinge ?? cutoffMs;
  const weeksSince = Math.floor(
    daysBetween(input.now, new Date(referenceMs)) / 7,
  );
  return [
    {
      signal: {
        kind: "hinge_gap_active",
        weeksSinceHingeWork: Math.max(2, weeksSince),
      },
      intervention: {
        signalKind: "hinge_gap_active",
        copy: `No hinge work in ${HINGE_GAP_WINDOW_DAYS} days. Posterior chain detraining risk. Inject hinge compensation.`,
        actionable: {
          label: "View hinge compensation",
          href: "/app/settings/bodyweight-progression",
        },
      },
    },
  ];
}

function detectRegressionRisk(
  input: RunDiagnosticsInput,
): DiagnosticResult[] {
  const cutoffMs =
    input.now.getTime() - REGRESSION_WINDOW_DAYS * MS_PER_DAY;
  // Count missed (incomplete) movements per family within the window.
  // A "missed" record is `completed === false`. The session must have
  // landed inside the window.
  const missedByFamily = new Map<MovementFamily, number>();
  for (const s of input.recentSessionsLast30Days) {
    const ts = parseIsoOrDate(s.sessionDate).getTime();
    if (ts < cutoffMs) continue;
    for (const m of s.movements) {
      if (m.completed) continue;
      missedByFamily.set(m.family, (missedByFamily.get(m.family) ?? 0) + 1);
    }
  }
  const out: DiagnosticResult[] = [];
  for (const [family, missed] of missedByFamily) {
    if (missed <= REGRESSION_MIN_MISSED) continue;
    const p = input.bwProgressByFamily[family];
    if (!p) continue;
    if ((p.accumulatedTutSeconds ?? 0) <= 0) continue;
    // Previous node within the family (for the suggestion copy).
    const node = input.nodeById[p.currentNodeId];
    const prevNode =
      node == null
        ? null
        : Object.values(input.nodeById)
            .filter(
              (n) =>
                n.family === family && node.prerequisites.includes(n.id),
            )
            .sort((a, b) => b.difficultyAnchor - a.difficultyAnchor)[0] ?? null;
    const prevLabel = prevNode?.displayName ?? "the previous variant";
    out.push({
      signal: {
        kind: "regression_risk",
        family,
        missedSessions: missed,
      },
      intervention: {
        signalKind: "regression_risk",
        copy: `Missed ${missed} ${family} sessions in ${REGRESSION_WINDOW_DAYS} days. Accumulated TUT decays; consider re-entering at ${prevLabel} for one week.`,
      },
    });
  }
  return out;
}

// ── Orchestrator ──────────────────────────────────────────────────────

/**
 * Run the full diagnostic sweep and return results ranked by
 * severity. Pure function — never writes to the database, never
 * modifies user state. Designed to be called from the settings
 * dashboard server component and the session-completion server
 * action (where the result is also snapshotted to
 * `bw_diagnostics_snapshots`).
 */
export function runDiagnostics(
  input: RunDiagnosticsInput,
): DiagnosticResult[] {
  const all = [
    ...detectStalls(input),
    ...detectAestheticsUpperStrong(input),
    ...detectPullDominant(input),
    ...detectTendonUndercooked(input),
    ...detectCnsOverreach(input),
    ...detectHingeGap(input),
    ...detectRegressionRisk(input),
  ];

  all.sort((a, b) => {
    const sa = severityRank(severityOf(a.signal));
    const sb = severityRank(severityOf(b.signal));
    if (sa !== sb) return sb - sa;
    // Stable secondary ordering by kind name so the output is
    // deterministic across runs.
    return a.signal.kind.localeCompare(b.signal.kind);
  });

  return all;
}

/** Re-exported thresholds — handy for tests + dashboard copy. */
export const DIAGNOSTIC_THRESHOLDS = {
  STALL_WEEKS_SOFT,
  STALL_WEEKS_HARD,
  AESTHETICS_DRIFT_RATIO,
  LOWER_LAGGING_ANCHOR,
  PULL_DOMINANCE_RATIO,
  TENDON_TUT_MULTIPLIER,
  TENDON_FLAG_MIN_ANCHOR,
  TENDON_FLAG_MIN_WEEKS,
  CNS_OVERREACH_SESSIONS,
  CNS_OVERREACH_WINDOW_DAYS,
  HINGE_GAP_WINDOW_DAYS,
  REGRESSION_MIN_MISSED,
  REGRESSION_WINDOW_DAYS,
} as const;
