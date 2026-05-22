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

import { useEffect, useMemo, useReducer, useState, useTransition } from "react";
import {
  initialWizardState,
  wizardReducer,
  type WizardState,
} from "@/lib/planner/wizard/wizard-state";
import {
  resolveArchetype,
  wizardOutput,
  type ResolvedArchetype,
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
  migrateV1IfNeeded,
  readDayPref,
  writeDayPref,
} from "@/lib/planner/wizard/day-pref";
import { Step1Days } from "./Step1Days";
import { Step2Focus } from "./Step2Focus";
import { Step3Secondary } from "./Step3Secondary";
import { Step4Review } from "./Step4Review";
import { Step5Schedule } from "./Step5Schedule";
import { WizardSidebar } from "./WizardSidebar";

export type WizardSubmit = {
  archetypeId: ResolvedArchetype["id"];
  daysPerWeek: number;
  dayIndexOverrides: { days: number[]; twoADay: boolean };
  power: boolean;
};

export type TmGate = {
  /** When false, "Start this block" is disabled with the error message below. */
  ready: boolean;
  /** Human-readable list of missing strength roles. */
  missingRoles: string[];
};

export type TmReadinessByArchetype = Record<ResolvedArchetype["id"], TmGate>;

export type BlockWizardProps = {
  onComplete: (submit: WizardSubmit) => Promise<{ ok: true } | { ok: false; error: string }>;
  /** TM-readiness per resolved archetype id. Computed server-side from the user's TM context. */
  tmReadinessByArchetype: TmReadinessByArchetype;
  /** When false, the two-a-day toggle stays disabled (matches profile flag). */
  allowsTwoADays: boolean;
};

export function BlockWizard({
  onComplete,
  tmReadinessByArchetype,
  allowsTwoADays,
}: BlockWizardProps): React.ReactElement {
  const [state, dispatch] = useReducer(wizardReducer, initialWizardState);
  const [pending, startTransition] = useTransition();
  const [submitError, setSubmitError] = useState<string | null>(null);

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
    const pref = storage ? readDayPref(storage, resolved.id, sessionCount) : null;
    const used = applySavedPrefIfPossible(cells, pref, state.twoADay);
    dispatch({ type: "set-schedule", schedule: cells, sig, usingSavedPref: used });
  }, [state.step, state.scheduleSig, state.goal, state.secondary, state.twoADay, state.power, resolved]);

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
    const dayIndexOverrides = { days: usedDays, twoADay: state.twoADay };
    if (typeof window !== "undefined") {
      const sessionCount = state.schedule.reduce(
        (n, c) => n + (c.am ? 1 : 0) + (c.pm ? 1 : 0),
        0,
      );
      writeDayPref(window.localStorage, resolved.id, sessionCount, dayIndexOverrides);
    }
    startTransition(async () => {
      const result = await onComplete({
        archetypeId: out.archetypeId,
        daysPerWeek: out.daysPerWeek,
        dayIndexOverrides,
        power: state.power,
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
          <Step4Review state={state} resolved={resolved} />
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
          <button
            type="button"
            onClick={() => dispatch({ type: "back" })}
            disabled={state.step === 1}
            className="wiz-footer-back"
            style={ghostBtnStyle(state.step === 1)}
          >
            ← back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!canContinue || startDisabled}
            className="wiz-footer-primary"
            style={primaryBtnStyle(!canContinue || !!startDisabled)}
          >
            {pending && state.step === 5 ? "Starting…" : nextLabel}
          </button>
        </footer>
      </div>

      <aside className="wiz-sidebar-col" style={sidebarColStyle}>
        <WizardSidebar state={state} resolved={resolved} />
      </aside>
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
