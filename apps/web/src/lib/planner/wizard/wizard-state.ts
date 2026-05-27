/**
 * Block-wizard state types and reducer.
 *
 * The wizard captures user choices over 5 steps. The reducer is the single
 * source of truth for transitions; UI components dispatch actions only.
 *
 * Branching transitions encoded here (matching the approved mockup):
 *   • "See lighter options" link on step 1 jumps to step 4 with the synthetic
 *     `maintenance` secondary and `cameFromMaintenanceLink = true` flag, so
 *     "back" returns to step 1.
 *   • `goal === "resilience"` skips step 3 entirely (step 2 → 4 and back).
 *
 * Pure — no React imports, no I/O. Tested in `wizard-mapping.test.ts`.
 */
import type { Goal, Secondary } from "./wizard-mapping";
import type { ScheduleCell } from "./schedule";

export type StepIndex = 1 | 2 | 3 | 4 | 5;

export type WizardState = {
  step: StepIndex;
  days: number | null;
  goal: Goal | null;
  secondary: Secondary | null;
  power: boolean;
  twoADay: boolean;
  /** Phase 1 "external cardio" — `true` means the user wants the planner
   *  to reserve cardio days but skip the prescription so they can log via
   *  their own run program. Pre-filled from `profile.preferred_cardio_source`. */
  externalCardio: boolean;
  /** Optional free-text program name shown on the session card. */
  externalCardioName: string;
  /** Set when the user reached step 4 via "See lighter options" on step 1. */
  cameFromMaintenanceLink: boolean;
  /** Step-5 schedule; populated lazily when step 5 first renders. */
  schedule: ScheduleCell[];
  /** Signature used to detect when the schedule needs to be re-derived. */
  scheduleSig: string | null;
  /** Index of the currently selected swap source (step 5), or null. */
  swapSourceIdx: number | null;
  /** Index of the cell currently being dragged (step 5), or null. */
  dragSourceIdx: number | null;
  /** Index of the cell the drag is currently hovering over, or null. */
  dragOverIdx: number | null;
  /** True when the user's saved day pref was applied to the schedule. */
  usingSavedPref: boolean;
};

export const initialWizardState: WizardState = {
  step: 1,
  days: null,
  goal: null,
  secondary: null,
  power: false,
  twoADay: false,
  externalCardio: false,
  externalCardioName: "",
  cameFromMaintenanceLink: false,
  schedule: [],
  scheduleSig: null,
  swapSourceIdx: null,
  dragSourceIdx: null,
  dragOverIdx: null,
  usingSavedPref: false,
};

export type WizardAction =
  | { type: "set-days"; days: number }
  | { type: "set-goal"; goal: Goal }
  | { type: "set-secondary"; secondary: Secondary }
  | { type: "toggle-power" }
  | { type: "toggle-two-a-day" }
  | { type: "toggle-external-cardio" }
  | { type: "set-external-cardio-name"; name: string }
  | { type: "maintenance-link" }
  | { type: "goto"; step: StepIndex }
  | { type: "next" }
  | { type: "back" }
  | { type: "set-schedule"; schedule: ScheduleCell[]; sig: string; usingSavedPref: boolean }
  | { type: "swap-source"; idx: number | null }
  | { type: "apply-swap"; sourceIdx: number; targetIdx: number }
  | { type: "drag-start"; idx: number }
  | { type: "drag-over"; idx: number | null }
  | { type: "drag-end" };

export function wizardReducer(state: WizardState, action: WizardAction): WizardState {
  switch (action.type) {
    case "set-days":
      return { ...state, days: action.days };
    case "set-goal":
      // Changing the primary clears the secondary so the user re-picks.
      return { ...state, goal: action.goal, secondary: null, power: false };
    case "set-secondary":
      return { ...state, secondary: action.secondary };
    case "toggle-power":
      return { ...state, power: !state.power };
    case "toggle-two-a-day":
      return { ...state, twoADay: !state.twoADay };
    case "toggle-external-cardio":
      return { ...state, externalCardio: !state.externalCardio };
    case "set-external-cardio-name":
      return { ...state, externalCardioName: action.name };
    case "maintenance-link":
      // "See lighter options" — synthesize a maintenance block, clear goal.
      return {
        ...state,
        days: state.days ?? 4,
        goal: null,
        secondary: "maintenance",
        twoADay: false,
        cameFromMaintenanceLink: true,
        step: 4,
      };
    case "goto":
      return { ...state, step: action.step };
    case "next": {
      const s = state.step;
      // Resilience skips step 3 (no meaningful "second focus" for a tendon block).
      if (s === 2 && state.goal === "resilience") return { ...state, step: 4 };
      if (s === 5) return state;
      return { ...state, step: (s + 1) as StepIndex };
    }
    case "back": {
      const s = state.step;
      if (s === 1) return state;
      if (s === 5) return { ...state, step: 4 };
      if (s === 4 && state.cameFromMaintenanceLink) {
        return {
          ...state,
          goal: null,
          secondary: null,
          cameFromMaintenanceLink: false,
          step: 1,
        };
      }
      if (s === 4 && state.goal === "resilience") return { ...state, step: 2 };
      return { ...state, step: (s - 1) as StepIndex };
    }
    case "set-schedule":
      return {
        ...state,
        schedule: action.schedule,
        scheduleSig: action.sig,
        usingSavedPref: action.usingSavedPref,
        swapSourceIdx: null,
        dragSourceIdx: null,
        dragOverIdx: null,
      };
    case "swap-source":
      return { ...state, swapSourceIdx: action.idx };
    case "apply-swap": {
      const next = state.schedule.map((c) => ({ ...c }));
      const a = next[action.sourceIdx];
      const b = next[action.targetIdx];
      if (!a || !b) return state;
      [a.am, b.am] = [b.am, a.am];
      [a.pm, b.pm] = [b.pm, a.pm];
      return {
        ...state,
        schedule: next,
        swapSourceIdx: null,
        dragSourceIdx: null,
        dragOverIdx: null,
        usingSavedPref: false,
      };
    }
    case "drag-start":
      return { ...state, dragSourceIdx: action.idx, dragOverIdx: null };
    case "drag-over":
      return { ...state, dragOverIdx: action.idx };
    case "drag-end":
      return { ...state, dragSourceIdx: null, dragOverIdx: null };
    default:
      return state;
  }
}
