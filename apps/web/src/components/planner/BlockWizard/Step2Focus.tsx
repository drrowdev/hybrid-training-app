/**
 * Step 2 — Choose your first focus. Four goal cards plus an optional
 * "Add power emphasis" toggle when the resolved archetype supports it.
 */
"use client";

import type { Dispatch } from "react";
import type { WizardAction, WizardState } from "@/lib/planner/wizard/wizard-state";
import type { Goal, ResolvedArchetype } from "@/lib/planner/wizard/wizard-mapping";
import {
  GOALS,
  cardGridStyle,
  goalCardStyle,
  goalCardTick,
  pillStyle,
  subStyle,
  titleStyle,
} from "./shared";

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
