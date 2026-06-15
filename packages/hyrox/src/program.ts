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
 * This file is the STEP-3 skeleton (ADR 0050 build order): meta + describeSetup +
 * setup + the instance type. `timeline` / `prescribe` / `onSessionLogged` are stubbed
 * and filled in steps 4–5. The engine is NOT yet registered in the platform registry
 * (step 9), so it is invisible to users until enabled.
 */
import type {
  ProgramEngine,
  ProgramMeta,
  SetupSchema,
  ProgramSetupInput,
  PlatformContext,
  PlannedSessionSpec,
  SessionPrescription,
  LoggedSession,
  ProgramRecommendation,
} from "@hta/program-core";

/** Athlete experience tier — drives default block length + session volume. */
export type HyroxExperience = "beginner" | "intermediate" | "advanced";

/** Race division — drives station weights / rep standards. */
export type HyroxDivision = "open" | "pro" | "doubles";

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

  // ── Stubs filled in ADR 0050 steps 4–5 (phase grid + prescriptions). ──
  // The engine is not registered/enabled until step 9, so these are not reached
  // by the platform yet.
  timeline(_instance: HyroxInstance): PlannedSessionSpec[] {
    return [];
  },

  prescribe(
    _instance: HyroxInstance,
    _ref: string,
    _ctx: PlatformContext,
  ): SessionPrescription {
    return { items: [] };
  },

  onSessionLogged(
    instance: HyroxInstance,
    _log: LoggedSession,
    _ctx: PlatformContext,
  ): { instance: HyroxInstance; recommendations: ProgramRecommendation[] } {
    return { instance, recommendations: [] };
  },
};
