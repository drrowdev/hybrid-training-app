/**
 * WizardSidebar — the right-rail live preview. Mirrors the mockup's
 * "Your block" card: archetype name, summary sentence, choice rows,
 * session breakdown, "Where the weekly emphasis goes" mini-chart, and the
 * 4-cell week ladder.
 *
 * All derived state comes from the canonical `resolveArchetype`; the
 * sidebar never re-implements distribution logic.
 */
"use client";

import { useState, type ReactElement } from "react";
import type { WizardState } from "@/lib/planner/wizard/wizard-state";
import type { ResolvedArchetype, Goal } from "@/lib/planner/wizard/wizard-mapping";
import { buildWeekShape, type SessionShape } from "@/lib/planner/wizard/schedule";
import { GOALS } from "./shared";

export function WizardSidebar({
  state,
  resolved,
}: {
  state: WizardState;
  resolved: ResolvedArchetype | null;
}): ReactElement {
  const fullyResolved = !!resolved;
  const name = !fullyResolved ? "Pick a few options →" : resolved.name;
  const summary = summarySentence(state, resolved);

  // Mobile-only accordion state. CSS hides the summary button entirely on
  // desktop (>768 px) and forces the body visible there regardless of
  // `data-open`, so this only affects the phone layout.
  const [open, setOpen] = useState(false);

  const collapsedDays =
    state.days == null ? "—" : `${state.days} day${state.days === 1 ? "" : "s"}/wk`;

  return (
    <div style={previewStyle}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="wiz-sidebar-body"
        className="wiz-sidebar-summary"
        style={summaryToggleStyle}
      >
        <span style={{ display: "flex", flexDirection: "column", gap: 2, alignItems: "flex-start" }}>
          <span style={kickerStyle}>Your block</span>
          <span style={{ fontSize: 14, fontWeight: 600, color: fullyResolved ? "var(--cp-accent)" : "var(--cp-text-muted)" }}>
            {name} · {collapsedDays}
          </span>
        </span>
        <span aria-hidden="true" style={{ fontSize: 18, color: "var(--cp-text-muted)" }}>
          {open ? "▾" : "▸"}
        </span>
      </button>
      <div
        id="wiz-sidebar-body"
        className="wiz-sidebar-body"
        data-open={open ? "true" : "false"}
      >
        <div style={headerStyle}>
          <span style={kickerStyle}>Your block</span>
        </div>
        <div style={nameStyle(fullyResolved)}>{name}</div>
        <p style={summaryStyle}>{summary}</p>

        <div style={{ display: "grid", gap: 6, marginBottom: 14 }}>
          <Row icon="📅" label="Days a week" value={state.days == null ? null : `${state.days} day${state.days === 1 ? "" : "s"}`} />
          {state.secondary === "maintenance" && !state.goal ? (
            <Row icon="🌴" label="Mode" value="Maintenance (busy stretch)" />
          ) : (
            <>
              <Row
                icon={state.goal ? GOALS[state.goal].icon : "🎯"}
                label="First focus"
                value={state.goal ? GOALS[state.goal].name : null}
              />
              {state.goal !== "resilience" && (
                <Row
                  icon={
                    state.secondary && state.secondary !== "skip" && state.secondary !== "maintenance"
                      ? GOALS[state.secondary as Goal].icon
                      : "➕"
                  }
                  label="Second focus"
                  value={
                    state.secondary === "skip"
                      ? "Single-focus"
                      : state.secondary && state.secondary !== "maintenance"
                        ? GOALS[state.secondary as Goal].name
                        : null
                  }
                />
              )}
            </>
          )}

          {resolved && (
            <>
              <div style={{ height: 1, background: "var(--cp-border)", margin: "6px 2px 2px" }} />
              <SessionBreakdown state={state} resolved={resolved} />
              <Row icon="🛡️" label="Tendons & joints" value="Integrated" />
              {(() => {
                const total = totalSessions(resolved);
                const calendarDaysUsed = state.twoADay ? Math.ceil(total / 2) : total;
                if (state.days != null && state.days > calendarDaysUsed) {
                  const rest = state.days - calendarDaysUsed;
                  return (
                    <Row icon="🛌" label="Rest / flex" value={`${rest} day${rest === 1 ? "" : "s"}/wk`} />
                  );
                }
                return null;
              })()}
            </>
          )}

          {state.power && <Row icon="⚡" label="Power emphasis" value="On" />}
          {state.twoADay && <Row icon="🌗" label="Two-a-day" value="AM + PM split" />}
        </div>

        <WeekLadder resolved={resolved} />

        <p style={noteStyle}>
          The block-creation engine picks the actual movements from your training maxes and the
          tagged catalog — no two blocks are identical.
        </p>
      </div>
    </div>
  );
}

