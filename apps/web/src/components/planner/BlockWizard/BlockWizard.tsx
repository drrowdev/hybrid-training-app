/**
 * BlockWizard — the React port of the approved
 * ``hybrid-block-wizard-mockup.html``. Owns step navigation, the sidebar
 * preview, and the schedule grid. Mounted from /app/plan/new.
 *
 * Strict ports:
 *   • All copy / hint text / why-this-match paragraphs are byte-identical
 *     with the mockup — owner-approved, research-grounded.
 *   • Math + placement live in lib/planner/wizard/ (pure, tested).
 *   • Theme — uses Clawpilot ``var(--cp-*)`` everywhere; no hard-coded colours.
 *   • TM gating on step-5 Start: when the resolved archetype isn't TM-ready,
 *     "Start this block" surfaces an inline "Set your training maxes first"
 *     error rather than calling the server action.
 *
 * Day-pattern hints are persisted per-archetype × per-session-count under
 * the ``hta-day-pref-v2`` localStorage key (see ``lib/planner/wizard/day-pref``);
 * legacy ``hta-day-pref-v1`` values are migrated on first read. The canonical
 * source after Start is the ``day_index_overrides`` column.
 */
"use client";

import { useEffect, useMemo, useReducer, useRef, useState, useTransition } from "react";
import {
  initialWizardState,
  wizardReducer,
  type WizardState,
} from "@/lib/planner/wizard/wizard-state";
import type { AccessoryVolumeLevel } from "@/lib/planner/accessory-volume";
import {
  resolveArchetype,
  wizardOutput,
  type ResolvedArchetype,
  type Goal,
  type Secondary,
} from "@/lib/planner/wizard/wizard-mapping";
import {
  DAY_LABELS,
  applySavedPrefIfPossible,
  buildWeekShape,
  defaultSchedule,
  isHighCNS,
  scheduleSignature,
  sequencingWarnings,
  type ScheduleCell,
} from "@/lib/planner/wizard/schedule";
import {
  buildPlacementsFromSchedule,
  type Placement,
} from "@/lib/planner/wizard/placements";
import {
  migrateV1IfNeeded,
  readDayPref,
  readDayPrefFromValue,
  writeDayPref,
  type WizardDayPrefValue,
} from "@/lib/planner/wizard/day-pref";
import { Step1Days } from "./Step1Days";
import { Step2Focus } from "./Step2Focus";
import { Step3Secondary } from "./Step3Secondary";
import { Step4Review, type EstimateAccessoryVolumeAction } from "./Step4Review";
import { Step5Schedule } from "./Step5Schedule";
import { WizardSidebar } from "./WizardSidebar";
import { BlockCreatingOverlay } from "./BlockCreatingOverlay";
import type { EquipmentPreset } from "@/lib/settings/equipment-schema";

export type WizardSubmit = {
  archetypeId: ResolvedArchetype["id"];
  daysPerWeek: number;
  /**
   * Step-5 day arrangement. `days` + `twoADay` retain the pre-fix wire
   * shape (which days were picked); `placements` carries the user's
   * exact session-to-day mapping so the server materialiser can rebind
   * the archetype's canonical templates to the days the user chose.
   * Without `placements` the server falls back to the canonical archetype
   * day order — see ``lib/planner/wizard/placements.ts``.
   */
  dayIndexOverrides: {
    days: number[];
    twoADay: boolean;
    placements: Placement[];
  };
  power: boolean;
  /**
   * Phase 1 "external cardio" — when 'external' the planner emits a
   * placeholder cardio item per cardio day instead of a prescribed run.
   * Default 'internal' keeps every existing path unchanged. See
   * migration 0064 and `lib/planner/actions.ts` for the materialization
   * branch.
   */
  cardioSource: "internal" | "external";
  /** Free-text label for the external program, e.g. "Runna". Empty when not provided. */
  cardioSourceName: string;
  /**
   * Migration 0079 — per-block focus muscle groups (0–2). Submitted as
   * repeated `focusMuscles` form fields by `PlanNewSwitch`. Empty array
   * = no focus, engine produces pre-PR baseline.
   */
  focusMuscles: string[];
  /**
   * ADR 0020 — wizard PRIMARY goal + SECONDARY focus, forwarded so the engine
   * can apply the secondary-focus volume tilt and persist the user's choice on
   * the block. `goal` is null on the maintenance shortcut; `secondary` is null
   * until the user reaches step 3.
   */
  goal: Goal | null;
  secondary: Secondary | null;
  /**
   * ADR 0024 — per-block accessory volume level (`low | medium | high`).
   * `medium` is the byte-identical default. Forwarded to `createBlock` and
   * persisted on the block; the engine applies the matching accessory tilt.
   */
  accessoryVolume: AccessoryVolumeLevel;
};

