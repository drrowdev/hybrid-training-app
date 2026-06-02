"use client";

/**
 * Shared "This week" rail card — the single source of truth for the
 * Mon..Sun current-week list that opens the session drawer. Used by:
 *
 *   - /app/plan  → `PlanRedesign` renders `<RailList>` for its right
 *     column (the drawer is owned by PlanRedesign so the timeline /
 *     month pills share one instance).
 *   - /app (Today) → `<ThisWeekRail>` renders the same `<RailList>` +
 *     its own `SessionDrawer`, so the Today right-rail card looks and
 *     behaves identically to the /plan one.
 *
 * The rail markup + CSS live here so the two pages can never drift.
 * `SessionDrawer` is imported from PlanRedesign (already self-contained
 * with its own global <style> block).
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { isOverdue, overdueDays } from "@/lib/planner/overdue";
import {
  SessionDrawer,
  sessionToOverdueCandidate,
  type PlanSessionInput,
} from "@/components/plan/PlanRedesign";

const DOW_FULL = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"];

export type RailRow = {
  dayIndex: number;
  dow: string;
  session: PlanSessionInput | null;
};

/**
 * Presentational rail list. Pure render: the caller supplies the seven
 * rows (already resolved to the current week), `today`, and the open
 * callback. Carries the rail CSS so it styles itself anywhere it is
 * mounted (the /plan page also injects identical rules from
 * PlanRedesign's global stylesheet — duplicate global rules are inert).
 */
export function RailList({
  rail,
  today,
  onOpen,
  heading = "This week",
}: {
  rail: RailRow[];
  today: string;
  onOpen: (id: string) => void;
  heading?: string;
}) {
  return (
    <aside className="plan-rail" aria-label={heading} data-testid="plan-this-week">
      <h3>{heading}</h3>
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
              onClick={() => onOpen(s.id)}
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
      <style>{`
        .plan-rail {
          --rail-pad: 20px;
          background: var(--cp-surface);
          border: 1px solid var(--cp-border);
          border-radius: 16px;
          padding: var(--rail-pad);
          align-self: start;
          overflow: hidden;
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
        /* Today + overdue highlights bleed to the card's inner edges. The
           inline margin is pulled back by exactly the rail padding (the
           --rail-pad var, overridden in the mobile media query) so the band
           can never overrun the card on any viewport; .plan-rail's
           overflow:hidden also clips it to the rounded corners as a guard.
           Both highlights share this geometry so neither looks "cut short". */
        .rail-item.today-item,
        .rail-item.overdue {
          margin-inline: calc(-1 * var(--rail-pad));
          padding-inline: var(--rail-pad);
        }
        .rail-item.today-item {
          background: var(--cp-accent-soft);
          border-bottom-color: transparent;
        }
        .rail-item.today-item + .rail-item { border-top: 1px solid var(--cp-border); }
        .rail-item.rest-item {
          color: var(--cp-text-soft);
          font-style: italic;
          cursor: default;
        }
        .rail-item.rest-item:hover .rail-name { color: var(--cp-text-soft); }
        .rail-item.overdue {
          border-left: 2px solid var(--cp-warning);
          background: color-mix(in srgb, var(--cp-warning) 6%, transparent);
        }
        .today-chip {
          background: var(--cp-accent);
          color: var(--cp-accent-fg);
          font-size: 9px;
          letter-spacing: 0.06em;
          padding: 2px 5px;
          border-radius: 4px;
          font-weight: 700;
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
        @media (max-width: 768px) {
          .plan-rail { --rail-pad: 16px; }
          .plan-rail h3 { font-size: 12px; }
        }
      `}</style>
    </aside>
  );
}

export type ThisWeekRailProps = {
  sessions: PlanSessionInput[];
  today: string; // YYYY-MM-DD
  currentWeekIndex: number; // 0-indexed; -1 if today is outside the block
  weeks: number;
  logHrefBase: string;
  heading?: string;
  moveAction: (formData: FormData) => Promise<void> | void;
  skipAction: (formData: FormData) => Promise<void> | void;
  unskipAction: (formData: FormData) => Promise<void> | void;
  updateNotesAction: (
    id: string,
    notes: string,
  ) => Promise<{ ok?: true; error?: string }>;
  startSessionAction: (formData: FormData) => Promise<void> | void;
};

/**
 * Standalone "This week" card for the Today page. Computes the current
 * week's rail from the block's sessions and owns the drawer (hash-driven,
 * identical to /plan so deep-linking and browser-back behave the same).
 */
export function ThisWeekRail({
  sessions,
  today,
  currentWeekIndex,
  weeks,
  logHrefBase,
  heading,
  moveAction,
  skipAction,
  unskipAction,
  updateNotesAction,
  startSessionAction,
}: ThisWeekRailProps) {
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
    history.replaceState(null, "", window.location.pathname + window.location.search);
    setOpenId(null);
  }, []);
  useEffect(() => {
    if (!openId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeDrawer();
    };
    window.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [openId, closeDrawer]);

  const railWeek = Math.max(0, currentWeekIndex >= 0 ? currentWeekIndex : 0);
  const rail = useMemo<RailRow[]>(() => {
    const byCell = new Map<string, PlanSessionInput[]>();
    for (const s of sessions) {
      const key = `${s.weekIndex}-${s.dayIndex}`;
      const bucket = byCell.get(key) ?? [];
      bucket.push(s);
      byCell.set(key, bucket);
    }
    const rows: RailRow[] = [];
    for (let d = 0; d < 7; d++) {
      const bucket = byCell.get(`${railWeek}-${d}`) ?? [];
      rows.push({ dayIndex: d, dow: DOW_FULL[d]!, session: bucket[0] ?? null });
    }
    return rows;
  }, [sessions, railWeek]);

  const openSession = openId
    ? sessions.find((s) => s.id === openId) ?? null
    : null;

  return (
    <>
      <RailList rail={rail} today={today} onOpen={openDrawer} heading={heading} />
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
    </>
  );
}
