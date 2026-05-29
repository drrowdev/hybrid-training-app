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
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import type { DragEvent } from "react";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import { isOverdue, overdueDays } from "@/lib/planner/overdue";
import { LogNowDateForm } from "@/components/plan/LogNowDateForm";
import { addDaysToYmd } from "@/lib/dates";
import {
  getAdaptationGuidanceForArchetype,
  type AdaptationGuidance,
} from "@/lib/planner/adaptation-guidance";
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
  /** Drawer notes loaded from `planned_sessions.notes` (PR Z1). */
  notes: string | null;
};

export type PlanRedesignProps = {
  archetypeName: string;
  /** Wizard archetype id; used to derive adaptation-horizon guidance. */
  archetypeId?: string;
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
  /**
   * Persist drawer notes to `planned_sessions.notes`. Wired by the
   * server page to `updatePlannedSessionNotes`. The drawer mirrors to
   * localStorage as a fast-paint fallback (PR Z1).
   */
  updateNotesAction: (
    id: string,
    notes: string,
  ) => Promise<{ ok?: true; error?: string }>;
  /**
   * Server action that starts a session from a planned id, optionally
   * with a retroactive `performedAt` (YYYY-MM-DD) form field. Wired by
   * the server page to `startSessionFromPlan`. Used by the overdue
   * "Log now" date picker.
   */
  startSessionAction: (formData: FormData) => Promise<void> | void;
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

/**
 * Render `Block N of M` with a tooltip surfacing the research-backed
 * adaptation horizon for the active archetype, when we can derive one.
 *
 * Falls back to plain text when the archetype doesn't map to a single
 * guidance row (e.g. `maintenance`, `custom`) — no empty tooltip.
 */
function renderBlockOfTotal(
  archetypeId: string | undefined,
  blockNumber: number,
  blockTotal: number,
): React.ReactNode {
  const guidance = archetypeId ? getAdaptationGuidanceForArchetype(archetypeId) : null;
  const label = `Block ${blockNumber} of ${blockTotal}`;
  if (!guidance) return label;
  const recommended = formatGuidanceForTooltip(guidance);
  const title = `${recommended}\n\n${guidance.summary}\n${guidance.citation}`;
  return (
    <span
      className="plan-eyebrow-blocks"
      title={title}
      aria-label={`${label}. ${recommended}. ${guidance.summary}`}
      data-testid="plan-eyebrow-blocks"
    >
      {label}
      <span aria-hidden="true" className="plan-eyebrow-info">ⓘ</span>
    </span>
  );
}

function formatGuidanceForTooltip(g: AdaptationGuidance): string {
  if (g.rotates) {
    if (Number.isFinite(g.blocks.min) && !Number.isFinite(g.blocks.max)) {
      return `Recommended: ${g.blocks.min}+ blocks (${g.weeks.min}+ weeks)`;
    }
    return "Recommended: rotate emphasis every 4–6 weeks";
  }
  const blocks =
    g.blocks.min === g.blocks.max
      ? `${g.blocks.min} block${g.blocks.min === 1 ? "" : "s"}`
      : `${g.blocks.min}–${g.blocks.max} blocks`;
  const weeks =
    g.weeks.min === g.weeks.max
      ? `${g.weeks.min} weeks`
      : `${g.weeks.min}–${g.weeks.max} weeks`;
  return `Recommended: ${blocks} (~${weeks})`;
}

function pillTitle(s: PlanSessionInput): string {
  // The timeline pill is narrow — keep titles under ~14 chars.
  if (s.title.length <= 14) return s.title;
  return s.title.slice(0, 13) + "…";
}

/**
 * Adapt the client-side `PlanSessionInput` (which uses `done`/`skipped`
 * booleans) to the pure-helper shape so we can share the overdue rule
 * with the server-side `PlannedDay` callers. `done` mirrors
 * `completed_session_id IS NOT NULL`; `skipped` mirrors `skipped_at IS
 * NOT NULL` — see `planner/queries.ts` and the plan page mapping.
 */
function sessionToOverdueCandidate(s: PlanSessionInput) {
  return {
    date: s.date,
    completedSessionId: s.done ? "linked" : null,
    skippedAt: s.skipped ? "skipped" : null,
  };
}

function passesFilter(s: PlanSessionInput, f: PlanFilter): boolean {
  if (f === "all") return true;
  if (f === "strength") return s.isStrength;
  return s.isCardio;
}

export function PlanRedesign(props: PlanRedesignProps) {
  const {
    archetypeName,
    archetypeId,
    blockNumber,
    blockTotal,
    startedOn,
    endedOn,
    weeks,
    today,
    currentWeekIndex,
    sessions,
    view: initialView,
    filter: initialFilter,
    logHrefBase,
    moveAction,
    skipAction,
    unskipAction,
    updateNotesAction,
    startSessionAction,
  } = props;

  // View + filter are pure client-side transforms over the same
  // session set. Server navigation here is wasteful — it refetches the
  // whole block from the DB just to flip a CSS class. Keep them as
  // local state and sync to the URL with history.replaceState so deep
  // links + reloads still land on the right tab.
  const [view, setView] = useState<PlanViewMode>(initialView);
  const [filter, setFilter] = useState<PlanFilter>(initialFilter);
  const syncUrl = useCallback((nextView: PlanViewMode, nextFilter: PlanFilter) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (nextView !== "timeline") params.set("view", nextView);
    if (nextFilter !== "all") params.set("filter", nextFilter);
    const q = params.toString();
    const url = q ? `${window.location.pathname}?${q}` : window.location.pathname;
    window.history.replaceState(null, "", url + window.location.hash);
  }, []);
  const onViewChange = useCallback(
    (v: PlanViewMode) => {
      setView(v);
      syncUrl(v, filter);
    },
    [filter, syncUrl],
  );
  const onFilterChange = useCallback(
    (f: PlanFilter) => {
      setFilter(f);
      syncUrl(view, f);
    },
    [view, syncUrl],
  );

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
    // Body scroll lock while the drawer is open — full-screen mobile
    // overlay must not let the page underneath scroll. Restore the
    // user's original overflow value on close so we don't fight any
    // other consumer that may have set it.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
    // popstate listener removed (review-202 #5): we open the drawer via
    // `window.location.hash =` which fires hashchange, not popstate.
    // The hashchange listener at the top of this effect's parent already
    // closes the drawer on browser back. The popstate listener would
    // never fire for hash-only navigation.
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
          {archetypeName} · {renderBlockOfTotal(archetypeId, blockNumber, blockTotal)}
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
          <button
            type="button"
            className="plan-view-btn"
            role="tab"
            data-active={view === "timeline" ? "true" : "false"}
            data-testid="plan-view-tab-timeline"
            aria-selected={view === "timeline"}
            onClick={() => onViewChange("timeline")}
          >
            Timeline
          </button>
          <button
            type="button"
            className="plan-view-btn"
            role="tab"
            data-active={view === "month" ? "true" : "false"}
            data-testid="plan-view-tab-month"
            aria-selected={view === "month"}
            onClick={() => onViewChange("month")}
          >
            Month
          </button>
        </div>
        <div className="plan-filter" aria-label="Filter by kind">
          <span className="plan-filter-label">Show:</span>
          {(["all", "strength", "cardio"] as PlanFilter[]).map((k) => (
            <button
              key={k}
              type="button"
              className="plan-filter-btn"
              data-active={filter === k ? "true" : "false"}
              data-testid={`plan-filter-${k}`}
              onClick={() => onFilterChange(k)}
            >
              {k === "all" ? "All" : k === "strength" ? "Strength" : "Cardio"}
            </button>
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
                            const overdue = isOverdue(
                              sessionToOverdueCandidate(s),
                              today,
                            );
                            return (
                              <div
                                key={s.id}
                                className={`session-pill ${kind}${muted ? " muted" : ""}${overdue ? " overdue" : ""}`}
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
                                {overdue && (
                                  <span
                                    className="overdue-pill mono"
                                    data-testid={`overdue-pill-${s.id}`}
                                    title={`Overdue by ${overdueDays(sessionToOverdueCandidate(s), today)} day(s)`}
                                  >
                                    Overdue · {overdueDays(sessionToOverdueCandidate(s), today)}d
                                  </span>
                                )}
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
              const overdue = isOverdue(sessionToOverdueCandidate(s), today);
              const tag = s.done ? "Done" : s.skipped ? "Skipped" : null;
              return (
                <button
                  type="button"
                  key={row.dayIndex}
                  className={`rail-item ${isPast && !isToday ? "past" : ""} ${
                    isToday ? "today-item" : ""
                  }${overdue ? " overdue" : ""}`}
                  data-testid={`plan-rail-${row.dayIndex}`}
                  onClick={() => openDrawer(s.id)}
                >
                  <span className="rail-day mono">{row.dow}</span>
                  <span className="rail-name">
                    {s.title}
                    {isToday && <span className="today-chip mono">TODAY</span>}
                    {overdue && (
                      <span
                        className="overdue-pill mono"
                        data-testid={`overdue-pill-${s.id}`}
                      >
                        Overdue · {overdueDays(sessionToOverdueCandidate(s), today)}d
                      </span>
                    )}
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
          updateNotesAction={updateNotesAction}
          startSessionAction={startSessionAction}
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
        .plan-eyebrow-blocks {
          cursor: help;
          border-bottom: 1px dotted var(--cp-border);
        }
        .plan-eyebrow-info {
          margin-left: 4px;
          color: var(--cp-text-soft);
          font-size: 11px;
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
          background: transparent;
          border: 0;
          font: inherit;
          cursor: pointer;
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
          background: transparent;
          border: 0;
          font: inherit;
          cursor: pointer;
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
            align-items: stretch;
          }
        }
        /* Mobile (<768px): collapse the dense Timeline + Month surfaces
           and show ONLY the "This week" rail card, full-width. The
           Timeline/Month view toggle disappears too — mobile users get
           the current week, full stop. Desktop layout is untouched. */
        @media (max-width: 768px) {
          .plan-view-toggle { display: none; }
          .plan-main { display: none; }
          .plan-rail {
            padding: 16px;
          }
          .plan-rail h3 {
            font-size: 12px;
          }
        }
        .plan-main {
          display: flex;
          flex-direction: column;
          gap: 12px;
          min-width: 0;
        }

        .plan-timeline {
          position: relative;
          background: var(--cp-surface);
          border: 1px solid var(--cp-border);
          border-radius: 16px;
          overflow-y: auto;
          max-height: calc(100vh - 280px);
          flex: 1;
          display: flex;
          flex-direction: column;
          /* Scroll-shadow: gradients are fixed to the scroll viewport via
             background-attachment: local. Top/bottom solid fills mask the
             shadow when the user is at the edge; the cover gradient
             reveals it when scrolled into the middle. */
          background:
            linear-gradient(var(--cp-surface) 30%, rgba(0, 0, 0, 0)),
            linear-gradient(rgba(0, 0, 0, 0), var(--cp-surface) 70%) 0 100%,
            radial-gradient(farthest-side at 50% 0, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0)),
            radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0)) 0 100%,
            var(--cp-surface);
          background-repeat: no-repeat;
          background-size: 100% 28px, 100% 28px, 100% 10px, 100% 10px;
          background-attachment: local, local, scroll, scroll;
        }
        @media (max-width: 768px) {
          .plan-timeline {
            max-height: calc(100vh - 220px);
          }
        }
        .plan-month-grid {
          position: relative;
          background: var(--cp-surface);
          border: 1px solid var(--cp-border);
          border-radius: 16px;
          overflow-y: auto;
          overflow-x: hidden;
          max-height: calc(100vh - 280px);
          background:
            linear-gradient(var(--cp-surface) 30%, rgba(0, 0, 0, 0)),
            linear-gradient(rgba(0, 0, 0, 0), var(--cp-surface) 70%) 0 100%,
            radial-gradient(farthest-side at 50% 0, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0)),
            radial-gradient(farthest-side at 50% 100%, rgba(0, 0, 0, 0.18), rgba(0, 0, 0, 0)) 0 100%,
            var(--cp-surface);
          background-repeat: no-repeat;
          background-size: 100% 28px, 100% 28px, 100% 10px, 100% 10px;
          background-attachment: local, local, scroll, scroll;
        }
        @media (max-width: 768px) {
          .plan-month-grid {
            max-height: calc(100vh - 220px);
          }
        }
        .plan-week-row {
          display: grid;
          grid-template-columns: 80px repeat(7, minmax(0, 1fr));
          border-bottom: 1px solid var(--cp-border);
          flex: 1;
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
        .session-pill.overdue {
          border-left-color: var(--cp-warning);
          background: color-mix(in srgb, var(--cp-warning) 12%, transparent);
          opacity: 1;
          text-decoration: none;
        }
        .session-pill.overdue.muted {
          opacity: 0.5;
        }
        .overdue-pill {
          display: inline-block;
          margin-left: 6px;
          padding: 1px 5px;
          font-size: 9px;
          line-height: 1.2;
          letter-spacing: 0.04em;
          font-weight: 700;
          color: var(--cp-warning);
          border: 1px solid var(--cp-warning);
          background: color-mix(in srgb, var(--cp-warning) 12%, transparent);
          border-radius: 4px;
          text-transform: uppercase;
          vertical-align: middle;
          white-space: nowrap;
        }
        .rail-item.overdue {
          border-left: 2px solid var(--cp-warning);
          background: color-mix(in srgb, var(--cp-warning) 6%, transparent);
        }

        .plan-legend {
          margin-top: 16px;
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

/**
 * Add `delta` months to a UTC date, preserving day-of-month when
 * possible (clamps to last day if the target month is shorter, e.g.
 * Jan 31 + 1 → Feb 28/29). Exported for unit tests.
 */
export function addMonthsUtc(d: Date, delta: number): Date {
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  // First-of-target-month then clamp day to its length.
  const target = new Date(Date.UTC(year, month + delta, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target;
}

/**
 * Build the 6-week × 7-day Monday-first cell grid (42 cells) anchored
 * on the month containing `viewingMonth`. Exported for unit tests.
 */
export function buildMonthGridCells(
  viewingMonth: Date,
): { date: string; inMonth: boolean }[] {
  const year = viewingMonth.getUTCFullYear();
  const month = viewingMonth.getUTCMonth();
  const first = new Date(Date.UTC(year, month, 1));
  const firstDow = (first.getUTCDay() + 6) % 7; // Mon=0..Sun=6
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - firstDow);
  const cells: { date: string; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    cells.push({
      date: d.toISOString().slice(0, 10),
      inMonth: d.getUTCMonth() === month,
    });
  }
  return cells;
}

/**
 * Locale-aware "May 2026" label for the month header. Exported for
 * unit tests; defaults to the user's runtime locale.
 */
export function formatMonthLabel(viewingMonth: Date, locale?: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(viewingMonth);
}

function MonthAlternate({
  sessions,
  today,
  onOpen,
}: {
  sessions: PlanSessionInput[];
  today: string;
  onOpen: (id: string) => void;
}) {
  // First-of-current-month as the initial viewing window.
  const [viewingMonth, setViewingMonth] = useState<Date>(() => {
    const anchor = new Date(`${today}T12:00:00Z`);
    return new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), 1));
  });

  const cells = useMemo(() => buildMonthGridCells(viewingMonth), [viewingMonth]);
  const monthLabel = useMemo(() => formatMonthLabel(viewingMonth), [viewingMonth]);

  // Bounds — disable arrows once the user paged past every session.
  const { minMonthKey, maxMonthKey } = useMemo(() => {
    if (sessions.length === 0) return { minMonthKey: null, maxMonthKey: null };
    let min = sessions[0]!.date;
    let max = sessions[0]!.date;
    for (const s of sessions) {
      if (s.date < min) min = s.date;
      if (s.date > max) max = s.date;
    }
    return { minMonthKey: min.slice(0, 7), maxMonthKey: max.slice(0, 7) };
  }, [sessions]);

  const viewingKey = `${viewingMonth.getUTCFullYear()}-${String(
    viewingMonth.getUTCMonth() + 1,
  ).padStart(2, "0")}`;
  const canGoPrev = minMonthKey === null ? true : viewingKey > minMonthKey;
  const canGoNext = maxMonthKey === null ? true : viewingKey < maxMonthKey;

  const todayMonthKey = today.slice(0, 7);
  const showTodayHighlight = viewingKey === todayMonthKey;

  const byDate = new Map<string, PlanSessionInput[]>();
  for (const s of sessions) {
    const bucket = byDate.get(s.date) ?? [];
    bucket.push(s);
    byDate.set(s.date, bucket);
  }

  const hasAnyInView = cells.some((c) => c.inMonth && byDate.has(c.date));

  return (
    <section
      className="plan-month-grid"
      data-testid="plan-month-grid"
      aria-label="Month view"
    >
      <div
        className="plan-month-header"
        data-testid="plan-month-header"
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          padding: "8px 12px",
          borderBottom: "1px solid var(--cp-border)",
        }}
      >
        <button
          type="button"
          data-testid="plan-month-prev"
          aria-label="Previous month"
          disabled={!canGoPrev}
          onClick={() => setViewingMonth((d) => addMonthsUtc(d, -1))}
          style={{
            minWidth: 44,
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: 0,
            color: "var(--cp-accent)",
            fontSize: 22,
            lineHeight: 1,
            cursor: canGoPrev ? "pointer" : "not-allowed",
            opacity: canGoPrev ? 1 : 0.5,
            borderRadius: 8,
          }}
        >
          <span aria-hidden>‹</span>
        </button>
        <div
          data-testid="plan-month-label"
          aria-live="polite"
          style={{
            minWidth: 160,
            textAlign: "center",
            color: "var(--cp-text)",
            fontWeight: 600,
            fontSize: 15,
          }}
        >
          {monthLabel}
        </div>
        <button
          type="button"
          data-testid="plan-month-next"
          aria-label="Next month"
          disabled={!canGoNext}
          onClick={() => setViewingMonth((d) => addMonthsUtc(d, 1))}
          style={{
            minWidth: 44,
            minHeight: 44,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "transparent",
            border: 0,
            color: "var(--cp-accent)",
            fontSize: 22,
            lineHeight: 1,
            cursor: canGoNext ? "pointer" : "not-allowed",
            opacity: canGoNext ? 1 : 0.5,
            borderRadius: 8,
          }}
        >
          <span aria-hidden>›</span>
        </button>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
          borderBottom: "1px solid var(--cp-border)",
          fontFamily: "var(--cp-font-mono)",
          fontSize: 11,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
        }}
      >
        {DOW_FULL.map((d) => (
          <div key={d} style={{ padding: "10px 12px", minWidth: 0 }}>
            {d}
          </div>
        ))}
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {cells.map((c, i) => {
          const items = byDate.get(c.date) ?? [];
          const isToday = showTodayHighlight && c.date === today;
          const isPast = c.date < today;
          return (
            <div
              key={i}
              data-testid={`plan-month-cell-${i}`}
              data-today={isToday ? "true" : undefined}
              style={{
                minHeight: 80,
                minWidth: 0,
                overflow: "hidden",
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
                const overdue = isOverdue(sessionToOverdueCandidate(s), today);
                return (
                  <div
                    key={s.id}
                    className={`session-pill ${kind}${muted ? " muted" : ""}${overdue ? " overdue" : ""}`}
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
                    {overdue && (
                      <span
                        className="overdue-pill mono"
                        data-testid={`overdue-pill-${s.id}`}
                      >
                        Overdue · {overdueDays(sessionToOverdueCandidate(s), today)}d
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
      {!hasAnyInView && (
        <div
          data-testid="plan-month-empty"
          style={{
            padding: "16px 20px",
            textAlign: "center",
            color: "var(--cp-text-muted)",
            fontSize: 13,
          }}
        >
          No sessions planned for this month
        </div>
      )}
    </section>
  );
}

/* ──────────────────────────────────────────────────────────────────
   Session drawer — slides in from the right, ESC / backdrop / close
   button all dismiss. URL hash drives open state so back-button works.
   ──────────────────────────────────────────────────────────────── */

/**
 * Wraps a `moveAction` server-action call so the drawer can keep itself
 * open on failure instead of swallowing the error. Exported for unit
 * tests — the drawer is rendered via a server-only `renderToStaticMarkup`
 * in PlanRedesign.test.tsx so we can't drive the form submit there.
 */
export async function runSwapMove(
  moveAction: (formData: FormData) => Promise<void> | void,
  formData: FormData,
): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    await moveAction(formData);
    return { ok: true };
  } catch (err) {
    // eslint-disable-next-line no-console -- diagnostics for the user
    console.error("[plan] swap-day move failed", err);
    const message =
      err instanceof Error && err.message
        ? err.message
        : "Couldn't move that session. Please try again.";
    return { ok: false, error: message };
  }
}

/**
 * Pure helper: should a swipe-down release dismiss the drawer?
 *
 * Dismiss when EITHER the finger travelled strictly more than 100 px
 * downward OR the fling velocity in the last 100 ms of movement is
 * strictly greater than 0.5 px/ms. Exactly-100 / exactly-0.5 snap back
 * — the threshold is exclusive so the rule reads cleanly as
 * "needs to clearly exceed the line, not just touch it."
 * Exported so the threshold can be unit-tested without a real DOM.
 */
export function shouldDismissSwipe(input: {
  finalDy: number;
  velocity: number;
}): boolean {
  return input.finalDy > 100 || input.velocity > 0.5;
}

export function SessionDrawer({
  session,
  today,
  weeks,
  logHrefBase,
  onClose,
  moveAction,
  skipAction,
  unskipAction,
  updateNotesAction,
  startSessionAction,
}: {
  session: PlanSessionInput;
  today: string;
  weeks: number;
  logHrefBase: string;
  onClose: () => void;
  moveAction: (formData: FormData) => Promise<void> | void;
  skipAction: (formData: FormData) => Promise<void> | void;
  unskipAction: (formData: FormData) => Promise<void> | void;
  updateNotesAction: (
    id: string,
    notes: string,
  ) => Promise<{ ok?: true; error?: string }>;
  startSessionAction: (formData: FormData) => Promise<void> | void;
}) {
  const [editing, setEditing] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  // Inline error surfaced from a failed swap-day submit. The project
  // has no toast helper today (no `useToast`, no `toast(` callsites),
  // so we render the message inside the drawer and keep the drawer
  // open so the user can retry without losing context.
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapPending, setSwapPending] = useState(false);
  const isToday = session.date === today;
  const overdue = isOverdue(sessionToOverdueCandidate(session), today);
  const overdueDayCount = overdue
    ? overdueDays(sessionToOverdueCandidate(session), today)
    : 0;
  // Idempotency-friendly: once a one-tap action has been fired, disable
  // both CTAs locally so a fast double-tap can't post twice while the
  // server action is still in flight. The server actions are also safe
  // to call repeatedly (skip is upsert-like; start is idempotent on
  // completed_session_id), but the client lock keeps the UX honest.
  const [oneTapFired, setOneTapFired] = useState(false);

  // ── Mobile swipe-down-to-dismiss ─────────────────────────────────
  // On phones the drawer is a full-screen bottom sheet (see CSS below).
  // We track a vertical drag on the header region only so the body's
  // scroll isn't hijacked. Closing fires on either a >100px pull OR a
  // fling >0.5 px/ms downward over the last 100ms of movement.
  const [dragY, setDragY] = useState(0);
  const [dragging, setDragging] = useState(false);
  const dragStateRef = useRef<{
    startY: number;
    pointerId: number;
    // Last 10 samples of (t, y) for fling-velocity estimation.
    samples: Array<{ t: number; y: number }>;
  } | null>(null);
  const onDragPointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    // Only react to primary (touch / left mouse / pen) inputs.
    if (e.button !== 0 && e.pointerType === "mouse") return;
    dragStateRef.current = {
      startY: e.clientY,
      pointerId: e.pointerId,
      samples: [{ t: performance.now(), y: e.clientY }],
    };
    setDragging(true);
    setDragY(0);
    e.currentTarget.setPointerCapture(e.pointerId);
  }, []);
  const onDragPointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    const s = dragStateRef.current;
    if (!s || s.pointerId !== e.pointerId) return;
    const dy = Math.max(0, e.clientY - s.startY);
    setDragY(dy);
    s.samples.push({ t: performance.now(), y: e.clientY });
    if (s.samples.length > 10) s.samples.shift();
  }, []);
  const finishDrag = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const s = dragStateRef.current;
      if (!s || s.pointerId !== e.pointerId) return;
      const finalDy = Math.max(0, e.clientY - s.startY);
      // Fling velocity from last 100ms of samples (px/ms, positive = down).
      const now = performance.now();
      const recent = s.samples.filter((p) => now - p.t <= 100);
      let velocity = 0;
      if (recent.length >= 2) {
        const first = recent[0]!;
        const last = recent[recent.length - 1]!;
        const dt = last.t - first.t;
        if (dt > 0) velocity = (last.y - first.y) / dt;
      }
      dragStateRef.current = null;
      setDragging(false);
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may already be released */
      }
      if (shouldDismissSwipe({ finalDy, velocity })) {
        // Animate out: jump to the bottom then close on next tick so the
        // CSS transition can render before the drawer unmounts.
        setDragY(window.innerHeight);
        setTimeout(() => {
          setDragY(0);
          onClose();
        }, 180);
        return;
      }
      // Snap back.
      setDragY(0);
    },
    [onClose],
  );
  // Safety: reset drag state on unmount (StrictMode-friendly).
  useEffect(() => {
    return () => {
      dragStateRef.current = null;
    };
  }, []);


  // ── Drawer notes (PR Z1) ─────────────────────────────────────────
  // Source of truth: `planned_sessions.notes` (DB). localStorage is a
  // fast-paint fallback so cold devices don't render an empty field
  // for the ~150ms the page takes to hydrate. On every keystroke we
  // mirror to localStorage immediately + debounce 500 ms before
  // calling the server action. `notesStatus` drives the autosave
  // indicator.
  const notesStorageKey = `plan-notes:${session.id}`;
  const initialNotes =
    session.notes ??
    (typeof window !== "undefined"
      ? window.localStorage.getItem(notesStorageKey) ?? ""
      : "");
  const [notesValue, setNotesValue] = useState(initialNotes);
  const [notesStatus, setNotesStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [, startNotesTransition] = useTransition();
  const notesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedNotesRef = useRef(initialNotes);

  // Clear the debounce timer on unmount so a closing drawer doesn't
  // fire a stale save against an unmounted component.
  useEffect(() => {
    return () => {
      if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    };
  }, []);

  const flushNotes = useCallback(
    (value: string) => {
      if (value === lastSavedNotesRef.current) {
        setNotesStatus("idle");
        return;
      }
      setNotesStatus("saving");
      startNotesTransition(async () => {
        const result = await updateNotesAction(session.id, value);
        if (result?.error) {
          setNotesStatus("error");
          return;
        }
        lastSavedNotesRef.current = value;
        setNotesStatus("saved");
      });
    },
    [session.id, updateNotesAction],
  );

  const onNotesChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value;
    setNotesValue(value);
    // Fast-paint mirror — fire-and-forget; localStorage may be blocked
    // (private mode / quota) and that must not interfere with the
    // server save.
    try {
      window.localStorage.setItem(notesStorageKey, value);
    } catch {
      /* ignore */
    }
    if (notesTimerRef.current) clearTimeout(notesTimerRef.current);
    notesTimerRef.current = setTimeout(() => flushNotes(value), 500);
  };

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
    if (newWeek < 0 || newWeek >= weeks) {
      setSwapError("That date is outside the current block.");
      return;
    }
    const fd = new FormData();
    fd.set("id", session.id);
    fd.set("weekIndex", String(newWeek));
    fd.set("dayIndex", String(newDay));
    setSwapPending(true);
    setSwapError(null);
    const result = await runSwapMove(moveAction, fd);
    setSwapPending(false);
    if (result.ok) {
      onClose();
      return;
    }
    // Keep the drawer open so the user can retry. Surface the message
    // inline next to the submit button.
    setSwapError(result.error);
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
        className={`plan-drawer${dragging ? " dragging" : ""}`}
        role="dialog"
        aria-labelledby="plan-drawer-title"
        aria-modal="true"
        data-testid="plan-drawer"
        style={dragY > 0 ? { transform: `translateY(${dragY}px)` } : undefined}
      >
        {/* Mobile drag handle — also serves as the swipe-down dismiss
            grip. Hidden on desktop via CSS. Pointer handlers cover the
            handle + header region so users can still scroll the body. */}
        {/* Drag handle is a touch-only affordance. Keyboard users
            close the drawer via Escape or the X button, so the handle
            is hidden from assistive tech (aria-hidden) and removed
            from the tab order rather than presented as a fake button. */}
        <div
          className="drawer-drag-handle"
          data-testid="plan-drawer-drag-handle"
          aria-hidden="true"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <span className="grip" />
        </div>
        <header
          className="drawer-head"
          onPointerDown={onDragPointerDown}
          onPointerMove={onDragPointerMove}
          onPointerUp={finishDrag}
          onPointerCancel={finishDrag}
        >
          <div>
            <h2 id="plan-drawer-title">{session.title}</h2>
            <div className="meta mono">
              {shortDate(session.date)}
              {isToday && " · Today"}
              {overdue && (
                <span
                  className="overdue-pill mono"
                  data-testid={`overdue-pill-${session.id}`}
                  style={{ marginLeft: 6 }}
                >
                  Overdue · {overdueDayCount}d
                </span>
              )}
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
            {overdue && !session.skipped && !session.done && (
              <>
                <form
                  action={skipAction}
                  onSubmit={() => setOneTapFired(true)}
                  style={{ display: "contents" }}
                >
                  <input type="hidden" name="id" value={session.id} />
                  <button
                    type="submit"
                    className="cp-btn"
                    data-testid={`overdue-skip-${session.id}`}
                    disabled={oneTapFired}
                    aria-busy={oneTapFired}
                    title="Mark this overdue session as skipped"
                  >
                    Mark skipped
                  </button>
                </form>
                <LogNowDateForm
                  plannedId={session.id}
                  title={session.title}
                  defaultDateYmd={session.date <= today ? session.date : today}
                  maxDateYmd={today}
                  minDateYmd={addDaysToYmd(today, -14)}
                  action={startSessionAction}
                  onOpenChange={(o) => {
                    if (o) setOneTapFired(true);
                  }}
                />
              </>
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
                disabled={swapPending}
                aria-busy={swapPending}
              >
                {swapPending ? "Moving…" : "Move"}
              </button>
              {swapError && (
                <p
                  className="swap-form-error"
                  role="alert"
                  data-testid="plan-drawer-swap-error"
                >
                  {swapError}
                </p>
              )}
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

          <div
            className="section"
            style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}
          >
            <span>Notes</span>
            <span
              data-testid="plan-drawer-notes-status"
              style={{
                fontSize: 11,
                color:
                  notesStatus === "error"
                    ? "var(--cp-danger)"
                    : "var(--cp-text-muted)",
                fontWeight: 500,
              }}
              aria-live="polite"
            >
              {notesStatus === "saving"
                ? "Saving…"
                : notesStatus === "saved"
                  ? "Saved"
                  : notesStatus === "error"
                    ? "Save failed — retry"
                    : ""}
            </span>
          </div>
          <textarea
            className="notes"
            placeholder="Anything to remember about this session…"
            data-testid="plan-drawer-notes"
            value={notesValue}
            onChange={onNotesChange}
            onBlur={() => {
              // Force-flush on blur so we don't lose a pending edit if
              // the drawer closes inside the 500ms debounce window.
              if (notesTimerRef.current) {
                clearTimeout(notesTimerRef.current);
                notesTimerRef.current = null;
              }
              flushNotes(notesValue);
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
            transition: transform 220ms ease-out;
          }
          .plan-drawer.dragging {
            /* Follow the finger 1:1 during a swipe; snap-back transition
               re-engages on pointerup when we clear the inline style. */
            transition: none;
          }
          .drawer-drag-handle {
            display: none;
          }
          /* Mobile (<=768px): full-screen bottom sheet with slide-up
             entrance, visible grab handle, and pointer-driven swipe-
             down dismiss. Desktop stays as the right-side panel. */
          @media (max-width: 768px) {
            .plan-drawer {
              top: 0;
              right: 0;
              left: 0;
              bottom: 0;
              inset: 0;
              width: 100%;
              border-left: 0;
              animation: plan-drawer-slide-up 240ms ease-out;
            }
            .drawer-drag-handle {
              display: flex;
              justify-content: center;
              align-items: center;
              margin: 12px 0 8px;
              touch-action: none;
              cursor: grab;
              user-select: none;
            }
            .drawer-drag-handle .grip {
              display: block;
              width: 36px;
              height: 4px;
              border-radius: 2px;
              background: var(--cp-border-strong, var(--cp-border));
            }
            .plan-drawer .drawer-head {
              touch-action: none;
            }
          }
          @keyframes plan-drawer-slide-up {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
          @media (prefers-reduced-motion: reduce) {
            .plan-drawer { animation: none; }
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