export type TmGate = {
  /** When false, "Start this block" is disabled with the error message below. */
  ready: boolean;
  /** Human-readable list of missing strength roles. */
  missingRoles: string[];
};

export type TmReadinessByArchetype = Record<ResolvedArchetype["id"], TmGate>;

/**
 * Seed values for the wizard when launched from "Customize first" on a
 * recent-block card. We only know the source block's archetype + days
 * + schedule overrides — goal/secondary are reverse-mapped to a
 * best-guess starting point that the user can adjust before committing.
 *
 * Day-of-week overrides flow into step-5 via the existing localStorage
 * pref slot (`applySavedPrefIfPossible`) so the wizard preserves the
 * source block's chosen days without a schema change.
 */
export type BlockWizardPrefill = {
  archetype: string;
  daysPerWeek: number;
  /**
   * Persisted overrides from the source block. `placements` is optional
   * for backward compatibility with blocks created before the fix —
   * those only carry `{ days, twoADay }`.
   */
  dayIndexOverrides: {
    days: number[];
    twoADay: boolean;
    placements?: Placement[];
  } | null;
};

export type BlockWizardProps = {
  onComplete: (submit: WizardSubmit) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** TM-readiness per resolved archetype id. Computed server-side from the user's TM context. */
  tmReadinessByArchetype: TmReadinessByArchetype;
  /** When false, the two-a-day toggle stays disabled (matches profile flag). */
  allowsTwoADays: boolean;
  /** Optional pre-fill from a recent block ("Customize first" flow). */
  prefill?: BlockWizardPrefill | null;
  /**
   * Equipment preset from the user's profile. When `"bodyweight_only"`, the
   * review step + sidebar swap barbell-flavoured copy for bodyweight-native
   * progression copy. Defaults to `null` (which renders the loaded-strength
   * copy used historically by the wizard).
   */
  equipmentPreset?: EquipmentPreset | null;
  /**
   * Cross-device day-pref payload from `profiles.wizard_day_pref` (PR Z1).
   * Primary source on hydration; localStorage is consulted only when this
   * is null (legacy / never-saved-from-this-account).
   */
  serverDayPref?: WizardDayPrefValue | null;
  /**
   * Server action that persists the merged day-pref payload after every
   * wizard save. The component still mirrors to localStorage for fast
   * paint on the next visit.
   */
  saveDayPrefAction?: (
    pref: WizardDayPrefValue,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  /**
   * Phase 1 "external cardio" — global default from
   * `profiles.preferred_cardio_source`. Pre-fills the step-3 toggle so
   * the user doesn't have to re-check it every block. Optional; absent
   * = treated as 'internal'.
   */
  preferredCardioSource?: "internal" | "external" | null;
  preferredCardioSourceName?: string | null;
  /**
   * ADR 0024 addendum — read-only server action that prices a representative
   * strength workout at each accessory-volume level for the live time estimate
   * shown on the review step. Optional; when absent the control still renders
   * without per-level minute estimates.
   */
  estimateAccessoryVolumeAction?: EstimateAccessoryVolumeAction;
};

export function BlockWizard({
  onComplete,
  tmReadinessByArchetype,
  allowsTwoADays,
  prefill,
  equipmentPreset = null,
  serverDayPref = null,
  saveDayPrefAction,
  preferredCardioSource = null,
  preferredCardioSourceName = null,
  estimateAccessoryVolumeAction,
}: BlockWizardProps): React.ReactElement {
  const [state, dispatch] = useReducer(
    wizardReducer,
    prefill ?? null,
    (seed) => {
      const base = seed ? wizardStateFromPrefill(seed) : initialWizardState;
      // Phase 1 "external cardio" — apply the user's saved preference
      // as a one-shot seed. The reducer is the source of truth from
      // here; if the user un-toggles the panel mid-wizard we don't
      // re-stomp it on every render.
      if (preferredCardioSource === "external") {
        return {
          ...base,
          externalCardio: true,
          externalCardioName: preferredCardioSourceName ?? "",
        };
      }
      return base;
    },
  );
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

  // ── One-shot: seed the step-5 day-pref from the source block's
  //    day_index_overrides so "Customize first" preserves the day-of-week
  //    layout the user originally chose. `applySavedPrefIfPossible` (used
  //    by the schedule init effect below) reads from localStorage, so we
  //    write the pref there once and let the existing flow apply it.
  const prefillSeededRef = useRef(false);
  useEffect(() => {
    if (prefillSeededRef.current) return;
    if (!prefill?.dayIndexOverrides) return;
    if (typeof window === "undefined") return;
    prefillSeededRef.current = true;
    const archetypeId = prefilledArchetypeId(prefill.archetype);
    if (!archetypeId) return;
    const sessionCount = prefill.dayIndexOverrides.twoADay
      ? prefill.daysPerWeek * 2
      : prefill.daysPerWeek;
    const merged = writeDayPref(
      window.localStorage,
      archetypeId,
      sessionCount,
      prefill.dayIndexOverrides,
      serverDayPref,
    );
    if (saveDayPrefAction) void saveDayPrefAction(merged);
  }, [prefill, serverDayPref, saveDayPrefAction]);

  // ── Resolved archetype (memoised — single canonical reducer) ──
  const resolved = useMemo<ResolvedArchetype | null>(
    () =>
      resolveArchetype({
        days: state.days,
        goal: state.goal,
        secondary: state.secondary,
        twoADay: state.twoADay,
      }),
    [state.days, state.goal, state.secondary, state.twoADay],
  );

  // ── Initialise / rebuild step-5 schedule when archetype shape changes ──
  useEffect(() => {
    if (state.step !== 5 || !resolved) return;
    const sessions = buildWeekShape(resolved, {
      goal: state.goal,
      secondary: state.secondary,
    });
    const sig = scheduleSignature(resolved, {
      twoADay: state.twoADay,
      power: state.power,
      secondary: state.secondary,
      sessionCount: sessions.length,
    });
    if (state.scheduleSig === sig) return;
    const cells = defaultSchedule(resolved, {
      goal: state.goal,
      secondary: state.secondary,
      twoADay: state.twoADay,
    });
    const sessionCount = sessions.length;
    const storage = typeof window === "undefined" ? null : window.localStorage;
    if (storage) {
      migrateV1IfNeeded(storage, resolved.id, sessionCount);
    }
    // PR Z1 — DB-first read: prefer the server payload when present;
    // fall back to localStorage for legacy / never-saved accounts.
    const pref =
      readDayPrefFromValue(serverDayPref, resolved.id, sessionCount) ??
      (storage ? readDayPref(storage, resolved.id, sessionCount) : null);
    const used = applySavedPrefIfPossible(cells, pref, state.twoADay);
    dispatch({ type: "set-schedule", schedule: cells, sig, usingSavedPref: used });
  }, [state.step, state.scheduleSig, state.goal, state.secondary, state.twoADay, state.power, resolved, serverDayPref]);

  const tmGate: TmGate | null = resolved ? tmReadinessByArchetype[resolved.id] ?? null : null;

  const canContinue = useMemo(() => {
    if (state.step === 1) return state.days != null;
    if (state.step === 2) return state.goal != null;
    if (state.step === 3) return state.secondary != null;
    return true;
  }, [state.step, state.days, state.goal, state.secondary]);

  const nextLabel =
    state.step === 4 ? "Continue to schedule" : state.step === 5 ? "Start this block" : "Continue";

  const handleNext = (): void => {
    setSubmitError(null);
    if (state.step !== 5) {
      dispatch({ type: "next" });
      return;
    }
    if (!resolved) return;
    const out = wizardOutput({
      days: state.days,
      goal: state.goal,
      secondary: state.secondary,
      twoADay: state.twoADay,
    });
    if (!out) return;
    const usedDays = state.schedule.filter((c) => c.am || c.pm).map((c) => c.day);
    // `placements` carries the user's per-day session arrangement so the
    // server materialiser can land each canonical template on the day the
    // user actually picked. `days` + `twoADay` are kept for the day-pref
    // localStorage hint + UI consumers that don't need session identity.
    const placements = buildPlacementsFromSchedule(state.schedule);
    const dayIndexOverrides = { days: usedDays, twoADay: state.twoADay, placements };
    if (typeof window !== "undefined") {
      const sessionCount = state.schedule.reduce(
        (n, c) => n + (c.am ? 1 : 0) + (c.pm ? 1 : 0),
        0,
      );
      const merged = writeDayPref(
        window.localStorage,
        resolved.id,
        sessionCount,
        dayIndexOverrides,
        serverDayPref,
      );
      if (saveDayPrefAction) void saveDayPrefAction(merged);
    }
    startTransition(async () => {
      const result = await onComplete({
        archetypeId: out.archetypeId,
        daysPerWeek: out.daysPerWeek,
        dayIndexOverrides,
        power: state.power,
        cardioSource: state.externalCardio ? "external" : "internal",
        cardioSourceName: state.externalCardio ? state.externalCardioName.trim() : "",
        focusMuscles: state.focusMuscles.slice(),
        goal: state.goal,
        secondary: state.secondary,
        accessoryVolume: state.accessoryVolume,
      });
      if (!result.ok) setSubmitError(result.error);
    });
  };

  const startDisabled = state.step === 5 && (!resolved || (tmGate && !tmGate.ready) || pending);

  return (
    <div className="wiz-layout" style={layoutStyle}>
      <div>
        <ProgressBar step={state.step} />
        {state.step === 1 && (
          <Step1Days
            state={state}
            dispatch={dispatch}
            allowsTwoADays={allowsTwoADays}
          />
        )}
        {state.step === 2 && <Step2Focus state={state} dispatch={dispatch} resolved={resolved} />}
        {state.step === 3 && <Step3Secondary state={state} dispatch={dispatch} />}
        {state.step === 4 && resolved && (
          <Step4Review state={state} dispatch={dispatch} resolved={resolved} equipmentPreset={equipmentPreset} estimateAction={estimateAccessoryVolumeAction} />
        )}
        {state.step === 5 && resolved && (
          <Step5Schedule
            state={state}
            dispatch={dispatch}
            resolved={resolved}
          />
        )}

        {state.step === 5 && tmGate && !tmGate.ready && (
          <div style={errorBoxStyle}>
            <strong>Set your training maxes first.</strong>{" "}
            {tmGate.missingRoles.length > 0
              ? `No TM set for: ${tmGate.missingRoles.join(", ")}. Open Settings → Training maxes to add one for each.`
              : "Open Settings → Training maxes to add the lifts this block needs."}
          </div>
        )}
        {submitError && <div style={errorBoxStyle}>{submitError}</div>}

        <footer className="wiz-footer" style={footerStyle}>
          {state.step > 1 && (
            <button
              type="button"
              onClick={() => dispatch({ type: "back" })}
              className="wiz-footer-back"
              style={ghostBtnStyle(false)}
            >
              ← back
            </button>
          )}
          <button
            type="button"
            onClick={handleNext}
            disabled={!canContinue || startDisabled}
            className="wiz-footer-primary"
            style={{ ...primaryBtnStyle(!canContinue || !!startDisabled), marginLeft: "auto" }}
          >
            {pending && state.step === 5 ? "Starting…" : nextLabel}
          </button>
        </footer>
      </div>

      <aside className="wiz-sidebar-col" style={sidebarColStyle}>
        <WizardSidebar state={state} resolved={resolved} equipmentPreset={equipmentPreset} />
      </aside>

      {pending && state.step === 5 && !submitError && <BlockCreatingOverlay />}
    </div>
  );
}

// ── Local layout styles (kept inline so the wizard is self-contained) ─────

const layoutStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "minmax(0, 1fr) 360px",
  gap: 28,
  alignItems: "start",
};