function Row({
  icon,
  label,
  value,
}: {
  icon: string;
  label: string;
  value: string | null;
}): ReactElement {
  const pending = value == null;
  return (
    <div style={rowStyle(pending)}>
      <span style={iconBoxStyle}>{icon}</span>
      <span style={{ color: "var(--cp-text-muted)" }}>{label}</span>
      <span style={{ color: "var(--cp-text)", fontWeight: 600, marginLeft: "auto" }}>
        {value ?? "—"}
      </span>
    </div>
  );
}

function SessionBreakdown({
  state,
  resolved,
}: {
  state: WizardState;
  resolved: ResolvedArchetype;
}): ReactElement {
  const sessions = buildWeekShape(resolved, { goal: state.goal, secondary: state.secondary });
  const total = sessions.length;
  const consolidated = consolidate(sessions);
  return (
    <>
      <div style={breakdownHeadingStyle}>
        Your week ({total} session{total === 1 ? "" : "s"})
      </div>
      {consolidated.map((s, i) => (
        <SessionRow key={i} session={s} count={s.count} />
      ))}
    </>
  );
}

function SessionRow({
  session,
  count,
}: {
  session: SessionShape;
  count: number;
}): ReactElement {
  const durationLabel = count > 1 ? `${count} × ${session.durationMin} min` : `${session.durationMin} min`;
  return (
    <div style={sessionRowStyle}>
      <span style={iconBoxStyle}>{session.icon}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={sessionTitleStyle}>
          {session.title}
          {count > 1 && <span style={sessionCountStyle}>× {count}</span>}
        </div>
        <div style={sessionMetaStyle}>{session.meta}</div>
      </div>
      <span style={sessionDurationStyle}>{durationLabel}</span>
    </div>
  );
}

type Consolidated = SessionShape & { count: number };
function consolidate(sessions: SessionShape[]): Consolidated[] {
  const out: Consolidated[] = [];
  for (const s of sessions) {
    const last = out[out.length - 1];
    if (last && last.title === s.title && last.meta === s.meta && last.durationMin === s.durationMin) {
      last.count++;
    } else {
      out.push({ ...s, count: 1 });
    }
  }
  return out;
}

function totalSessions(a: ResolvedArchetype): number {
  return a.sessions.strength + a.sessions.hypertrophy + a.sessions.cardio + a.sessions.tendon;
}

function summarySentence(state: WizardState, a: ResolvedArchetype | null): string {
  const dayLabel =
    state.days == null ? "? days/week" : `${state.days} day${state.days === 1 ? "" : "s"}/week`;
  if (state.secondary === "maintenance" && a) {
    return `Short maintenance block. ${formatSessions(a)} over ${dayLabel} — protects what you have without spending recovery on adaptation.`;
  }
  if (!state.goal || !a) return "The program shapes up as you choose.";
  if (state.goal === "resilience")
    return "Tendon-led return-to-load block. Top set capped at 80% TM; dedicated heavy slow resistance and isometric hold sessions across the week.";
  const primary = GOALS[state.goal].short;
  if (state.secondary && state.secondary !== "skip") {
    const sec = GOALS[state.secondary as Goal]?.short;
    return `Based on ${primary} + ${sec}, you'll do ${a.name}. ${formatSessions(a)} over ${dayLabel}, with a deload in week ${a.weeks}.`;
  }
  if (state.secondary === "skip") {
    return `Single-focus ${a.name}. ${formatSessions(a)} over ${dayLabel}.`;
  }
  return `Leading ${primary}. ${formatSessions(a)}.`;
}

function formatSessions(a: ResolvedArchetype): string {
  const parts: string[] = [];
  const { strength, hypertrophy, cardio, tendon } = a.sessions;
  if (strength > 0) parts.push(`${strength} strength`);
  if (hypertrophy > 0) parts.push(`${hypertrophy} hypertrophy`);
  if (cardio > 0) parts.push(`${cardio} cardio`);
  if (tendon > 0) parts.push(`${tendon} tendon`);
  return parts.join(" + ");
}

