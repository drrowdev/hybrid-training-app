/**
 * HYROX — ProgramEngine over `@hta/program-core` (ADR 0050).
 *
 * HYROX is a periodized, event-targeted, CONCURRENT endurance + strength-endurance
 * program built for the standardized HYROX race (8 × 1 km runs alternating with 8
 * functional stations). It is implemented in the SAME architectural style as Green
 * Protocol — a phase-grid + a typed session/station vocabulary, fixed schedule — but
 * shares NO code with `@hta/green`: it owns its own grids, its own vocabulary, and
 * (unlike GP) its own station-specific strength (no Tactical Barbell delegation).
 *
 * Calibration (CP-1…CP-5): this engine introduces NO new physiological coefficient.
 * The periodization week-splits / per-level session counts below are `[DEF]`
 * programming-schedule defaults (coach consensus — RoxLyfe / HYROX365 / Weersma),
 * conservative and user-overridable, NOT calibrated physiology. All actual load math
 * (interference, freshness, deload, taper) is the existing platform engine.
 *
 * `timeline` walks the generated phase grid (step 4); `prescribe` renders each
 * ref via the per-category builders in `prescription.ts` (step 5). `onSessionLogged`
 * remains a light stub until the completion/recommendation surface (steps 7+). The
 * engine is NOT yet registered in the platform registry (step 9), so it is invisible
 * to users until enabled.
 */
import type {
  ProgramEngine,
  ProgramMeta,
  SetupSchema,
  ProgramSetupInput,
  PlatformContext,
  PlannedSessionSpec,
  PlannedSessionKind,
  SessionPrescription,
  LoggedSession,
  ProgramRecommendation,
} from "@hta/program-core";
import {
  buildHyroxGrid,
  PHASE_NAME,
  type HyroxDayCell,
  type HyroxWeekPlan,
} from "./phases";
import { getHyroxSession, modalityOf } from "./sessions";
import { prescribeSession, deloadPrescription } from "./prescription";
import type { HyroxExperience, HyroxDivision } from "./types";

export type { HyroxExperience, HyroxDivision } from "./types";

/**
 * Default block length (weeks) by experience. `[DEF]` programming schedule, NOT
 * calibrated physiology — sits inside the cited 8–16 wk range (12 = consensus
 * sweet spot). Source: RoxLyfe training-plan fundamentals; HYROX365 Academy. A
 * supplied race date later overrides this (ADR 0050 step 10).
 */
export const WEEKS_BY_EXPERIENCE: Record<HyroxExperience, number> = {
  beginner: 10,
  intermediate: 12,
  advanced: 16,
};

/**
 * Default training sessions/week by experience. `[DEF]` — beginner completes +
 * stays healthy on 3 (→4 stretch); intermediate 5; advanced 8 (two-a-days). The
 * user can override within [MIN_SESSIONS_PER_WEEK, MAX_SESSIONS_PER_WEEK].
 */
export const DEFAULT_SESSIONS_BY_EXPERIENCE: Record<HyroxExperience, number> = {
  beginner: 3,
  intermediate: 5,
  advanced: 8,
};

export const MIN_SESSIONS_PER_WEEK = 3;
export const MAX_SESSIONS_PER_WEEK = 8;

/**
 * The serialised HYROX program instance (stored in `program_instances`). MUST be
 * JSON-round-trippable. The race date / event linkage is added in step 10.
 */
export interface HyroxInstance {
  experience: HyroxExperience;
  division: HyroxDivision;
  /** Block length in weeks (derived from experience; race-date-overridable later). */
  weeks: number;
  /** Training sessions per week (defaulted by experience, user-overridable). */
  sessionsPerWeek: number;
}

export const hyroxMeta: ProgramMeta = {
  id: "hyrox",
  name: "HYROX",
  family: "hyrox",
  summary:
    "Race-specific concurrent training for HYROX — periodized running + functional stations toward race day.",
};

function asExperience(v: unknown): HyroxExperience {
  return v === "beginner" || v === "advanced" ? v : "intermediate";
}

function asDivision(v: unknown): HyroxDivision {
  return v === "pro" || v === "doubles" ? v : "open";
}