const sidebarColStyle: React.CSSProperties = {
  position: "sticky",
  top: 16,
};

const footerStyle: React.CSSProperties = {
  marginTop: 28,
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};

const errorBoxStyle: React.CSSProperties = {
  marginTop: 16,
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid var(--cp-warning, #d97706)",
  color: "var(--cp-text)",
  fontSize: 13,
  lineHeight: 1.5,
};

function ghostBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "inherit",
    borderRadius: 10,
    padding: "12px 20px",
    fontSize: 14,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid transparent",
    background: "transparent",
    color: "var(--cp-text-muted)",
    opacity: disabled ? 0.4 : 1,
  };
}

function primaryBtnStyle(disabled: boolean): React.CSSProperties {
  return {
    fontFamily: "inherit",
    borderRadius: 10,
    padding: "14px 26px",
    fontSize: 15,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    border: "1px solid var(--cp-accent)",
    background: "var(--cp-accent)",
    color: "var(--cp-accent-fg)",
    opacity: disabled ? 0.4 : 1,
  };
}

function ProgressBar({ step }: { step: WizardState["step"] }): React.ReactElement {
  return (
    <div style={{ display: "flex", gap: 6, marginBottom: 20 }}>
      {[1, 2, 3, 4, 5].map((i) => {
        const done = i < step;
        const current = i === step;
        return (
          <div
            key={i}
            style={{
              flex: 1,
              height: 4,
              borderRadius: 999,
              background: done
                ? "var(--cp-accent)"
                : current
                  ? "linear-gradient(to right, var(--cp-accent) 50%, var(--cp-surface-soft) 50%)"
                  : "var(--cp-surface-soft)",
            }}
          />
        );
      })}
    </div>
  );
}

