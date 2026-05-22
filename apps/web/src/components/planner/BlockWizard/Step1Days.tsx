/**
 * Step 1 — How many days a week?
 * Days segmented control + two-a-day toggle + "See lighter options" link.
 * Copy ported verbatim from the mockup.
 */
"use client";

import type { Dispatch } from "react";
import type { WizardAction, WizardState } from "@/lib/planner/wizard/wizard-state";

const DAY_CONTEXT: Record<number, string> = {
  1: "One day = maintenance only. Holds strength and aerobic base; not enough for adaptation.",
  2: "Two days = minimum for progress. One quality leads, the other gets a maintenance dose.",
  3: "Three days = full-body, upper/lower split, or compressed two-a-day.",
  4: "Four days = the sweet spot most focuses are calibrated around.",
  5: "Five days = drive a primary quality hard and maintain the others.",
  6: "Six days = high-volume territory.",
  7: "Seven days a week. Every day on.",
};

function advisoryLines(days: number | null, twoADay: boolean): string[] {
  if (days == null) return [];
  const sessions = twoADay ? days * 2 : days;
  const out: string[] = [];
  if (sessions === 1) {
    out.push(
      "Just one session a week is a maintenance dose — enough to hold what you have, not enough to drive new adaptation. Pick this if life is the limiting factor right now.",
    );
  } else if (sessions === 2) {
    out.push(
      "Two sessions a week is the edge of effective volume. Pick one clear primary focus — chasing two qualities at this dose tends to stall both.",
    );
  }
  if (days === 7 && twoADay) {
    out.push(
      "14 sessions a week with no off day is elite-athlete territory. Training every day with no rest keeps daily load uniformly high — overreach risk climbs quickly at this dose. Strongly consider at least one full rest day, or 5–6 days with two-a-day on a few of them.",
    );
  } else if (days === 7) {
    out.push(
      "Seven days on, zero off. A weekly rest day breaks the day-to-day load pattern; without one, fatigue accumulates faster than you can recover — a documented driver of overreach. Consider 5–6 days with one rest day.",
    );
  } else if (sessions >= 10) {
    out.push(
      `${sessions} sessions in ${days} calendar days is a heavy training load. Sleep, nutrition, and stress need to be dialled in to absorb this dose without overreaching.`,
    );
  } else if (sessions >= 8) {
    out.push(
      `${sessions} sessions in ${days} calendar days is high volume but workable. Lean on the off day${7 - days > 1 ? "s" : ""} and watch for early-fatigue signals.`,
    );
  }
  return out;
}

function twoADayHint(state: WizardState): string {
  // Hint stays neutral pre-step-2; once the user has a focus we surface the
  // AM/PM order in the same shape the mockup did.
  if (!state.goal) return "Pair AM and PM sessions on the same day, with at least 6 h between.";
  const map: Record<NonNullable<WizardState["goal"]>, string> = {
    strength: "lift",
    muscle: "lift",
    cardio: "cardio",
    resilience: "tendon work",
  };
  const am = map[state.goal];
  let pm: string | null;
  const s = state.secondary;
  if (s && s !== "skip" && s !== "maintenance") pm = map[s];
  else if (s === "skip") pm = map[state.goal];
  else if (state.goal === "strength" || state.goal === "muscle") pm = "easy cardio";
  else if (state.goal === "cardio") pm = "easy lift";
  else pm = null;
  if (!pm) return "Pair AM and PM sessions on the same day, with at least 6 h between.";
  return `${am} in the morning · ${pm} in the evening, ≥6 h apart.`;
}

