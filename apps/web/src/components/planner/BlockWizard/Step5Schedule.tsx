/**
 * Step 5 — Lay out your week. Renders the 7-cell Mon..Sun grid with
 * click-to-swap interaction and a "Reset to defaults" button.
 *
 * Click semantics (verbatim from the mockup):
 *   • First click on an occupied cell → marks it as the swap source.
 *   • Second click on another cell → swaps AM/PM payloads of the two cells.
 *     Empty target = effectively moves the session to the rest day.
 *   • Click the source again → cancels the pending swap.
 *
 * DC-D4 / DC-K4: when a swap creates a high-CNS adjacency, we surface the
 * warning but do not block. The post-placement spacer runs only on the
 * default schedule — user swaps are intentional.
 */
"use client";

import type { Dispatch } from "react";
import type { WizardAction, WizardState } from "@/lib/planner/wizard/wizard-state";
import type { ResolvedArchetype } from "@/lib/planner/wizard/wizard-mapping";
import {
  DAY_LABELS,
  buildWeekShape,
  defaultSchedule,
  isHighCNS,
  sequencingWarnings,
  type ScheduleCell,
  type SessionShape,
} from "@/lib/planner/wizard/schedule";

export function Step5Schedule({
  state,
  dispatch,
  resolved,
}: {
  state: WizardState;
  dispatch: Dispatch<WizardAction>;
  resolved: ResolvedArchetype;
}): React.ReactElement {
  const warnings = sequencingWarnings(state.schedule);
  const conflictDays = new Set(warnings.flatMap((w) => w.days));

  const handleCellClick = (idx: number): void => {
    const cell = state.schedule[idx];
    if (!cell) return;
    if (state.swapSourceIdx === null) {
      if (!cell.am && !cell.pm) return;
      dispatch({ type: "swap-source", idx });
      return;
    }
    if (state.swapSourceIdx === idx) {
      dispatch({ type: "swap-source", idx: null });
      return;
    }
    dispatch({ type: "apply-swap", sourceIdx: state.swapSourceIdx, targetIdx: idx });
  };

  const handleResetDefaults = (): void => {
    const cells = defaultSchedule(resolved, {
      goal: state.goal,
      secondary: state.secondary,
      twoADay: state.twoADay,
    });
    const sessions = buildWeekShape(resolved, {
      goal: state.goal,
      secondary: state.secondary,
    });
    const sig = [
      resolved.id,
      sessions.length,
      state.twoADay ? "2x" : "1x",
      state.power ? "pow" : "",
      state.secondary ?? "",
    ].join("|");
    dispatch({ type: "set-schedule", schedule: cells, sig, usingSavedPref: false });
  };

  return (
    <section>
      <div style={pillStyle}>Step 5 of 5 · Schedule</div>
      <h1 className="wiz-title" style={titleStyle}>Lay out your week</h1>
      <p className="wiz-sub" style={subStyle}>
        Pick the days you&apos;ll train. Tap two sessions to swap them — we&apos;ll flag spacing
        issues.
      </p>

      {state.usingSavedPref && (
        <div style={prefNoteStyle}>
          <span>Using your saved training days.</span>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleResetDefaults();
            }}
            style={{ color: "var(--cp-link)", textDecoration: "none", whiteSpace: "nowrap" }}
          >
            Reset to defaults →
          </a>
        </div>
      )}

      <div className="wiz-week-grid" style={weekGridStyle}>
        {state.schedule.map((cell, idx) => (
          <DayCell
            key={cell.day}
            cell={cell}
            idx={idx}
            twoADay={state.twoADay}
            isConflict={conflictDays.has(cell.day)}
            isSwapSource={state.swapSourceIdx === idx}
            otherSwap={state.swapSourceIdx !== null && state.swapSourceIdx !== idx}
            onClick={() => handleCellClick(idx)}
          />
        ))}
      </div>

      {warnings.length > 0 && (
        <div style={warningsStyle}>
          {warnings.map((w, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : "4px 0 0" }}>
              <span style={{ fontWeight: 700, color: "var(--cp-warning, #d97706)" }}>
                Spacing tip:
              </span>{" "}
              {w.text}
            </p>
          ))}
        </div>
      )}

      <button type="button" onClick={handleResetDefaults} style={resetBtnStyle}>
        Reset to defaults
      </button>
    </section>
  );
}

