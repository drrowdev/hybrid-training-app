"use client";

/**
 * /app/plan redesign — single-screen overview with three jobs:
 *
 *  1. Quick read of the whole block (4-week × 7-day timeline grid).
 *  2. Where am I now (today row tinted with the lime accent + a
 *     "This week" rail on the right that lists Mon..Sun for the
 *     current week).
 *  3. Drill into any session via a right-side drawer.
 *
 * Replaces the old UpNextHero / view switcher / month calendar /
 * Block at a glance / UpNextRail / inline session list tower. The
 * Month view is kept as an alternate, less prominent rendering — the
 * Timeline is the default.
 *
 * Drag-and-drop on the timeline reorders sessions across days using
 * the same native HTML5 DnD pattern as the block-wizard step-5
 * schedule. Dropping out of the current block is a no-op.
 *
 * Design constraints honoured here:
 *   - Exactly one green on the page: today's row tint + the TODAY
 *     chip. Buttons, view toggle, filter, history link are all
 *     neutral / link colour.
 *   - Strength pills use --cp-strength + --cp-strength-soft, cardio
 *     uses --cp-cardio. No green except today.
 *   - 16px card radius, 8px button radius, 4px-based spacing.
 */

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent } from "react";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import {
  groupByMovementThenKind,
  type PlanSetRow,
  type MovementPrescriptionSection,
  type PrescriptionMovementRow,
} from "@/lib/plan/prescription-grouping";
import type { PrescriptionItem } from "@hta/db";

export type PlanFilter = "all" | "strength" | "cardio";
export type PlanViewMode = "timeline" | "month";

export type PlanSessionInput = {
  id: string;
  weekIndex: number;
  dayIndex: number;
  date: string; // YYYY-MM-DD
  title: string;
  isCardio: boolean;
  isStrength: boolean;
  done: boolean;
  skipped: boolean;
  slot: "single" | "am" | "pm";
  items: PrescriptionItem[];
  // Estimated duration (minutes) for the drawer meta line. Derived
  // upstream from prescription so the client doesn't have to redo it.
  estDurationMin: number | null;
};

export type PlanRedesignProps = {
  archetypeName: string;
  blockNumber: number; // 1-indexed
  blockTotal: number;
  startedOn: string; // YYYY-MM-DD
  endedOn: string; // YYYY-MM-DD (last calendar day in the block)
  weeks: number;
  today: string; // YYYY-MM-DD
  currentWeekIndex: number; // 0-indexed; -1 if today is outside the block
  sessions: PlanSessionInput[];
  view: PlanViewMode;
  filter: PlanFilter;
  /** When true, "Mark done" / "Start" link go to /app/sessions/start/<id>. */
  logHrefBase: string;
  // Form actions wired by the server page.
  moveAction: (formData: FormData) => Promise<void> | void;
  skipAction: (formData: FormData) => Promise<void> | void;
  unskipAction: (formData: FormData) => Promise<void> | void;
};

const DOW_FULL = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];
const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function shortDate(ymd: string): string {
  // YYYY-MM-DD → "MON 25". Anchored in UTC so the label can't drift
  // based on the viewer's clock.
  const d = new Date(`${ymd}T12:00:00Z`);
  const dow = ((d.getUTCDay() + 6) % 7) as 0 | 1 | 2 | 3 | 4 | 5 | 6;
  return `${DOW_FULL[dow]} ${d.getUTCDate()}`;
}