function WeekLadder({ resolved }: { resolved: ResolvedArchetype | null }): ReactElement {
  // Always render 4 cells; pending cells when unresolved.
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(4, 1fr)",
        gap: 4,
        marginTop: 10,
      }}
    >
      {Array.from({ length: 4 }, (_, i) => {
        const filled = !!resolved && i < resolved.weeks;
        const label = filled ? labelForWave(resolved!, i) : "—";
        const isDeload = filled && /recovery|deload/i.test(label);
        return (
          <div key={i} style={weekCellStyle(filled, isDeload)}>
            <div
              style={{
                fontSize: 9,
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                color: "var(--cp-text-muted)",
                fontWeight: 600,
              }}
            >
              {filled ? `Wk ${i + 1}` : "—"}
            </div>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--cp-text)", marginTop: 2 }}>
              {label}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function labelForWave(a: ResolvedArchetype, i: number): string {
  if (a.id === "strength_anchor") return ["Build", "Add weight", "Heavy week", "Recovery week"][i] ?? "—";
  if (a.id === "hypertrophy_anchor")
    return ["Volume base", "Add a set", "Volume peak", "Recovery week"][i] ?? "—";
  if (a.id === "endurance_anchor")
    return ["Build the base", "Add minutes", "Add the hard day", "Recovery week"][i] ?? "—";
  if (a.id === "concurrent_hybrid")
    return ["Build", "Add weight", "Add the hard day", "Recovery week"][i] ?? "—";
  if (a.id === "rebuild")
    return ["Ease in", "Step up", "Consolidate", "Recovery week"][i] ?? "—";
  if (a.id === "maintenance") return ["Steady week", "Steady week"][i] ?? "—";
  return "—";
}

// ── Styles ────────────────────────────────────────────────────────────────
const previewStyle: React.CSSProperties = {
  background: "var(--cp-surface)",
  border: "1.5px solid var(--cp-border)",
  borderRadius: 16,
  padding: 20,
  boxShadow: "0 4px 12px rgba(0,0,0,0.04)",
};
const summaryToggleStyle: React.CSSProperties = {
  width: "100%",
  background: "transparent",
  border: "none",
  padding: 0,
  margin: "0 0 12px",
  cursor: "pointer",
  fontFamily: "inherit",
  color: "inherit",
  textAlign: "left",
  alignItems: "center",
  justifyContent: "space-between",
  minHeight: 44,
  gap: 12,
  // `display: flex` is applied via the wiz-sidebar-summary class at ≤768 px.
};
const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  marginBottom: 14,
};
const kickerStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  fontWeight: 600,
};

function nameStyle(resolved: boolean): React.CSSProperties {
  return {
    fontSize: 22,
    fontWeight: resolved ? 700 : 600,
    margin: "0 0 4px",
    letterSpacing: "-0.01em",
    color: resolved ? "var(--cp-accent)" : "var(--cp-text-muted)",
  };
}

const summaryStyle: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cp-text-muted)",
  lineHeight: 1.5,
  margin: "0 0 14px",
  minHeight: 38,
};

function rowStyle(pending: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "8px 10px",
    borderRadius: 8,
    background: "var(--cp-surface-soft)",
    fontSize: 13,
    opacity: pending ? 0.4 : 1,
    fontStyle: pending ? "italic" : "normal",
  };
}

const iconBoxStyle: React.CSSProperties = {
  width: 22,
  height: 22,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  background: "var(--cp-bg-elevated)",
  borderRadius: 6,
  border: "1px solid var(--cp-border)",
  fontSize: 12,
  flexShrink: 0,
};

const sessionRowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  padding: "9px 10px",
  borderRadius: 8,
  background: "var(--cp-surface-soft)",
  fontSize: 13,
};

const sessionTitleStyle: React.CSSProperties = {
  fontSize: 13,
  fontWeight: 600,
  color: "var(--cp-text)",
  lineHeight: 1.2,
  display: "inline-flex",
  alignItems: "baseline",
  gap: 6,
};

const sessionCountStyle: React.CSSProperties = {
  fontFamily: "Consolas, monospace",
  fontSize: 11,
  color: "var(--cp-text-muted)",
  fontWeight: 600,
  background: "var(--cp-bg-elevated)",
  border: "1px solid var(--cp-border)",
  borderRadius: 999,
  padding: "1px 8px",
};

const sessionMetaStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  marginTop: 2,
  lineHeight: 1.4,
};

const sessionDurationStyle: React.CSSProperties = {
  fontFamily: "Consolas, monospace",
  fontSize: 11,
  color: "var(--cp-text-muted)",
  flexShrink: 0,
  marginTop: 1,
  textAlign: "right",
};

const breakdownHeadingStyle: React.CSSProperties = {
  fontSize: 10,
  color: "var(--cp-text-muted)",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  fontWeight: 600,
  padding: "4px 2px 2px",
};

const noteStyle: React.CSSProperties = {
  fontSize: 11,
  color: "var(--cp-text-muted)",
  lineHeight: 1.45,
  borderTop: "1px dashed var(--cp-border)",
  paddingTop: 12,
  marginTop: 12,
};

function weekCellStyle(filled: boolean, isDeload: boolean): React.CSSProperties {
  return {
    textAlign: "center",
    padding: "8px 4px",
    background: isDeload
      ? "color-mix(in oklab, var(--cp-warning, #d97706) 14%, var(--cp-surface-soft))"
      : "var(--cp-surface-soft)",
    borderRadius: 6,
    border: "1px solid var(--cp-border)",
    opacity: filled ? 1 : 0.35,
  };
}