// Re-export the schedule helpers used by step 5 so the sub-component can
// reach them without a longer import path.
export { DAY_LABELS, isHighCNS, sequencingWarnings };
export type { ScheduleCell };

// ── Prefill helpers (Customize first flow) ─────────────────────────────

type PrefilledArchetype =
  | "strength_anchor"
  | "endurance_anchor"
  | "concurrent_hybrid"
  | "hypertrophy_anchor"
  | "maintenance"
  | "rebuild";

/**
 * Narrow a stored archetype slug to one the wizard knows how to render.
 * `custom` blocks fall through (the wizard can't re-shape them) so the
 * caller should fall back to the default empty state.
 */
function prefilledArchetypeId(slug: string): PrefilledArchetype | null {
  switch (slug) {
    case "strength_anchor":
    case "endurance_anchor":
    case "concurrent_hybrid":
    case "hypertrophy_anchor":
    case "maintenance":
    case "rebuild":
      return slug;
    default:
      return null;
  }
}

/**
 * Reverse-map an archetype id back to a wizard {goal, secondary} pair.
 * Hybrid blocks pick the strength→cardio side as a sensible default —
 * the user can flip to muscle→cardio in step 2 if they want.
 *
 * `maintenance` resolves through the synthetic "See lighter options"
 * shortcut so the wizard renders the maintenance pre-step-4 path. We
 * jump straight to step 4 to mirror that flow without forcing the
 * user to re-pick days they already selected.
 */
