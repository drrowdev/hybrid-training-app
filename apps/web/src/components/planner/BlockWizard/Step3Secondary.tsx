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

      <ExternalCardioPanel state={state} dispatch={dispatch} />
    </section>
  );
}

/**
 * Phase 1 "external cardio" — opt-in panel. When checked, the planner
 * reserves cardio days but emits a single placeholder item so the user
 * can log via Runna / Garmin Coach / Hal Higdon / etc. Pre-filled from
 * `profile.preferred_cardio_source` upstream so the toggle reflects the
 * user's standing preference without forcing a re-check every block.
 */
function ExternalCardioPanel({
  state,
  dispatch,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
}): React.ReactElement {
  const checked = state.externalCardio;
  return (
    <div data-testid="wiz-external-cardio-panel" style={externalCardioPanelStyle(checked)}>
      <label style={{ display: "flex", gap: 10, cursor: "pointer", alignItems: "flex-start" }}>
        <input
          type="checkbox"
          checked={checked}
          onChange={() => dispatch({ type: "toggle-external-cardio" })}
          data-testid="wiz-external-cardio-toggle"
          style={{ marginTop: 3 }}
        />
        <span style={{ display: "grid", gap: 4 }}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>
            Follow an external run program
          </span>
          <span style={{ fontSize: 12, color: "var(--cp-text-muted)", lineHeight: 1.5 }}>
            Reserves cardio days for recovery math but lets you log runs via
            your program of choice (Runna, Garmin Coach, Hal Higdon, etc.).
          </span>
        </span>
      </label>
      {checked && (
        <label
          style={{
            display: "grid",
            gap: 4,
            marginTop: 10,
            fontSize: 11,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
          }}
        >
          Program name (optional)
          <input
            type="text"
            value={state.externalCardioName}
            onChange={(e) =>
              dispatch({ type: "set-external-cardio-name", name: e.target.value })
            }
            data-testid="wiz-external-cardio-name"
            placeholder="Runna"
            maxLength={80}
            style={externalCardioNameInputStyle}
          />
        </label>
      )}
    </div>
  );
}

function externalCardioPanelStyle(checked: boolean): React.CSSProperties {
  return {
    marginTop: 16,
    padding: "14px 16px",
    background: checked ? "var(--cp-accent-soft)" : "var(--cp-surface)",
    border: `1px solid ${checked ? "var(--cp-accent)" : "var(--cp-border)"}`,
    borderRadius: 12,
  };
}

const externalCardioNameInputStyle: React.CSSProperties = {
  padding: "8px 10px",
  borderRadius: 8,
  border: "1px solid var(--cp-border)",
  background: "var(--cp-surface)",
  color: "var(--cp-text)",
  fontFamily: "inherit",
  fontSize: 13,
  textTransform: "none",
  letterSpacing: "normal",
};

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
