/**
 * Step 2 — Choose your first focus. Four goal cards plus an optional
 * "Add power emphasis" toggle when the resolved archetype supports it.
 */
"use client";

import type { Dispatch } from "react";
import type { WizardAction, WizardState } from "@/lib/planner/wizard/wizard-state";
import type { Goal, ResolvedArchetype } from "@/lib/planner/wizard/wizard-mapping";
import { getAdaptationGuidance } from "@/lib/planner/adaptation-guidance";
import {
  GOALS,
  cardGridStyle,
  goalCardStyle,
  goalCardTick,
  pillStyle,
  subStyle,
  titleStyle,
} from "./shared";
import { FocusMuscleChips } from "@/components/planner/FocusMuscleChips";
import { FOCUS_MUSCLE_MAX } from "@/lib/planner/focus-muscles";

export function Step2Focus({
  state,
  dispatch,
  resolved,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  resolved: ResolvedArchetype | null;
}): React.ReactElement {
  const powerEligible = !!resolved?.powerEligible;
  const guidance = getAdaptationGuidance(state.goal, state.secondary);
  return (
    <section>
      <div style={pillStyle}>Step 2 of 5</div>
      <h1 className="wiz-title" style={titleStyle}>Choose your first focus</h1>
      <p className="wiz-sub" style={subStyle}>
        The quality that leads. The others get maintenance dosing around it.
      </p>

      <div className="wiz-card-grid" style={cardGridStyle}>
        {(Object.keys(GOALS) as Goal[]).map((g) => {
          const selected = state.goal === g;
          const data = GOALS[g];
          return (
            <button
              key={g}
              type="button"
              onClick={() => dispatch({ type: "set-goal", goal: g })}
              style={goalCardStyle(selected)}
            >
              <span style={goalCardTick(selected)}>✓</span>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{data.icon}</span>
              <h3 style={cardTitleStyle}>{data.name}</h3>
              <p style={cardOutcomeStyle}>{data.outcome}</p>
            </button>
          );
        })}
      </div>

      {guidance && (
        <p
          className="wiz-adaptation-hint"
          style={adaptationHintStyle}
          data-testid="wiz-adaptation-hint"
        >
          <span aria-hidden="true" style={{ marginRight: 6 }}>ⓘ</span>
          {guidance.summary}
          <span style={citationStyle}> · {guidance.citation}</span>
        </p>
      )}

      {powerEligible && (
        <div className="wiz-power-row" style={powerToggleRowStyle}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Add power emphasis</div>
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: 3 }}>
              Explosive intent on main lifts, extra plyometrics, fewer high-rep accessories. Pairs
              well with a strength focus.
            </div>
            <div
              className="wiz-power-disclosure"
              style={{
                fontSize: 11.5,
                color: "var(--cp-text-muted)",
                marginTop: 6,
                fontStyle: "italic",
                opacity: 0.85,
              }}
            >
              Trades top-end strength for explosive output. Best alongside, not instead of, your
              usual strength block.
            </div>
          </div>
          <button
            type="button"
            aria-pressed={state.power}
            aria-label="Add power emphasis"
            title="Trades top-end strength for explosive output. Best alongside, not instead of, your usual strength block."
            onClick={() => dispatch({ type: "toggle-power" })}
            className="wiz-toggle-switch"
            style={switchStyle(state.power)}
          >
            <span className="wiz-toggle-knob" style={knobStyle(state.power)} />
          </button>
        </div>
      )}

      <div className="wiz-focus-muscles" style={focusMuscleSectionStyle}>
        <div style={{ fontSize: 14, fontWeight: 600 }}>
          Focus muscle groups{" "}
          <span style={{ fontWeight: 400, color: "var(--cp-text-muted)", fontSize: 12 }}>
            (optional)
          </span>
        </div>
        <p style={focusMuscleDescStyle}>
          Pick up to {FOCUS_MUSCLE_MAX}. The engine will bias your accessory work toward
          these groups while keeping total session volume the same.
        </p>
        <FocusMuscleChips
          selected={state.focusMuscles}
          onToggle={(muscle) => dispatch({ type: "toggle-focus-muscle", muscle })}
        />
      </div>
    </section>
  );
}

const cardTitleStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 16,
  fontWeight: 600,
  letterSpacing: "-0.01em",
};
const cardOutcomeStyle: React.CSSProperties = {
  fontSize: 12.5,
  color: "var(--cp-text-muted)",
  lineHeight: 1.45,
  margin: 0,
};

const adaptationHintStyle: React.CSSProperties = {
  marginTop: 14,
  marginBottom: 0,
  color: "var(--cp-text-muted)",
  fontSize: 13,
  lineHeight: 1.5,
  maxWidth: 720,
};

const citationStyle: React.CSSProperties = {
  color: "var(--cp-text-soft)",
  fontSize: 11.5,
  marginLeft: 2,
};

const powerToggleRowStyle: React.CSSProperties = {
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 14,
  maxWidth: 720,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const focusMuscleSectionStyle: React.CSSProperties = {
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 14,
  maxWidth: 720,
  display: "grid",
  gap: 8,
};

const focusMuscleDescStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: "var(--cp-text-muted)",
  lineHeight: 1.45,
};

function switchStyle(on: boolean): React.CSSProperties {
  return {
    position: "relative",
    width: 42,
    height: 24,
    background: on ? "var(--cp-accent)" : "var(--cp-surface-soft)",
    border: `1px solid ${on ? "var(--cp-accent)" : "var(--cp-border)"}`,
    borderRadius: 999,
    cursor: "pointer",
    padding: 0,
    flexShrink: 0,
  };
}

function knobStyle(on: boolean): React.CSSProperties {
  return {
    position: "absolute",
    top: 2,
    left: 2,
    width: 18,
    height: 18,
    background: on ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
    borderRadius: 999,
    transform: `translateX(${on ? 18 : 0}px)`,
    transition: "transform .15s, background .15s",
  };
}