function wizardStateFromPrefill(prefill: BlockWizardPrefill): WizardState {
  const id = prefilledArchetypeId(prefill.archetype);
  const days = prefill.daysPerWeek;
  const twoADay = prefill.dayIndexOverrides?.twoADay ?? false;

  // Fall back to a clean step-1 start for archetypes the wizard can't
  // re-shape (custom blocks). Days still pre-fills so the user keeps
  // their committed dose.
  if (!id) {
    return { ...initialWizardState, days };
  }

  if (id === "maintenance") {
    return {
      ...initialWizardState,
      days,
      goal: null,
      secondary: "maintenance",
      twoADay: false,
      cameFromMaintenanceLink: true,
      step: 4,
    };
  }

  if (id === "rebuild") {
    return {
      ...initialWizardState,
      days,
      goal: "resilience",
      secondary: "skip",
      twoADay,
      step: 4,
    };
  }

  if (id === "endurance_anchor") {
    return {
      ...initialWizardState,
      days,
      goal: "cardio",
      secondary: "skip",
      twoADay,
      step: 4,
    };
  }

  if (id === "hypertrophy_anchor") {
    return {
      ...initialWizardState,
      days,
      goal: "muscle",
      secondary: "skip",
      twoADay,
      step: 4,
    };
  }

  if (id === "concurrent_hybrid") {
    return {
      ...initialWizardState,
      days,
      goal: "strength",
      secondary: "cardio",
      twoADay,
      step: 4,
    };
  }

  // strength_anchor
  return {
    ...initialWizardState,
    days,
    goal: "strength",
    secondary: "skip",
    twoADay,
    step: 4,
  };
}
