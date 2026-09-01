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
  ProgramSegment,
  RecoveryWeekPolicy,
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
 * calibrated physiology — sits inside the cited 8–18 wk range. A supplied race date
 * later overrides this (ADR 0050 step 10). Lengths are set so the default build fits
 * a 3:1/4:1 deload rhythm (≥2 mid-block deloads) plus a full + half race simulation
 * before the taper (ADR 0069). Source: RoxLyfe / HYROX365 plan fundamentals.
 */
export const WEEKS_BY_EXPERIENCE: Record<HyroxExperience, number> = {
  beginner: 12,
  intermediate: 14,
  advanced: 18,
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
  /** Two-a-day (AM/PM) programming enabled for this block (ADR 0054). */
  twoADay: boolean;
  /**
   * Whether this block targets a race (ADR 0060). True ⇒ peak to race week
   * (Base/Build/Specific/Taper). False ⇒ no-taper concurrent maintenance (short Base
   * intro → held Build steady state). Defaults true (race) when the setup omits it.
   */
  hasRace: boolean;
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

/** Minimum / maximum HYROX block length (weeks) — a race-date override is clamped here. */
export const MIN_WEEKS = 4;
export const MAX_WEEKS = 24;

function clampWeeks(v: unknown, fallback: number): number {
  if (v == null || v === "") return fallback;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(MIN_WEEKS, Math.min(MAX_WEEKS, Math.round(n)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Timeline — ref scheme `hx-w{week}-d{weekday}` (one ref per non-rest day).
// A HYROX block is a single event build (no repeats), so there is no block index.
// ─────────────────────────────────────────────────────────────────────────────

const DAY_LABELS = ["Day 1", "Day 2", "Day 3", "Day 4", "Day 5", "Day 6", "Day 7"];

/** Display label for a role-anchored main-lift engine key (e.g. "squat" → "Squat"). */
const MAIN_LIFT_TITLE: Record<string, string> = {
  squat: "Squat",
  deadlift: "Deadlift",
  press: "Overhead Press",
  bench: "Bench Press",
};
function mainLiftLabel(key: string): string {
  return (
    MAIN_LIFT_TITLE[key] ??
    key.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ")
  );
}

/** Strip a trailing "(Z2)" / "(4+4)" qualifier so the title stays concise. */
function cleanSessionName(name: string): string {
  return name.replace(/\s*\([^)]*\)\s*$/, "").trim();
}

export function hyroxRef(week: number, weekday: number, pm = false): string {
  return `hx-w${week}-d${weekday}${pm ? "-pm" : ""}`;
}

export function parseHyroxRef(ref: string): { week: number; weekday: number; pm: boolean } | null {
  const m = ref.match(/^hx-w(\d+)-d(\d+)(-pm)?$/);
  if (!m) return null;
  return { week: Number(m[1]), weekday: Number(m[2]), pm: m[3] != null };
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
  // Clean, content-first title (the breadcrumb lives in the page chrome).
  let title = "";

  if (cell.kind === "deload") {
    tags.push("deload");
    label = `${weekLabel} · ${DAY_LABELS[weekday]} · Deload`;
    title = "Recovery";
  } else if (cell.kind === "session" || cell.kind === "sim") {
    const sess = getHyroxSession(cell.session);
    const name = sess?.name ?? cell.session;
    tags.push(`session:${cell.session}`);
    if (sess) {
      tags.push(`zone:${sess.zone}`, `modality:${modalityOf(sess.category)}`);
      if (sess.perMovementLog) tags.push("per-movement-log");
    }
    if (cell.kind === "sim") tags.push("benchmark", "simulation");
    if (cell.kind === "session" && cell.plus) tags.push("two-a-day");
    label = `${weekLabel} · ${DAY_LABELS[weekday]} · ${name}`;
    // Strength → the working lifts (what you actually do); everything else → the
    // session name with its "(Z2)/(4+4)" qualifier stripped.
    if (sess?.category === "strength") {
      title = sess.movements.map(mainLiftLabel).join(" · ");
    } else if (sess) {
      title = cleanSessionName(sess.name);
    } else {
      title = name;
    }
  }

  const secondSession =
    cell.kind === "session" && cell.plus
      ? (() => {
          const plusSess = getHyroxSession(cell.plus.session);
          const baseName = plusSess ? cleanSessionName(plusSess.name) : cell.plus.session;
          // PM companion of a two-a-day (ADR 0054). The "(PM · 6–8 h later)" cue
          // surfaces Robineau 2016's same-day spacing guidance on the card.
          return { ref: hyroxRef(week.week, weekday, true), title: `${baseName} · PM (6–8 h later)` };
        })()
      : undefined;

  return {
    ref: hyroxRef(week.week, weekday),
    index,
    label,
    title,
    kind: kindForCell(cell, week.isDeload),
    weekLabel,
    ...(secondSession ? { secondSession } : {}),
    // NOTE: deliberately NO `weekday` on the spec. HYROX used to fix its own
    // calendar (auto-spread weekdays), which made `materialize` ignore the user's
    // chosen training days. Like 5/3/1 / Hybrid, HYROX now lets the user pick
    // training weekdays on the Schedule step; `materialize` seats this week's
    // sessions onto them in timeline order. The `weekday` embedded in the ref is
    // an internal CONTENT coordinate (cellForRef looks up grid.days[weekday]) and
    // no longer dictates the calendar placement.
    tags,
  };
}

function buildTimeline(instance: HyroxInstance): PlannedSessionSpec[] {
  const plan = buildHyroxGrid({
    weeks: instance.weeks,
    sessionsPerWeek: instance.sessionsPerWeek,
    experience: instance.experience,
    twoADay: instance.twoADay,
    hasRace: instance.hasRace,
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
    twoADay: instance.twoADay,
    hasRace: instance.hasRace,
  });
  const week = plan.find((w) => w.week === parsed.week);
  if (!week) return null;
  const cell = week.days[parsed.weekday];
  if (!cell || cell.kind === "rest") return null;
  // A "-pm" ref resolves to the day's two-a-day companion (an easy erg), surfaced
  // as a synthetic session cell so prescribe()/completion treat it like any other.
  if (parsed.pm) {
    if (cell.kind !== "session" || !cell.plus) return null;
    return { week, cell: { kind: "session", session: cell.plus.session } };
  }
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
    week: week.week,
    ...(week.taperKind ? { taperKind: week.taperKind } : {}),
    ...(ctx.gender ? { gender: ctx.gender } : {}),
  };

  if (cell.kind === "sim") {
    return { items: prescribeSession(cell.session, ctx, args) };
  }

  if (cell.kind !== "session") return { items: [] };

  // One ref prescribes one session. A two-a-day's second session is reachable
  // through its own `-pm` ref (see `specForCell`), so appending it here as well
  // would prescribe the same work twice on the same day.
  return { items: prescribeSession(cell.session, ctx, args) };
}

/**
 * A HYROX recovery week.
 *
 * HYROX's own scheduled recovery weeks keep easy aerobic work and drop the
 * intensity rather than the lifting — its strength work is already a support
 * dose. A user-initiated week mirrors that: light straight sets, easy cardio
 * kept but capped.
 */
export const HYROX_RECOVERY_WEEK: RecoveryWeekPolicy = {
  topPercent: 60,
  setOffsets: [0, 0],
  reps: 5,
  recommendedPercent: { min: 55, max: 65 },
  basis: "one-rm",
  easyCardioMaxMin: 40,
  cue: "Recovery week — keep it easy",
};

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
          help: "Sets your block length and default training volume. You choose your training days on the Schedule step.",
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
    // A supplied race date overrides the experience default block length with the
    // weeks-to-race (ADR 0050 step 10). The platform computes it and passes `weeks`;
    // clamp to a sane build window so the taper still fits.
    const weeks = clampWeeks(v.weeks, WEEKS_BY_EXPERIENCE[experience]);
    return {
      experience,
      division,
      weeks,
      sessionsPerWeek,
      twoADay: v.twoADay === true || v.twoADay === "true",
      // ADR 0060 — race vs no-race. The platform passes `hasRace` explicitly (a race
      // date was set). Absent ⇒ default to a race build (preserves prior behaviour).
      hasRace: v.hasRace === undefined ? true : v.hasRace === true || v.hasRace === "true",
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

  segments(instance: HyroxInstance): ProgramSegment[] {
    const plan = buildHyroxGrid({
      weeks: instance.weeks,
      sessionsPerWeek: instance.sessionsPerWeek,
      experience: instance.experience,
      twoADay: instance.twoADay,
      hasRace: instance.hasRace,
    });
    const out: ProgramSegment[] = [];
    let lastPhase: string | null = null;
    for (let i = 0; i < plan.length; i++) {
      const w = plan[i]!;
      // One entry at the first week of each periodization phase. (Deload weeks
      // sit inside a phase and aren't separate start points.)
      if (w.phase !== lastPhase) {
        out.push({
          startWeekIndex: i,
          label: PHASE_NAME[w.phase],
          kind: w.phase === "taper" ? "test" : "phase",
        });
        lastPhase = w.phase;
      }
    }
    return out;
  },
};