function clampSessions(v: unknown, fallback: number): number {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(MIN_SESSIONS_PER_WEEK, Math.min(MAX_SESSIONS_PER_WEEK, Math.round(n)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline — ref scheme `hx-w{week}-d{weekday}` (one ref per non-rest day).
// A HYROX block is a single event build (no repeats), so there is no block index.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

export function hyroxRef(week: number, weekday: number): string {
  return `hx-w${week}-d${weekday}`;
}

export function parseHyroxRef(ref: string): { week: number; weekday: number } | null {
  const m = ref.match(/^hx-w(\d+)-d(\d+)$/);
  if (!m) return null;
  return { week: Number(m[1]), weekday: Number(m[2]) };
}

function kindForCell(cell: HyroxDayCell, isDeload: boolean): PlannedSessionKind {
  if (cell.kind === "deload") return "deload";
  if (cell.kind === "sim") return "test";
  // Light aerobic inside a deload week is still part of the deload.
  return isDeload ? "deload" : "training";
}

function specForCell(
  week: HyroxWeekPlan,
  weekday: number,
  cell: HyroxDayCell,
  index: number,
): PlannedSessionSpec {
  const phaseName = PHASE_NAME[week.phase];
  const weekLabel = `HYROX · Wk ${week.week} · ${phaseName}`;
  const tags: string[] = [
    `phase:${week.phase}`,
    `week:${week.week}`,
    `day:${weekday + 1}`,
  ];
  if (week.isDeload) tags.push("deload-week");
  if (week.phase === "taper") tags.push("taper");

  let label = `${weekLabel} · ${DAY_LABELS[weekday]}`;

  if (cell.kind === "deload") {
    tags.push("deload");
    label = `${weekLabel} · ${DAY_LABELS[weekday]} · Deload`;
  } else if (cell.kind === "session" || cell.kind === "sim") {
    const sess = getHyroxSession(cell.session);
    const name = sess?.name ?? cell.session;
    tags.push(`session:${cell.session}`);
    if (sess) {
      tags.push(`zone:${sess.zone}`, `modality:${modalityOf(sess.category)}`);
      if (sess.perMovementLog) tags.push("per-movement-log");
    }
    if (cell.kind === "sim") tags.push("benchmark", "simulation");
    let suffix = "";
    if (cell.kind === "session" && cell.plus) {
      tags.push("two-a-day");
      const plusSess = getHyroxSession(cell.plus.session);
      suffix = ` + ${plusSess?.name ?? cell.plus.session} (two-a-day)`;
    }
    label = `${weekLabel} · ${DAY_LABELS[weekday]} · ${name}${suffix}`;
  }

  return {
    ref: hyroxRef(week.week, weekday),
    index,
    label,
    kind: kindForCell(cell, week.isDeload),
    weekLabel,
    weekday,
    tags,
  };
}

function buildTimeline(instance: HyroxInstance): PlannedSessionSpec[] {
  const plan = buildHyroxGrid({
    weeks: instance.weeks,
    sessionsPerWeek: instance.sessionsPerWeek,
    experience: instance.experience,
  });
  const specs: PlannedSessionSpec[] = [];
  let index = 0;
  for (const week of plan) {
    for (let d = 0; d < week.days.length; d++) {
      const cell = week.days[d]!;
      if (cell.kind === "rest") continue;
      specs.push(specForCell(week, d, cell, index++));
    }
  }
  return specs;
}

/** Find the grid cell a ref points to, with its owning week (for prescribe). */
function locateCell(
  instance: HyroxInstance,
  ref: string,
): { week: HyroxWeekPlan; cell: HyroxDayCell } | null {
  const parsed = parseHyroxRef(ref);
  if (!parsed) return null;
  const plan = buildHyroxGrid({
    weeks: instance.weeks,
    sessionsPerWeek: instance.sessionsPerWeek,
    experience: instance.experience,
  });
  const week = plan.find((w) => w.week === parsed.week);
  if (!week) return null;
  const cell = week.days[parsed.weekday];
  if (!cell || cell.kind === "rest") return null;
  return { week, cell };
}

/**
 * The HYROX session id (e.g. "sim-half", "compromised-run") a planned-session ref
 * resolves to — used by the platform completion flow to materialize actuals.
 * Returns null for deload/rest/unknown refs (nothing to session-materialize).
 */
export function hyroxSessionIdForRef(instance: HyroxInstance, ref: string): string | null {
  const located = locateCell(instance, ref);
  if (!located) return null;
  const { cell } = located;
  if (cell.kind === "session" || cell.kind === "sim") return cell.session;
  return null;
}

function prescribeRef(
  instance: HyroxInstance,
  ref: string,
  ctx: PlatformContext,
): SessionPrescription {
  const located = locateCell(instance, ref);
  if (!located) return { items: [] };
  const { week, cell } = located;

  if (cell.kind === "deload") return deloadPrescription();

  const args = {
    experience: instance.experience,
    division: instance.division,
    phase: week.phase,
    isDeload: week.isDeload,
  };

  if (cell.kind === "sim") {
    return { items: prescribeSession(cell.session, ctx, args) };
  }

  if (cell.kind !== "session") return { items: [] };

  // The primary session, plus an optional two-a-day.
  const items = prescribeSession(cell.session, ctx, args);
  if (cell.plus) {
    const plusItems = prescribeSession(cell.plus.session, ctx, args);
    const plusSess = getHyroxSession(cell.plus.session);
    if (plusItems.length > 0) {
      items.push({
        kind: "note",
        name: `Two-a-day — ${plusSess?.name ?? cell.plus.session}`,
        note: "A second, easy session performed the same day (AM/PM split recommended).",
      });
      items.push(...plusItems);
    }
  }
  return { items };
}

export const hyroxEngine: ProgramEngine<HyroxInstance> = {
  meta: hyroxMeta,

  describeSetup(): SetupSchema {
    return {
      fields: [
        {
          key: "experience",
          label: "Experience",
          type: "select",
          defaultValue: "intermediate",
          options: [
            { value: "beginner", label: "Beginner — first HYROX (10-week build)" },
            { value: "intermediate", label: "Intermediate — completed a race (12-week build)" },
            { value: "advanced", label: "Advanced — competitive (16-week build)" },
          ],
          help: "Sets your block length and default training volume. You can still adjust sessions/week below.",
        },
        {
          key: "division",
          label: "Division",
          type: "select",
          defaultValue: "open",
          options: [
            { value: "open", label: "Open" },
            { value: "pro", label: "Pro" },
            { value: "doubles", label: "Doubles" },
          ],
          help: "Determines the station weights and rep standards your sessions prescribe.",
        },
        {
          key: "sessionsPerWeek",
          label: "Sessions per week",
          type: "select",
          defaultValue: "5",
          options: [
            { value: "3", label: "3" },
            { value: "4", label: "4" },
            { value: "5", label: "5" },
            { value: "6", label: "6" },
            { value: "7", label: "7" },
            { value: "8", label: "8 (two-a-days)" },
          ],
          help: "Running is ~half of HYROX — most weeks lean aerobic, with 1–2 strength and 1–2 station/compromised sessions.",
        },
      ],
    };
  },

  setup(input: ProgramSetupInput, _ctx: PlatformContext): HyroxInstance {
    const v = input.values;
    const experience = asExperience(v.experience);
    const division = asDivision(v.division);
    const sessionsPerWeek = clampSessions(
      v.sessionsPerWeek,
      DEFAULT_SESSIONS_BY_EXPERIENCE[experience],
    );
    return {
      experience,
      division,
      weeks: WEEKS_BY_EXPERIENCE[experience],
      sessionsPerWeek,
    };
  },

  // ── timeline: walk the periodized grid (ADR 0050 step 4). prescribe()/
  // onSessionLogged() are filled in step 5; the engine is not registered/enabled
  // until step 9, so those stubs are not reached by the platform yet. ──
  timeline(instance: HyroxInstance): PlannedSessionSpec[] {
    return buildTimeline(instance);
  },

  prescribe(
    instance: HyroxInstance,
    ref: string,
    ctx: PlatformContext,
  ): SessionPrescription {
    return prescribeRef(instance, ref, ctx);
  },

  onSessionLogged(
    instance: HyroxInstance,
    _log: LoggedSession,
    _ctx: PlatformContext,
  ): { instance: HyroxInstance; recommendations: ProgramRecommendation[] } {
    return { instance, recommendations: [] };
  },
};
