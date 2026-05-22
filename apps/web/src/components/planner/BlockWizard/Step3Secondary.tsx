/**
 * Step 3 — Choose your second focus. Shows the remaining three goal cards
 * (resilience is never an option here; it skips this step entirely) plus a
 * "Skip — keep this block single-focus" row.
 */
"use client";

import type { Dispatch } from "react";
import type { WizardAction, WizardState } from "@/lib/planner/wizard/wizard-state";
import type { Goal } from "@/lib/planner/wizard/wizard-mapping";
import {
  GOALS,
  cardGridStyle,
  goalCardStyle,
  goalCardTick,
  pillStyle,
  subStyle,
  titleStyle,
} from "./shared";

export function Step3Secondary({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
}): React.ReactElement {
  const options = (Object.keys(GOALS) as Goal[]).filter(
    (g) => g !== state.goal && g !== "resilience",
  );
  return (
    <section>
      <div style={pillStyle}>Step 3 of 5</div>
      <h1 className="wiz-title" style={titleStyle}>Choose your second focus</h1>
      <p className="wiz-sub" style={subStyle}>
        Biases accessory work and cardio dose around the first focus. Pick one — or skip to go
        all-in.
      </p>

      <div className="wiz-card-grid" style={cardGridStyle}>
        {options.map((g) => {
          const selected = state.secondary === g;
          const data = GOALS[g];
          return (
            <button
              key={g}
              type="button"
              onClick={() => dispatch({ type: "set-secondary", secondary: g })}
              style={goalCardStyle(selected)}
            >
              <span style={goalCardTick(selected)}>✓</span>
              <span style={{ fontSize: 24, lineHeight: 1 }}>{data.icon}</span>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{data.name}</h3>
              <p style={{ fontSize: 12.5, color: "var(--cp-text-muted)", margin: 0, lineHeight: 1.45 }}>
                {data.outcome}
              </p>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => dispatch({ type: "set-secondary", secondary: "skip" })}
        style={skipRowStyle(state.secondary === "skip")}
      >
        <span>Skip — keep this block single-focus.</span>
        <span style={{ fontSize: 18 }}>→</span>
      </button>
    </section>
  );
}

function skipRowStyle(selected: boolean): React.CSSProperties {
  return {
    marginTop: 12,
    padding: "14px 18px",
    background: selected ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    border: `1.5px ${selected ? "solid var(--cp-accent)" : "dashed var(--cp-border)"}`,
    borderRadius: 14,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    fontFamily: "inherit",
    color: selected ? "var(--cp-text)" : "var(--cp-text-muted)",
    fontSize: 13,
    width: "100%",
  };
}