function DayCell({
  cell,
  twoADay,
  isConflict,
  isSwapSource,
  otherSwap,
  onClick,
}: {
  cell: ScheduleCell;
  idx: number;
  twoADay: boolean;
  isConflict: boolean;
  isSwapSource: boolean;
  otherSwap: boolean;
  onClick: () => void;
}): React.ReactElement {
  const isRest = !cell.am && !cell.pm;
  return (
    <div onClick={onClick} className="wiz-day-cell" style={dayCellStyle({ isRest, isConflict, isSwapSource, otherSwap })}>
      <div style={dayLabelStyle}>
        <span>{DAY_LABELS[cell.day]}</span>
        {isConflict && <span style={{ color: "var(--cp-warning, #d97706)", fontSize: 12 }}>⚠</span>}
      </div>
      {isRest ? (
        <div style={restPlaceholderStyle}>Rest</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          {cell.am && <Chip session={cell.am} label={twoADay ? "AM" : null} />}
          {cell.pm && <Chip session={cell.pm} label={twoADay ? "PM" : null} />}
        </div>
      )}
    </div>
  );
}

function Chip({
  session,
  label,
}: {
  session: SessionShape;
  label: string | null;
}): React.ReactElement {
  const highCNS = isHighCNS(session);
  return (
    <div style={chipStyle(highCNS)}>
      {label && <span style={chipTagStyle}>{label}</span>}
      <div style={chipTitleStyle}>
        {session.icon} {session.title}
      </div>
      {session.meta && <span style={chipMetaStyle}>{session.durationMin} min</span>}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────
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
  margin: "8px 0 16px",
  maxWidth: 560,
};
const weekGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(7, 1fr)",
  gap: 8,
  marginTop: 16,
};

function dayCellStyle({
  isRest,
  isConflict,
  isSwapSource,
  otherSwap,
}: {
  isRest: boolean;
  isConflict: boolean;
  isSwapSource: boolean;
  otherSwap: boolean;
}): React.CSSProperties {
  let borderColor = "var(--cp-border)";
  let borderWidth = 1;
  let borderStyle = "solid";
  let background = isRest ? "var(--cp-bg)" : "var(--cp-surface)";
  if (isRest) borderStyle = "dashed";
  if (isConflict) {
    borderColor = "var(--cp-warning, #d97706)";
    borderWidth = 2;
  }
  if (isSwapSource) {
    borderColor = "var(--cp-accent)";
    borderWidth = 2;
    background = "var(--cp-accent-soft)";
  } else if (otherSwap) {
    borderColor = "var(--cp-link)";
    borderStyle = "dashed";
  }
  return {
    borderRadius: 10,
    background,
    border: `${borderWidth}px ${borderStyle} ${borderColor}`,
    padding: borderWidth === 2 ? "7px 5px 9px" : "8px 6px 10px",
    minHeight: 110,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    cursor: "pointer",
    userSelect: "none",
  };
}

const dayLabelStyle: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 700,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
};

const restPlaceholderStyle: React.CSSProperties = {
  flex: 1,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "var(--cp-text-muted)",
  fontSize: 11,
  fontStyle: "italic",
};

function chipStyle(highCNS: boolean): React.CSSProperties {
  return {
    background: highCNS ? "var(--cp-accent-soft)" : "var(--cp-bg-elevated)",
    border: "1px solid var(--cp-border)",
    borderRadius: 8,
    padding: "6px 7px",
    fontSize: 11,
    color: "var(--cp-text)",
    lineHeight: 1.3,
    display: "flex",
    flexDirection: "column",
    gap: 2,
  };
}

const chipTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  display: "flex",
  alignItems: "center",
  gap: 4,
};

const chipMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
};

const chipTagStyle: React.CSSProperties = {
  fontSize: 9,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 700,
};

const warningsStyle: React.CSSProperties = {
  marginTop: 14,
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid var(--cp-warning, #d97706)",
  fontSize: 12,
  color: "var(--cp-text)",
  lineHeight: 1.5,
};

const resetBtnStyle: React.CSSProperties = {
  marginTop: 14,
  background: "transparent",
  border: "1px solid var(--cp-border)",
  color: "var(--cp-text-muted)",
  borderRadius: 8,
  padding: "6px 12px",
  fontSize: 12,
  cursor: "pointer",
};

const prefNoteStyle: React.CSSProperties = {
  marginTop: 12,
  padding: "8px 12px",
  borderRadius: 8,
  background: "var(--cp-accent-soft)",
  border: "1px solid var(--cp-accent)",
  fontSize: 12,
  color: "var(--cp-text)",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: 12,
};
