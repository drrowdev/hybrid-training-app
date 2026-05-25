/**
 * Step 5 — Lay out your week. Renders the 7-cell Mon..Sun grid with
 * click-to-swap and HTML5 drag-and-drop interactions.
 *
 * Click semantics (verbatim from the mockup):
 *   • First click on an occupied cell → marks it as the swap source.
 *   • Second click on another cell → swaps AM/PM payloads of the two cells.
 *     Empty target = effectively moves the session to the rest day.
 *   • Click the source again → cancels the pending swap.
 *
 * Drag semantics (desktop / mouse augmentation):
 *   • Drag a non-rest cell onto any other cell → swap/move (same semantics
 *     as the click path; rest target = move).
 *   • Drag cancelled (drop outside) → no change.
 *
 * DC-D4 / DC-K4: when a swap creates a high-CNS adjacency, we surface the
 * warning but do not block. The post-placement spacer runs only on the
 * default schedule — user swaps are intentional.
 */
"use client";

import type { Dispatch, DragEvent } from "react";
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

  const handleDragStart = (idx: number) => (e: DragEvent<HTMLDivElement>): void => {
    const cell = state.schedule[idx];
    if (!cell || (!cell.am && !cell.pm)) {
      e.preventDefault();
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    // Some browsers (Firefox) require setData to actually initiate a drag.
    try {
      e.dataTransfer.setData("text/plain", String(idx));
    } catch {
      // ignore — Safari occasionally throws under restricted contexts
    }
    dispatch({ type: "drag-start", idx });
  };

  const handleDragOver = (idx: number) => (e: DragEvent<HTMLDivElement>): void => {
    if (state.dragSourceIdx === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    if (state.dragOverIdx !== idx) dispatch({ type: "drag-over", idx });
  };

  const handleDragEnter = (idx: number) => (e: DragEvent<HTMLDivElement>): void => {
    if (state.dragSourceIdx === null) return;
    e.preventDefault();
    if (state.dragOverIdx !== idx) dispatch({ type: "drag-over", idx });
  };

  const handleDrop = (idx: number) => (e: DragEvent<HTMLDivElement>): void => {
    e.preventDefault();
    const src = state.dragSourceIdx;
    if (src === null || src === idx) {
      dispatch({ type: "drag-end" });
      return;
    }
    dispatch({ type: "apply-swap", sourceIdx: src, targetIdx: idx });
  };

  const handleDragEnd = (): void => {
    dispatch({ type: "drag-end" });
  };

  return (
    <section>
      <div style={pillStyle}>Step 5 of 5 · Schedule</div>
      <h1 className="wiz-title" style={titleStyle}>Lay out your week</h1>
      <p className="wiz-sub" style={subStyle}>
        Pick the days you&apos;ll train. Tap two sessions to swap them — we&apos;ll flag spacing
        issues.
      </p>

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
            isDragSource={state.dragSourceIdx === idx}
            isDragOver={
              state.dragSourceIdx !== null &&
              state.dragOverIdx === idx &&
              state.dragSourceIdx !== idx
            }
            onClick={() => handleCellClick(idx)}
            onDragStart={handleDragStart(idx)}
            onDragEnter={handleDragEnter(idx)}
            onDragOver={handleDragOver(idx)}
            onDrop={handleDrop(idx)}
            onDragEnd={handleDragEnd}
          />
        ))}
      </div>

      {state.usingSavedPref && (
        <p style={prefNoteStyle}>
          Layout loaded from your last block.{" "}
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleResetDefaults();
            }}
            style={prefNoteLinkStyle}
          >
            Reset to defaults
          </a>
        </p>
      )}

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

      {!state.usingSavedPref && (
        <p style={prefNoteStyle}>
          <a
            href="#"
            onClick={(e) => {
              e.preventDefault();
              handleResetDefaults();
            }}
            style={prefNoteLinkStyle}
          >
            Reset to defaults
          </a>
        </p>
      )}
    </section>
  );
}

function DayCell({
  cell,
  twoADay,
  isConflict,
  isSwapSource,
  otherSwap,
  isDragSource,
  isDragOver,
  onClick,
  onDragStart,
  onDragEnter,
  onDragOver,
  onDrop,
  onDragEnd,
}: {
  cell: ScheduleCell;
  idx: number;
  twoADay: boolean;
  isConflict: boolean;
  isSwapSource: boolean;
  otherSwap: boolean;
  isDragSource: boolean;
  isDragOver: boolean;
  onClick: () => void;
  onDragStart: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnter: (e: DragEvent<HTMLDivElement>) => void;
  onDragOver: (e: DragEvent<HTMLDivElement>) => void;
  onDrop: (e: DragEvent<HTMLDivElement>) => void;
  onDragEnd: (e: DragEvent<HTMLDivElement>) => void;
}): React.ReactElement {
  const isRest = !cell.am && !cell.pm;
  return (
    <div
      onClick={onClick}
      className="wiz-day-cell"
      draggable={!isRest}
      onDragStart={onDragStart}
      onDragEnter={onDragEnter}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={dayCellStyle({ isRest, isConflict, isSwapSource, otherSwap, isDragSource, isDragOver })}
    >
      <div style={dayLabelStyle}>
        <span>{DAY_LABELS[cell.day]}</span>
        {isConflict && <span style={{ color: "var(--cp-warning, #d97706)", fontSize: 12 }}>⚠</span>}
      </div>
      {isRest ? (
        <div style={restPlaceholderStyle}>Rest</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
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
  gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
  gap: 8,
  marginTop: 16,
};

function dayCellStyle({
  isRest,
  isConflict,
  isSwapSource,
  otherSwap,
  isDragSource,
  isDragOver,
}: {
  isRest: boolean;
  isConflict: boolean;
  isSwapSource: boolean;
  otherSwap: boolean;
  isDragSource: boolean;
  isDragOver: boolean;
}): React.CSSProperties {
  let borderColor = "var(--cp-border)";
  let borderWidth = 1;
  let borderStyle: React.CSSProperties["borderStyle"] = "solid";
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
  if (isDragOver) {
    borderColor = "var(--cp-accent)";
    borderWidth = 2;
    borderStyle = "dashed";
  }
  const padding = borderWidth === 2 ? "7px 5px 9px" : "8px 6px 10px";
  return {
    borderRadius: 10,
    background,
    border: `${borderWidth}px ${borderStyle} ${borderColor}`,
    padding,
    minHeight: 110,
    minWidth: 0,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    cursor: "pointer",
    userSelect: "none",
    opacity: isDragSource ? 0.5 : 1,
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
    overflow: "hidden",
    minWidth: 0,
  };
}

const chipTitleStyle: React.CSSProperties = {
  fontWeight: 600,
  display: "flex",
  alignItems: "flex-start",
  gap: 4,
  overflowWrap: "break-word",
  minWidth: 0,
};

const chipMetaStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  overflowWrap: "break-word",
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

const prefNoteStyle: React.CSSProperties = {
  marginTop: 12,
  marginBottom: 0,
  fontSize: 11,
  color: "var(--cp-text-muted)",
};

const prefNoteLinkStyle: React.CSSProperties = {
  color: "var(--cp-link)",
  textDecoration: "none",
};