function longDate(ymd: string): string {
  const d = new Date(`${ymd}T12:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function pillTitle(s: PlanSessionInput): string {
  // The timeline pill is narrow — keep titles under ~14 chars.
  if (s.title.length <= 14) return s.title;
  return s.title.slice(0, 13) + "…";
}

function passesFilter(s: PlanSessionInput, f: PlanFilter): boolean {
  if (f === "all") return true;
  if (f === "strength") return s.isStrength;
  return s.isCardio;
}

export function PlanRedesign(props: PlanRedesignProps) {
  const {
    archetypeName,
    blockNumber,
    blockTotal,
    startedOn,
    endedOn,
    weeks,
    today,
    currentWeekIndex,
    sessions,
    view,
    filter,
    logHrefBase,
    moveAction,
    skipAction,
    unskipAction,
  } = props;

  // Drawer state — synced to the URL hash so back-button works.
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const sync = () => {
      const h = window.location.hash;
      if (h.startsWith("#session=")) setOpenId(h.slice("#session=".length));
      else setOpenId(null);
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, []);
  const openDrawer = useCallback((id: string) => {
    window.location.hash = `#session=${id}`;
  }, []);
  const closeDrawer = useCallback(() => {
    // Avoid leaving the hash dangling in the URL — replaceState is
    // less noisy in the history stack than setting it to "".
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setOpenId(null);
  }, []);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [openId, closeDrawer]);

  // Sessions grouped by (week, day) so the grid + rail can lookup by
  // cell key without rescanning.
  const byCell = useMemo(() => {
    const m = new Map<string, PlanSessionInput[]>();
    for (const s of sessions) {
      const key = `${s.weekIndex}-${s.dayIndex}`;
      const bucket = m.get(key) ?? [];
      bucket.push(s);
      m.set(key, bucket);
    }
    return m;
  }, [sessions]);

  // Filter is applied at render time so the per-week progress counters
  // always reflect the real block, not the filtered view.
  const visible = useCallback(
    (cell: PlanSessionInput[] | undefined): PlanSessionInput[] => {
      if (!cell) return [];
      return cell.filter((s) => passesFilter(s, filter));
    },
    [filter],
  );

  // Per-week progress: "done / total" using ALL sessions (filter
  // doesn't change reality).
  const weekProgress = useMemo(() => {
    const out: { done: number; total: number }[] = [];
    for (let w = 0; w < weeks; w++) {
      let done = 0;
      let total = 0;
      for (let d = 0; d < 7; d++) {
        const bucket = byCell.get(`${w}-${d}`) ?? [];
        for (const s of bucket) {
          total += 1;
          if (s.done) done += 1;
        }
      }
      out.push({ done, total });
    }
    return out;
  }, [byCell, weeks]);

  // DnD state — mirrors block-wizard Step5Schedule.
  const dragFromRef = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const handleDragStart = (sid: string) => (e: DragEvent<HTMLDivElement>) => {
    dragFromRef.current = sid;
    e.dataTransfer.effectAllowed = "move";
    // Some browsers require data on the transfer to allow a drop.
    e.dataTransfer.setData("text/plain", sid);
  };
  const handleDragOver =
    (cellKey: string) => (e: DragEvent<HTMLDivElement>) => {
      if (!dragFromRef.current) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      setDragOverKey(cellKey);
    };
  const handleDragLeave = () => setDragOverKey(null);
  const submitMove = useCallback(
    async (sessionId: string, weekIndex: number, dayIndex: number) => {
      const fd = new FormData();
      fd.set("id", sessionId);
      fd.set("weekIndex", String(weekIndex));
      fd.set("dayIndex", String(dayIndex));
      await moveAction(fd);
    },
    [moveAction],
  );
  const handleDrop =
    (targetWeek: number, targetDay: number) =>
    (e: DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      const sid = dragFromRef.current;
      dragFromRef.current = null;
      setDragOverKey(null);
      if (!sid) return;
      if (targetWeek < 0 || targetWeek >= weeks) return;
      void submitMove(sid, targetWeek, targetDay);
    };
  const handleDragEnd = () => {
    dragFromRef.current = null;
    setDragOverKey(null);
  };

  const openSession = openId ? sessions.find((s) => s.id === openId) ?? null : null;

  // Current-week rail (Mon..Sun for the current week). We synthesise
  // rest rows for days with no session so the rail always shows 7
  // entries — matches the mockup.
  const railWeek = Math.max(0, currentWeekIndex >= 0 ? currentWeekIndex : 0);
  const rail = useMemo(() => {
    const rows: {
      dayIndex: number;
      dow: string;
      session: PlanSessionInput | null;
    }[] = [];
    for (let d = 0; d < 7; d++) {
      const bucket = byCell.get(`${railWeek}-${d}`) ?? [];
      // Rail shows one row per day; if a 2-a-day we pick the first
      // for the rail (drawer-driven detail handles the rest).
      const s = bucket[0] ?? null;
      rows.push({ dayIndex: d, dow: DOW_FULL[d]!, session: s });
    }
    return rows;
  }, [byCell, railWeek]);

  const totalSessions = sessions.length;
  const totalDone = sessions.filter((s) => s.done).length;
  const totalSkipped = sessions.filter((s) => s.skipped).length;
  const progressPct =
    totalSessions === 0
      ? 0
      : Math.max(0, Math.min(100, Math.round((totalDone / totalSessions) * 100)));

  return (
    <div data-testid="plan-redesign" style={{ display: "grid", gap: 24 }}>
      <header className="plan-head">
        <div className="plan-eyebrow mono">
          {archetypeName} · Block {blockNumber} of {blockTotal}
        </div>
        <div className="plan-head-row">
          <h1 className="plan-h1">Plan</h1>
          <Link href="/app/plan/history" className="plan-history-link">
            View history →
          </Link>
        </div>
        <div
          className="plan-progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
          aria-label={`${totalDone} of ${totalSessions} sessions done`}
        >
          <span style={{ width: `${progressPct}%` }} />
        </div>
        <div className="plan-meta mono">
          <b>
            {longDate(startedOn)} – {longDate(endedOn)}
          </b>
          <span className="sep">·</span>
          <span>
            Week {Math.max(1, (currentWeekIndex >= 0 ? currentWeekIndex : 0) + 1)} of {weeks}
          </span>
          <span className="sep">·</span>
          <span>
            <b>{totalDone}</b> of {totalSessions} sessions
          </span>
          <span className="sep">·</span>
          <span>{totalSkipped} skipped</span>
        </div>
      </header>

      <div className="plan-controls">
        <div className="plan-view-toggle" role="tablist" aria-label="View mode">
          <Link
            href="/app/plan?view=timeline"
            className="plan-view-btn"
            role="tab"
            data-active={view === "timeline" ? "true" : "false"}
            data-testid="plan-view-tab-timeline"
            aria-selected={view === "timeline"}
          >
            Timeline
          </Link>
          <Link
            href="/app/plan?view=month"
            className="plan-view-btn"
            role="tab"
            data-active={view === "month" ? "true" : "false"}
            data-testid="plan-view-tab-month"
            aria-selected={view === "month"}
          >
            Month
          </Link>
        </div>
        <div className="plan-filter" aria-label="Filter by kind">
          <span className="plan-filter-label">Show:</span>
          {(["all", "strength", "cardio"] as PlanFilter[]).map((k) => (
            <Link
              key={k}
              href={`/app/plan?view=${view}${k === "all" ? "" : `&filter=${k}`}`}
              className="plan-filter-btn"
              data-active={filter === k ? "true" : "false"}
              data-testid={`plan-filter-${k}`}
            >
              {k === "all" ? "All" : k === "strength" ? "Strength" : "Cardio"}
            </Link>
          ))}
        </div>
      </div>

      <div className="plan-layout">
        <div className="plan-main">
          {view === "timeline" ? (
            <section
              className="plan-timeline"
              data-testid="plan-timeline"
              aria-label="Block timeline"
            >
              {Array.from({ length: weeks }, (_, w) => (
                <div
                  key={w}
                  className="plan-week-row"
                  data-testid={`plan-timeline-week-${w}`}
                  data-today-row={w === currentWeekIndex ? "true" : undefined}
                >
                  <div className="plan-week-label">
                    <span className="wk mono">Week {w + 1}</span>
                    <span className="wk-prog mono">
                      {weekProgress[w]!.done}/{weekProgress[w]!.total || "—"}
                    </span>
                  </div>
                  {Array.from({ length: 7 }, (_, d) => {
                    const cellKey = `${w}-${d}`;
                    const all = byCell.get(cellKey) ?? [];
                    const shown = visible(all);
                    const cellDate = all[0]?.date ?? null;
                    const isToday = cellDate === today;
                    const isPast = cellDate !== null && cellDate < today;
                    return (
                      <div
                        key={d}
                        className="plan-day-cell"
                        data-today={isToday ? "true" : undefined}
                        data-past={isPast ? "true" : undefined}
                        data-drag-over={dragOverKey === cellKey ? "true" : undefined}
                        data-testid={`plan-day-cell-${w}-${d}`}
                        onDragOver={handleDragOver(cellKey)}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop(w, d)}
                      >
                        <span className="day-num mono">
                          {cellDate ? shortDate(cellDate) : `${DOW_FULL[d]}`}
                          {isToday && <span className="today-chip mono">TODAY</span>}
                        </span>
                        {shown.length === 0 ? (
                          <span className="session-pill rest">Rest</span>
                        ) : (
                          shown.map((s) => {
                            const kind = s.isCardio ? "cardio" : "strength";
                            const muted = s.done || isPast;
                            return (
                              <div
                                key={s.id}
                                className={`session-pill ${kind}${muted ? " muted" : ""}`}
                                role="button"
                                tabIndex={0}
                                draggable={!s.done && !s.skipped}
                                data-testid={`plan-pill-${s.id}`}
                                onClick={() => openDrawer(s.id)}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter" || e.key === " ") {
                                    e.preventDefault();
                                    openDrawer(s.id);
                                  }
                                }}
                                onDragStart={handleDragStart(s.id)}
                                onDragEnd={handleDragEnd}
                                title={s.title}
                              >
                                {pillTitle(s)}
                              </div>
                            );
                          })
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </section>
          ) : (
            <MonthAlternate
              sessions={sessions.filter((s) => passesFilter(s, filter))}
              today={today}
              onOpen={openDrawer}
            />
          )}

          <div className="plan-legend" data-testid="plan-legend">
            <div className="item">
              <span className="swatch strength" /> Strength
            </div>
            <div className="item">
              <span className="swatch cardio" /> Cardio
            </div>
            <div className="item">
              <span className="swatch today-sw" /> Today
            </div>
            <div className="item">
              <span className="swatch rest-sw" /> Rest
            </div>
          </div>
        </div>

        <aside className="plan-rail" aria-label="This week" data-testid="plan-this-week">
          <h3>This week</h3>
          <div className="rail-list">
            {rail.map((row) => {
              const s = row.session;
              const dayDate = s?.date ?? null;
              const isToday = dayDate === today;
              const isPast = dayDate !== null && dayDate < today;
              if (!s) {
                return (
                  <div
                    key={row.dayIndex}
                    className="rail-item rest-item"
                    data-testid={`plan-rail-${row.dayIndex}`}
                  >
                    <span className="rail-day mono">{row.dow}</span>
                    <span className="rail-name">Rest</span>
                    <span className="rail-kind mono">—</span>
                  </div>
                );
              }
              const tag = s.done ? "Done" : s.skipped ? "Skipped" : null;
              return (
                <button
                  type="button"
                  key={row.dayIndex}
                  className={`rail-item ${isPast && !isToday ? "past" : ""} ${
                    isToday ? "today-item" : ""
                  }`}
                  data-testid={`plan-rail-${row.dayIndex}`}
                  onClick={() => openDrawer(s.id)}
                >
                  <span className="rail-day mono">{row.dow}</span>
                  <span className="rail-name">
                    {s.title}
                    {isToday && <span className="today-chip mono">TODAY</span>}
                  </span>
                  <span className="rail-kind mono">
                    {tag ?? (s.isCardio ? "Cardio" : "Strength")}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>
      </div>

      {openSession && (
        <SessionDrawer
          session={openSession}
          today={today}
          weeks={weeks}
          logHrefBase={logHrefBase}
          onClose={closeDrawer}
          moveAction={moveAction}
          skipAction={skipAction}
          unskipAction={unskipAction}
        />
      )}

      <style>{`
        .plan-head { display: grid; gap: 6px; }
        .plan-eyebrow {
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--cp-text-muted);
        }
        .plan-head-row {
          display: flex;
          justify-content: space-between;
          align-items: baseline;
          gap: 16px;
          flex-wrap: wrap;
        }
        .plan-h1 {
          margin: 0;
          font-size: 30px;
          font-weight: 700;
          letter-spacing: -0.02em;
        }
        .plan-history-link {
          color: var(--cp-link);
          text-decoration: none;
          font-size: 13px;
        }
        .plan-history-link:hover { text-decoration: underline; }
        .plan-progress {
          height: 4px;
          background: var(--cp-border);
          border-radius: 2px;
          overflow: hidden;
          margin-top: 10px;
        }
        .plan-progress > span {
          display: block;
          height: 100%;
          background: var(--cp-accent);
          border-radius: 2px;
        }
        .plan-meta {
          display: flex;
          gap: 12px;
          align-items: center;
          flex-wrap: wrap;
          font-size: 13px;
          color: var(--cp-text-muted);
          margin-top: 8px;
        }
        .plan-meta b { color: var(--cp-text); font-weight: 600; }
        .plan-meta .sep { color: var(--cp-text-soft); }

        .plan-controls {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          flex-wrap: wrap;
        }
        .plan-view-toggle {
          display: inline-flex;
          background: var(--cp-surface);
          border: 1px solid var(--cp-border);
          border-radius: 8px;
          padding: 2px;
        }
        .plan-view-btn {
          font-size: 13px;
          padding: 6px 12px;
          border-radius: 6px;
          color: var(--cp-text-muted);
          text-decoration: none;
        }
        .plan-view-btn[data-active="true"] {
          background: var(--cp-surface-soft);
          color: var(--cp-text);
          font-weight: 600;
        }
        .plan-filter { font-size: 13px; color: var(--cp-text-muted); display: inline-flex; gap: 4px; align-items: center; }
        .plan-filter-label { margin-right: 4px; }
        .plan-filter-btn {
          font-size: 13px;
          padding: 4px 8px;
          border-radius: 4px;
          color: var(--cp-text-muted);
          text-decoration: none;
        }
        .plan-filter-btn[data-active="true"] { color: var(--cp-text); font-weight: 600; }
        .plan-filter-btn:hover { color: var(--cp-text); }

        .plan-layout {
          display: grid;
          gap: 24px;
          grid-template-columns: minmax(0, 1fr);
        }
        @media (min-width: 1024px) {
          .plan-layout {
            grid-template-columns: minmax(0, 1fr) 320px;
          }
        }
        .plan-main { display: grid; gap: 12px; min-width: 0; }

        .plan-timeline {
          background: var(--cp-surface);
          border: 1px solid var(--cp-border);
          border-radius: 16px;
          overflow: hidden;
        }
        .plan-week-row {
          display: grid;
          grid-template-columns: 80px repeat(7, minmax(0, 1fr));
          border-bottom: 1px solid var(--cp-border);
          min-height: 64px;
        }
        .plan-week-row:last-child { border-bottom: 0; }
        .plan-week-label {
          padding: 12px 14px;
          border-right: 1px solid var(--cp-border);
          background: var(--cp-bg-elevated);
          display: flex;
          flex-direction: column;
          justify-content: center;
          gap: 2px;
        }
        .plan-week-label .wk {
          font-size: 11px;
          color: var(--cp-text-muted);
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .plan-week-label .wk-prog {
          font-size: 12px;
          color: var(--cp-text);
          font-weight: 600;
        }

        .plan-day-cell {
          border-right: 1px solid var(--cp-border);
          padding: 6px 8px;
          display: flex;
          flex-direction: column;
          gap: 4px;
          transition: background 0.12s;
          min-width: 0;
        }
        .plan-day-cell:last-child { border-right: 0; }
        .plan-day-cell[data-today="true"] { background: var(--cp-accent-soft); }
        .plan-day-cell[data-drag-over="true"] {
          background: var(--cp-surface-soft);
          outline: 2px dashed var(--cp-border-strong);
          outline-offset: -2px;
        }
        .plan-day-cell .day-num {
          font-size: 10px;
          color: var(--cp-text-muted);
          letter-spacing: 0.05em;
          display: inline-flex;
          align-items: center;
          gap: 4px;
        }
        .plan-day-cell[data-today="true"] .day-num { color: var(--cp-accent); font-weight: 700; }
        .plan-day-cell[data-past="true"] .day-num { opacity: 0.5; }

        .today-chip {
          background: var(--cp-accent);
          color: var(--cp-accent-fg);
          font-size: 9px;
          letter-spacing: 0.06em;
          padding: 2px 5px;
          border-radius: 4px;
          font-weight: 700;
        }

        .session-pill {
          font-size: 11px;
          line-height: 1.25;
          padding: 4px 6px;
          border-radius: 4px;
          font-weight: 500;
          border-left: 2px solid transparent;
          cursor: pointer;
          background: transparent;
          color: var(--cp-text);
          text-align: left;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .session-pill.strength {
          background: var(--cp-strength-soft);
          border-left-color: var(--cp-strength);
        }
        .session-pill.cardio {
          background: var(--cp-cardio-soft);
          border-left-color: var(--cp-cardio);
        }
        .session-pill.muted { opacity: 0.5; text-decoration: line-through; }
        .session-pill.rest {
          color: var(--cp-text-soft);
          border-left-color: var(--cp-border-strong);
          font-style: italic;
          opacity: 0.7;
          cursor: default;
        }

        .plan-legend {
          display: flex;
          gap: 14px;
          flex-wrap: wrap;
          font-size: 12px;
          color: var(--cp-text-muted);
          padding: 6px 2px;
        }
        .plan-legend .item { display: flex; align-items: center; gap: 6px; }
        .plan-legend .swatch {
          width: 14px;
          height: 14px;
          border-radius: 3px;
          border-left: 2px solid var(--cp-border-strong);
        }
        .plan-legend .swatch.strength { background: var(--cp-strength-soft); border-left-color: var(--cp-strength); }
        .plan-legend .swatch.cardio { background: var(--cp-cardio-soft); border-left-color: var(--cp-cardio); }
        .plan-legend .swatch.today-sw { background: var(--cp-accent-soft); border-left-color: var(--cp-accent); }
        .plan-legend .swatch.rest-sw { background: transparent; }

        .plan-rail {
          background: var(--cp-surface);
          border: 1px solid var(--cp-border);
          border-radius: 16px;
          padding: 20px;
          align-self: start;
        }
        .plan-rail h3 {
          margin: 0 0 12px;
          font-size: 11px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--cp-text-muted);
          font-weight: 600;
          font-family: var(--cp-font-mono);
        }
        .rail-list { display: flex; flex-direction: column; }
        .rail-item {
          display: grid;
          grid-template-columns: 40px 1fr auto;
          gap: 12px;
          align-items: center;
          padding: 10px 0;
          border: 0;
          border-bottom: 1px solid var(--cp-border);
          background: transparent;
          text-align: left;
          color: var(--cp-text);
          cursor: pointer;
          font: inherit;
        }
        .rail-item:last-child { border-bottom: 0; }
        .rail-item:hover .rail-name { color: var(--cp-accent); }
        .rail-day { font-size: 11px; color: var(--cp-text-muted); }
        .rail-name { font-size: 14px; font-weight: 500; }
        .rail-name .today-chip { margin-left: 6px; }
        .rail-kind { font-size: 10px; color: var(--cp-text-muted); letter-spacing: 0.05em; text-transform: uppercase; }
        .rail-item.past { opacity: 0.55; }
        .rail-item.past .rail-name { text-decoration: line-through; }
        .rail-item.today-item {
          background: var(--cp-accent-soft);
          margin: 0 -20px;
          padding-left: 20px;
          padding-right: 20px;
          border-bottom-color: transparent;
        }
        .rail-item.today-item + .rail-item { border-top: 1px solid var(--cp-border); }
        .rail-item.rest-item {
          color: var(--cp-text-soft);
          font-style: italic;
          cursor: default;
        }
        .rail-item.rest-item:hover .rail-name { color: var(--cp-text-soft); }
      `}</style>
    </div>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Month alternate — a stripped-down calendar showing the SAME pill
   vocabulary as the timeline, so the "exactly one green" rule holds.
   Past sessions are muted; today is the only highlight.
   ──────────────────────────────────────────────────────────────── */

function MonthAlternate({
  sessions,
  today,
  onOpen,
}: {
  sessions: PlanSessionInput[];
  today: string;
  onOpen: (id: string) => void;
}) {
  // Build 6-week Monday-first grid anchored on the month containing today.
  const anchor = new Date(`${today}T12:00:00Z`);
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = (first.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - firstDow);
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const ymd = d.toISOString().slice(0, 10);
    cells.push({ date: ymd, inMonth: d.getUTCMonth() === month });
  }

  const byDate = new Map<string, PlanSessionInput[]>();
  for (const s of sessions) {
    const bucket = byDate.get(s.date) ?? [];
    bucket.push(s);
    byDate.set(s.date, bucket);
  }

  return (
    <section
      className="plan-month-grid"
      data-testid="plan-month-grid"
      aria-label="Month view"
      style={{
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        borderRadius: 16,
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, 1fr)",
          borderBottom: "1px solid var(--cp-border)",
          fontFamily: "var(--cp-font-mono)",
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {DOW_FULL.map((d) => (
          <div key={d} style={{ padding: "10px 12px" }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)" }}>
        {cells.map((c, i) => {
          const items = byDate.get(c.date) ?? [];
          const isToday = c.date === today;
          const isPast = c.date < today;
          return (
            <div
              key={i}
              data-testid={`plan-month-cell-${i}`}
              data-today={isToday ? "true" : undefined}
              style={{
                minHeight: 80,
                padding: 6,
                borderRight: (i + 1) % 7 === 0 ? "0" : "1px solid var(--cp-border)",
                borderBottom: i >= 35 ? "0" : "1px solid var(--cp-border)",
                opacity: c.inMonth ? 1 : 0.35,
                background: isToday ? "var(--cp-accent-soft)" : undefined,
                display: "flex",
                flexDirection: "column",
                gap: 4,
              }}
            >
              <span
                className="mono"
                style={{
                  fontSize: 10,
                  color: isToday ? "var(--cp-accent)" : "var(--cp-text-muted)",
                  fontWeight: isToday ? 700 : 500,
                }}
              >
                {Number(c.date.slice(8, 10))}
                {isToday && <span className="today-chip mono" style={{ marginLeft: 4 }}>TODAY</span>}
              </span>
              {items.map((s) => {
                const kind = s.isCardio ? "cardio" : "strength";
                const muted = s.done || isPast;
                return (
                  <div
                    key={s.id}
                    className={`session-pill ${kind}${muted ? " muted" : ""}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => onOpen(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onOpen(s.id);
                      }
                    }}
                  >
                    {pillTitle(s)}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Session drawer — slides in from the right, ESC / backdrop / close
   button all dismiss. URL hash drives open state so back-button works.
   ──────────────────────────────────────────────────────────────── */

function SessionDrawer({
  session,
  today,
  weeks,
  logHrefBase,
  onClose,
  moveAction,
  skipAction,
  unskipAction,
}: {
  session: PlanSessionInput;
  today: string;
  weeks: number;
  logHrefBase: string;
  onClose: () => void;
  moveAction: (formData: FormData) => Promise<void> | void;
  skipAction: (formData: FormData) => Promise<void> | void;
  unskipAction: (formData: FormData) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const isToday = session.date === today;

  const sections = useMemo(() => groupByMovementThenKind(session.items), [session.items]);
  const movementCount = sections.movements.length;
  const dur = session.estDurationMin;

  const handleSwap = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const date = (form.elements.namedItem("date") as HTMLInputElement).value;
    if (!date) return;
    // Compute target weekIndex/dayIndex relative to session's date.
    const t = new Date(`${date}T12:00:00Z`);
    const s = new Date(`${session.date}T12:00:00Z`);
    const diffDays = Math.round((t.getTime() - s.getTime()) / 86_400_000);
    const newDayIndex = session.dayIndex + diffDays;
    const newWeek = session.weekIndex + Math.floor(newDayIndex / 7);
    const newDay = ((newDayIndex % 7) + 7) % 7;
    if (newWeek < 0 || newWeek >= weeks) return;
    const fd = new FormData();
    fd.set("id", session.id);
    fd.set("weekIndex", String(newWeek));
    fd.set("dayIndex", String(newDay));
    await moveAction(fd);
    onClose();
  };

  return (
    <>
      <div
        className="drawer-backdrop"
        onClick={onClose}
        data-testid="plan-drawer-backdrop"
        aria-hidden="true"
      />
      <aside
        className="plan-drawer"
        role="dialog"
        aria-labelledby="plan-drawer-title"
        aria-modal="true"
        data-testid="plan-drawer"
      >
        <header className="drawer-head">
          <div>
            <h2 id="plan-drawer-title">{session.title}</h2>
            <div className="meta mono">
              {shortDate(session.date)}
              {isToday && " · Today"}
              {movementCount > 0 && ` · ${movementCount} movement${movementCount === 1 ? "" : "s"}`}
              {dur != null && ` · ~${dur} min`}
            </div>
          </div>
          <button
            type="button"
            className="close"
            onClick={onClose}
            aria-label="Close drawer"
            data-testid="plan-drawer-close"
          >
            ×
          </button>
        </header>
        <div className="drawer-body">
          <div className="drawer-actions">
            <button
              type="button"
              className="cp-btn"
              onClick={() => setShowSwap((v) => !v)}
              data-testid="plan-drawer-swap"
            >
              ⇄ Swap day
            </button>
            <button
              type="button"
              className="cp-btn"
              onClick={() => setEditing((v) => !v)}
              data-testid="plan-drawer-edit"
              aria-pressed={editing}
            >
              ✎ {editing ? "Done editing" : "Edit"}
            </button>
            <Link
              href={`${logHrefBase}/${session.id}`}
              className="cp-btn"
              data-testid="plan-drawer-mark-done"
            >
              ✓ Mark done
            </Link>
            {session.skipped ? (
              <form action={unskipAction}>
                <input type="hidden" name="id" value={session.id} />
                <button
                  type="submit"
                  className="cp-btn ghost"
                  data-testid="plan-drawer-unskip"
                  style={{ width: "100%" }}
                >
                  Un-skip
                </button>
              </form>
            ) : (
              <form action={skipAction}>
                <input type="hidden" name="id" value={session.id} />
                <button
                  type="submit"
                  className="cp-btn ghost"
                  data-testid="plan-drawer-skip"
                  style={{ width: "100%" }}
                >
                  Skip
                </button>
              </form>
            )}
          </div>

          {showSwap && (
            <form
              onSubmit={handleSwap}
              className="swap-form"
              data-testid="plan-drawer-swap-form"
            >
              <label htmlFor="plan-drawer-swap-date" className="mono">
                Move to:
              </label>
              <input
                id="plan-drawer-swap-date"
                type="date"
                name="date"
                defaultValue={session.date}
                data-testid="plan-drawer-swap-date"
              />
              <button
                type="submit"
                className="cp-btn primary"
                data-testid="plan-drawer-swap-submit"
              >
                Move
              </button>
            </form>
          )}

          {sections.movements.map((sec) => (
            <DrawerMovement key={sec.rowKey} section={sec} editing={editing} />
          ))}

          {sections.accessories.length > 0 && (
            <DrawerRowSection
              testId="plan-drawer-section-accessories"
              label="Accessories"
              prefix="A"
              rows={sections.accessories}
            />
          )}
          {sections.tendon.length > 0 && (
            <DrawerRowSection
              testId="plan-drawer-section-tendon"
              label="Tendon work"
              prefix="T"
              rows={sections.tendon}
            />
          )}
          {sections.hingeCompensations.length > 0 && (
            <DrawerRowSection
              testId="plan-drawer-section-hinge"
              label="Posterior chain"
              prefix="H"
              rows={sections.hingeCompensations}
            />
          )}
          {sections.cardio.length > 0 && (
            <DrawerCardio items={sections.cardio} />
          )}

          <div className="section">Notes</div>
          <textarea
            className="notes"
            placeholder="Anything to remember about this session (local to this device)…"
            data-testid="plan-drawer-notes"
            defaultValue={typeof window !== "undefined" ? localStorage.getItem(`plan-notes:${session.id}`) ?? "" : ""}
            onChange={(e) => {
              try {
                localStorage.setItem(`plan-notes:${session.id}`, e.target.value);
              } catch {
                /* storage full / disabled — ignore, the field still works in-memory */
              }
            }}
          />
        </div>

        <style>{`
          .drawer-backdrop {
            position: fixed;
            inset: 0;
            background: rgba(0,0,0,0.4);
            z-index: 50;
          }
          .plan-drawer {
            position: fixed;
            top: 0;
            right: 0;
            bottom: 0;
            width: min(520px, 92vw);
            background: var(--cp-bg-elevated);
            border-left: 1px solid var(--cp-border);
            z-index: 60;
            overflow-y: auto;
            box-shadow: var(--cp-shadow);
            display: flex;
            flex-direction: column;
          }
          .plan-drawer .drawer-head {
            position: sticky;
            top: 0;
            background: var(--cp-bg-elevated);
            border-bottom: 1px solid var(--cp-border);
            padding: 18px 20px;
            display: flex;
            justify-content: space-between;
            align-items: flex-start;
            gap: 12px;
          }
          .plan-drawer h2 {
            margin: 0 0 4px;
            font-size: 22px;
            letter-spacing: -0.01em;
          }
          .plan-drawer .meta {
            font-size: 12px;
            color: var(--cp-text-muted);
          }
          .plan-drawer .close {
            border: 0;
            background: transparent;
            color: var(--cp-text-muted);
            font-size: 24px;
            cursor: pointer;
            line-height: 1;
            padding: 0 4px;
          }
          .plan-drawer .drawer-body { padding: 18px 20px 32px; flex: 1; }
          .plan-drawer .drawer-actions {
            display: grid;
            grid-template-columns: repeat(4, 1fr);
            gap: 6px;
            margin-bottom: 12px;
          }
          .plan-drawer .drawer-actions > .cp-btn,
          .plan-drawer .drawer-actions > a.cp-btn,
          .plan-drawer .drawer-actions > form > .cp-btn {
            padding: 8px 6px;
            font-size: 12px;
            font-weight: 500;
            width: 100%;
            text-align: center;
            justify-content: center;
          }
          .plan-drawer .section {
            margin: 20px 0 8px;
            font-family: var(--cp-font-mono);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.08em;
            color: var(--cp-text-muted);
            font-weight: 600;
          }
          .plan-drawer .swap-form {
            display: flex;
            gap: 8px;
            align-items: center;
            margin: 8px 0 16px;
            padding: 12px;
            background: var(--cp-surface);
            border: 1px solid var(--cp-border);
            border-radius: 8px;
          }
          .plan-drawer .swap-form input[type="date"] {
            padding: 6px 8px;
            border: 1px solid var(--cp-border);
            border-radius: 6px;
            background: var(--cp-surface);
            color: var(--cp-text);
            font: inherit;
            font-size: 13px;
          }
          .plan-drawer .set-row {
            display: grid;
            grid-template-columns: 36px 1fr auto;
            gap: 8px;
            padding: 8px 0;
            border-bottom: 1px solid var(--cp-border);
            font-size: 14px;
            align-items: center;
          }
          .plan-drawer .set-row .n { color: var(--cp-text-muted); font-family: var(--cp-font-mono); font-size: 12px; }
          .plan-drawer .set-row .v { font-family: var(--cp-font-mono); color: var(--cp-text); font-weight: 600; }
          .plan-drawer .set-row input {
            font: inherit;
            font-family: var(--cp-font-mono);
            font-size: 13px;
            padding: 4px 6px;
            border: 1px solid var(--cp-border);
            border-radius: 4px;
            background: var(--cp-surface);
            color: var(--cp-text);
            width: 70px;
            text-align: right;
          }
          .plan-drawer .range-pill {
            display: inline-block;
            margin-left: 8px;
            padding: 2px 6px;
            font-size: 10px;
            font-family: var(--cp-font-mono);
            border: 1px solid var(--cp-border);
            border-radius: 999px;
            color: var(--cp-text-muted);
          }
          .plan-drawer .movement-head {
            display: flex;
            align-items: baseline;
            justify-content: space-between;
            gap: 8px;
            margin: 12px 0 4px;
            font-size: 14px;
            font-weight: 700;
          }
          .plan-drawer .notes {
            width: 100%;
            min-height: 80px;
            background: var(--cp-surface);
            border: 1px solid var(--cp-border);
            border-radius: 8px;
            padding: 10px 12px;
            font: inherit;
            color: var(--cp-text);
            resize: vertical;
          }
          .plan-drawer .notes:focus { outline: 2px solid var(--cp-accent-soft); border-color: var(--cp-accent); }
        `}</style>
      </aside>
    </>
  );
}

function rangeHint(item: PrescriptionItem): string | null {
  // UI-only hint label. The engine knows the canonical set × rep
  // range; we just surface it so the user can see roughly what's
  // expected when they edit a row. Nothing is validated.
  const sets = item.sets ?? null;
  const reps = item.reps ?? null;
  if (sets == null && reps == null) return null;
  if (sets != null && reps != null) {
    return `Engine: ${sets} × ${reps}`;
  }
  if (reps != null) return `Engine: × ${reps}`;
  return `Engine: ${sets} sets`;
}

function DrawerMovement({
  section,
  editing,
}: {
  section: MovementPrescriptionSection;
  editing: boolean;
}) {
  if (section.sets.length === 0 && section.warmups.length === 0) return null;
  return (
    <div data-testid={`plan-drawer-movement-${section.rowKey}`}>
      <div className="movement-head">
        <span>{section.movementName}</span>
        {section.sets[0] && rangeHint(section.sets[0].item) && (
          <span className="range-pill" data-testid="plan-drawer-range-pill">
            {rangeHint(section.sets[0].item)}
          </span>
        )}
      </div>
      {section.warmups.length > 0 && (
        <>
          <div className="section">Warm-up</div>
          {section.warmups.map((it, i) => (
            <SetRow key={`w-${i}`} label={`W${i + 1}`} item={it} editing={editing} />
          ))}
        </>
      )}
      {section.sets.length > 0 && (
        <>
          <div className="section">{section.sets.length > 1 ? "Main lift" : "Main"}</div>
          {section.sets.map((row, i) => (
            <SetRow
              key={`m-${i}`}
              label={String(row.setNumber)}
              item={row.item}
              editing={editing}
              row={row}
            />
          ))}
        </>
      )}
    </div>
  );
}

function SetRow({
  label,
  item,
  editing,
  row,
}: {
  label: string;
  item: PrescriptionItem;
  editing: boolean;
  row?: PlanSetRow;
}) {
  if (editing) {
    return (
      <div className="set-row">
        <span className="n">{label}</span>
        <span>{item.movementName ?? row?.item.movementName ?? "Movement"}</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <input
            type="text"
            defaultValue={item.reps != null ? String(item.reps) : ""}
            aria-label={`Set ${label} reps`}
            placeholder="reps"
          />
        </span>
      </div>
    );
  }
  return (
    <div className="set-row">
      <span className="n">{label}</span>
      <span>{item.movementName ?? "Movement"}</span>
      <span className="v">{formatPrescriptionItem(item)}</span>
    </div>
  );
}

function DrawerRowSection({
  label,
  prefix,
  rows,
  testId,
}: {
  label: string;
  prefix: string;
  rows: PrescriptionMovementRow[];
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <div className="section">{label}</div>
      {rows.map((r, i) => (
        <div key={r.rowKey} className="set-row">
          <span className="n">
            {prefix}
            {i + 1}
          </span>
          <span>{r.movementName}</span>
          <span className="v">
            {r.items.map((it, j) => (
              <span key={j}>
                {j > 0 ? " · " : ""}
                {formatPrescriptionItem(it)}
              </span>
            ))}
          </span>
        </div>
      ))}
    </div>
  );
}

function DrawerCardio({ items }: { items: PrescriptionItem[] }) {
  return (
    <div data-testid="plan-drawer-section-cardio">
      <div className="section">Cardio</div>
      {items.map((it, i) => (
        <div key={i} className="set-row">
          <span className="n">C{i + 1}</span>
          <span>{it.movementName ?? "Cardio"}</span>
          <span className="v">{formatPrescriptionItem(it)}</span>
        </div>
      ))}
    </div>
  );
}