export function Step1Days({
  state,
  dispatch,
  allowsTwoADays,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  allowsTwoADays: boolean;
}): React.ReactElement {
  const lines = advisoryLines(state.days, state.twoADay);

  return (
    <section>
      <div style={pillStyle}>Step 1 of 5</div>
      <h1 style={titleStyle}>How many days a week?</h1>
      <p style={subStyle}>
        Be honest about what you&apos;ll actually do. The plan adjusts — 4 consistent days beat 6
        inconsistent ones every time.
      </p>

      <div style={segStyle}>
        {[1, 2, 3, 4, 5, 6, 7].map((n) => {
          const active = state.days === n;
          return (
            <button
              key={n}
              type="button"
              onClick={() => dispatch({ type: "set-days", days: n })}
              style={segBtnStyle(active)}
            >
              {n}
            </button>
          );
        })}
      </div>
      <div style={contextStyle}>
        {state.days == null ? "Pick a number to continue." : DAY_CONTEXT[state.days]}
      </div>

      {lines.length > 0 && (
        <div style={advisoryStyle}>
          <span style={infoIconStyle} aria-hidden="true">
            i
          </span>
          <div style={{ flex: 1 }}>
            {lines.map((l, i) => (
              <p key={i} style={{ margin: i === 0 ? 0 : "6px 0 0" }}>
                {l}
              </p>
            ))}
          </div>
        </div>
      )}

      {allowsTwoADays && (
        <div style={toggleRowStyle}>
          <div>
            <div style={toggleLabelStyle}>Two-a-day split</div>
            <div style={toggleHintStyle}>{twoADayHint(state)}</div>
          </div>
          <button
            type="button"
            aria-pressed={state.twoADay}
            onClick={() => dispatch({ type: "toggle-two-a-day" })}
            style={switchStyle(state.twoADay)}
          >
            <span style={switchKnobStyle(state.twoADay)} />
          </button>
        </div>
      )}

      <div style={specialLinkStyle}>
        Returning from a long break or just maintaining for a busy stretch?{" "}
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            dispatch({ type: "maintenance-link" });
          }}
          style={{ color: "var(--cp-link)", textDecoration: "none", fontWeight: 500 }}
        >
          See lighter options →
        </a>
      </div>
    </section>
  );
}

// ── Styles (verbatim port from mockup CSS classes) ────────────────────────
const pillStyle: React.CSSProperties = {
  display: "inline-block",
  fontSize: 11,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
  marginBottom: 4,
};
const titleStyle: React.CSSProperties = {
  fontSize: 28,
  margin: 0,
  letterSpacing: "-0.01em",
  fontWeight: 700,
};
const subStyle: React.CSSProperties = {
  color: "var(--cp-text-muted)",
  fontSize: 14,
  margin: "8px 0 24px",
  maxWidth: 560,
};
const segStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  background: "var(--cp-surface)",
  border: "1.5px solid var(--cp-border)",
  borderRadius: 14,
  padding: 4,
  maxWidth: 560,
};

function segBtnStyle(active: boolean): React.CSSProperties {
  return {
    background: active ? "var(--cp-accent)" : "transparent",
    color: active ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
    border: "none",
    padding: "12px 0",
    fontSize: 15,
    fontWeight: 600,
    cursor: "pointer",
    borderRadius: 8,
    fontFamily: "inherit",
  };
}

const contextStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--cp-text-muted)",
  marginTop: 10,
  maxWidth: 560,
};
const advisoryStyle: React.CSSProperties = {
  marginTop: 10,
  padding: "10px 14px",
  borderRadius: 10,
  background: "color-mix(in oklab, var(--cp-link) 10%, transparent)",
  border: "1px solid color-mix(in oklab, var(--cp-link) 50%, var(--cp-border))",
  color: "var(--cp-text)",
  fontSize: 12,
  lineHeight: 1.5,
  maxWidth: 560,
  display: "flex",
  gap: 10,
  alignItems: "flex-start",
};
const infoIconStyle: React.CSSProperties = {
  flexShrink: 0,
  width: 18,
  height: 18,
  borderRadius: 999,
  background: "var(--cp-link)",
  color: "var(--cp-accent-fg)",
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  fontSize: 11,
  fontWeight: 700,
  fontStyle: "italic",
  fontFamily: "Georgia, serif",
  marginTop: 1,
};
const toggleRowStyle: React.CSSProperties = {
  background: "var(--cp-surface)",
  border: "1px solid var(--cp-border)",
  borderRadius: 12,
  padding: "14px 18px",
  marginTop: 14,
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
  maxWidth: 480,
};
const toggleLabelStyle: React.CSSProperties = { fontSize: 14, fontWeight: 500 };
const toggleHintStyle: React.CSSProperties = {
  fontSize: 12,
  color: "var(--cp-text-muted)",
  marginTop: 3,
};
const specialLinkStyle: React.CSSProperties = {
  marginTop: 22,
  padding: "12px 0 0",
  borderTop: "1px solid var(--cp-border)",
  fontSize: 13,
  color: "var(--cp-text-muted)",
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

function switchKnobStyle(on: boolean): React.CSSProperties {
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
