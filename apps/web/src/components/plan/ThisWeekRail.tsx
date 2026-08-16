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
import { useRouter } from "next/navigation";
import { isOverdue, overdueDays } from "@/lib/planner/overdue";
import { addDaysToYmd } from "@/lib/dates";
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

const SLOT_ORDER: Record<string, number> = {
  am: 0,
  single: 1,
  pm: 2,
};

export function buildWeekRailRows(
  sessions: PlanSessionInput[],
  weekIndex: number,
): RailRow[] {
  const byCell = new Map<string, PlanSessionInput[]>();
  for (const session of sessions) {
    const key = `${session.weekIndex}-${session.dayIndex}`;
    const bucket = byCell.get(key) ?? [];
    bucket.push(session);
    byCell.set(key, bucket);
  }

  const rows: RailRow[] = [];
  for (let dayIndex = 0; dayIndex < 7; dayIndex++) {
    const bucket = [...(byCell.get(`${weekIndex}-${dayIndex}`) ?? [])].sort(
      (a, b) =>
        (SLOT_ORDER[a.slot] ?? 3) - (SLOT_ORDER[b.slot] ?? 3) ||
        a.title.localeCompare(b.title),
    );
    if (bucket.length === 0) {
      rows.push({
        dayIndex,
        dow: DOW_FULL[dayIndex]!,
        session: null,
      });
      continue;
    }
    for (const session of bucket) {
      rows.push({
        dayIndex,
        dow: DOW_FULL[dayIndex]!,
        session,
      });
    }
  }
  return rows;
}

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
  const sessions = rail
    .map((r) => r.session)
    .filter((s): s is NonNullable<typeof s> => s != null);
  const total = sessions.length;
  const doneCount = sessions.filter((s) => s.done).length;
  const pct = total > 0 ? Math.round((doneCount / total) * 100) : 0;

  // Start date (dayIndex 0) of the displayed week, derived from any
  // dated session: its date minus its dayIndex. Lets rest rows — which
  // carry no session date — still resolve their calendar date, so
  // "today" highlights even when today is a rest day (mirrors the
  // timeline + month views). Null only when the week has no dated
  // sessions at all.
  const weekStart = useMemo(() => {
    const anchor = rail.find((r) => r.session?.date);
    if (!anchor || !anchor.session?.date) return null;
    return addDaysToYmd(anchor.session.date, -anchor.dayIndex);
  }, [rail]);

  return (
    <aside className="plan-rail" aria-label={heading} data-testid="plan-this-week">
      <div className="rail-head">
        <h3>{heading}</h3>
        {total > 0 && (
          <span className="rail-prog mono" data-testid="rail-progress">
            {doneCount} / {total} done
          </span>
        )}
      </div>
      {total > 0 && (
        <div className="rail-bar" aria-hidden>
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
      <div className="rail-list">
        {rail.map((row) => {
          const s = row.session;
          const dayDate =
            s?.date ??
            (weekStart ? addDaysToYmd(weekStart, row.dayIndex) : null);
          const isToday = dayDate === today;
          const isPast = dayDate !== null && dayDate < today;
          if (!s) {
            return (
              <div
                key={`rest-${row.dayIndex}`}
                className={`rail-item rest-item${isToday ? " today-item" : ""}`}
                data-today={isToday ? "true" : undefined}
                data-testid={`plan-rail-${row.dayIndex}`}
              >
                <span className="rail-day mono">{row.dow}</span>
                <span className="rail-name">
                  Rest
                  {isToday && <span className="today-chip mono">TODAY</span>}
                </span>
                <span className="rail-kind mono">—</span>
              </div>
            );
          }
          const overdue = isOverdue(sessionToOverdueCandidate(s), today);
          const statusClass = s.done
            ? "done"
            : s.skipped
              ? "skipped"
              : "";
          return (
            <button
              type="button"
              key={s.id}
              className={`rail-item ${isPast && !isToday ? "past" : ""} ${
                isToday ? "today-item" : ""
              }${overdue ? " overdue" : ""}${statusClass ? ` ${statusClass}` : ""}`}
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
              {s.done ? (
                <span className="rail-status done" aria-label="Done">✓</span>
              ) : s.skipped ? (
                <span className="rail-status skip" aria-label="Skipped">⊘</span>
              ) : s.inProgress ? (
                <span className="rail-status inprog mono" aria-label="In progress">
                  ▸
                </span>
              ) : (
                <span className="rail-kind mono">
                  {s.isRehab ? "Rehab" : s.isCardio ? "Cardio" : "Strength"}
                </span>
              )}
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
          margin: 0;
          font-size: 15px;
          letter-spacing: -0.01em;
          color: var(--cp-text);
          font-weight: 700;
        }
        /* Soften the rail's tactical/monospace labels (day, kind, chips) to the
           body sans so the Today/Plan rail reads like a consumer app, not a
           terminal. Scoped to the rail so it never touches mono elsewhere. */
        .plan-rail .mono { font-family: var(--cp-font-sans, inherit); }
        .rail-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 6px;
        }
        .rail-prog {
          font-size: 12px;
          color: var(--cp-text-muted);
          font-weight: 500;
        }
        .rail-bar {
          height: 4px;
          border-radius: 999px;
          background: var(--cp-surface-soft);
          overflow: hidden;
          margin-bottom: 10px;
        }
        .rail-bar i {
          display: block;
          height: 100%;
          background: var(--cp-accent);
          border-radius: 999px;
          transition: width 200ms ease;
        }
        .rail-status {
          font-size: 14px;
          text-align: center;
          min-width: 18px;
        }
        .rail-status.done { color: var(--cp-accent); }
        .rail-status.inprog { color: var(--cp-warning); font-size: 12px; }
        .rail-status.skip { color: var(--cp-text-muted); }
        .rail-item.done .rail-name { color: var(--cp-text-muted); }
        .rail-item.skipped .rail-name {
          color: var(--cp-text-muted);
          text-decoration: line-through;
        }
        .rail-list { display: flex; flex-direction: column; }
        .rail-item {
          display: grid;
          grid-template-columns: 40px 1fr auto;
          gap: 12px;
          align-items: center;
          padding: 12px 0;
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
        .rail-day { font-size: 12px; color: var(--cp-text-soft); font-weight: 600; }
        .rail-name { font-size: 15px; font-weight: 600; letter-spacing: -0.01em; }
        .rail-name .today-chip { margin-left: 6px; }
        .rail-kind { font-size: 11px; color: var(--cp-text-muted); letter-spacing: 0.03em; text-transform: uppercase; }
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
  /**
   * One-tap finish for a pure cardio slot, forwarded to the drawer. See
   * `SessionDrawer`'s `markCardioDoneAction`.
   */
  markCardioDoneAction?: (formData: FormData) => Promise<{
    ok?: true;
    error?: string;
    sessionId?: string;
    sessionCompleted?: boolean;
  }>;
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
  markCardioDoneAction,
}: ThisWeekRailProps) {
  const router = useRouter();
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
  const rail = useMemo(
    () => buildWeekRailRows(sessions, railWeek),
    [sessions, railWeek],
  );

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
          onMutated={() => router.refresh()}
          moveAction={moveAction}
          skipAction={skipAction}
          unskipAction={unskipAction}
          updateNotesAction={updateNotesAction}
          startSessionAction={startSessionAction}
          markCardioDoneAction={markCardioDoneAction}
        />
      )}
    </>
  );
}
