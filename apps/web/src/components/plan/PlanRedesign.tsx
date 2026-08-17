"use client";

/**
 * /app/plan redesign — program review and schedule adjustment:
 *
 *  1. Program identity, phase and completion state with controls nearby.
 *  2. Full-width engine-owned phase/week bands; current week expanded.
 *  3. Readable agenda rows for review, rescheduling and prescription edits.
 *  4. Calendar as a secondary date-oriented view.
 *
 * Workout launch/logging belongs to Today. Plan's shared SessionDrawer runs in
 * review-only mode while Today keeps its logging actions.
 *
 * Drag-and-drop on the agenda reorders sessions across days using
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
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type DragEvent,
  type ReactNode,
} from "react";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import {
  FOCUS_MUSCLE_LABEL,
  isFocusMuscle,
  type FocusMuscle,
} from "@/lib/planner/focus-muscles";
import { isOverdue, overdueDays } from "@/lib/planner/overdue";
import { prescriptionItemsHaveStrength } from "@/lib/sessions/strength-prescribed";
import { LogNowDateForm } from "@/components/plan/LogNowDateForm";
import { addDaysToYmd } from "@/lib/dates";
import {
  buildPlanPhaseGroups,
  type PlanProgramSegment,
} from "@/lib/plan/program-overview";
import {
  groupByMovementThenKind,
  collapseIdenticalSetItems,
  isSupplementalOnlySection,
  type PlanSetRow,
  type MovementPrescriptionSection,
  type PrescriptionMovementRow,
} from "@/lib/plan/prescription-grouping";
import {
  circuitNameOfRow,
  segmentSupersetRows,
  segmentSupersetSections,
} from "@/lib/plan/superset-grouping";
import { LinkActivityControl } from "@/components/plan/LinkActivityControl";
import { CompletedSummaryCard } from "@/components/plan/CompletedSummaryCard";
import { CardioPlanView } from "@/components/session/CardioPlanView";
import { EXTERNAL_CARDIO_DISPLAY_NOTE } from "@/lib/session/cardio-descriptions";
import {
  MovementPicker,
  type MovementSearchResult,
} from "@/components/movement-picker";
import {
  removePlannedMovement,
  swapPlannedMovement,
  addPlannedMovement,
} from "@/lib/sessions/planned-movement-actions";
import { setHyroxStationOverride } from "@/lib/hyrox/station-swap-actions";
import { stationAlternativesFor } from "@hta/hyrox";
import type { PrescriptionItem } from "@hta/db";
import { isRehabItem } from "@hta/domain";

export type PlanViewMode = "timeline" | "month" | "season";

export type PlanSessionInput = {
  id: string;
  weekIndex: number;
  dayIndex: number;
  date: string; // YYYY-MM-DD
  title: string;
  isCardio: boolean;
  isStrength: boolean;
  isRehab?: boolean;
  done: boolean;
  /** Linked session exists but isn't finished yet (started, not done). */
  inProgress?: boolean;
  skipped: boolean;
  slot: "single" | "am" | "pm";
  items: PrescriptionItem[];
  // Estimated duration (minutes) for the drawer meta line. Derived
  // upstream from prescription so the client doesn't have to redo it.
  estDurationMin: number | null;
  /** Drawer notes loaded from `planned_sessions.notes` (PR Z1). */
  notes: string | null;
  /**
   * The logged session linked to this planned slot (when done). Drives the
   * completed-summary view + the "View full session" link in the drawer.
   */
  completedSessionId?: string | null;
};

export type PlanRedesignProps = {
  archetypeName: string;
  /** Program family / methodology shown above the program name. */
  programFamilyName?: string;
  /** Durable backend marker; independent from the editable display name. */
  customized?: boolean;
  /** Engine-owned structural phases, rebased to this materialized block. */
  segments?: readonly PlanProgramSegment[];
  /** State-aware program actions rendered beside the program identity. */
  headerActions?: ReactNode;
  /** Program-aware noun for a training block — "cycle" (5/3/1) or "block"
   * (Tactical Barbell / Green Protocol / default). */
  cycleNoun?: "cycle" | "block";
  /** Per-block user-chosen focus muscles (0–2). Rendered as a badge in the plan header. */
  focusMuscles?: readonly string[];
  startedOn: string; // YYYY-MM-DD
  weeks: number;
  today: string; // YYYY-MM-DD
  currentWeekIndex: number; // 0-indexed; -1 if today is outside the block
  /** 0-indexed deload week (null = archetype has no deload, e.g. maintenance). */
  deloadWeekIndex?: number | null;
  sessions: PlanSessionInput[];
  view: PlanViewMode;
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
   * When true (Season-planning opt-in is on), render Season as the third local
   * view alongside Program and Calendar. Its server-rendered roadmap is supplied
   * through `seasonContent`, so switching tabs does not replace the Plan shell.
   */
  seasonEnabled?: boolean;
  /** Season roadmap rendered inside the shared Plan shell when enabled. */
  seasonContent?: ReactNode;
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

/**
 * Adapt the client-side `PlanSessionInput` (which uses `done`/`skipped`
 * booleans) to the pure-helper shape so we can share the overdue rule
 * with the server-side `PlannedDay` callers. `done` mirrors the linked
 * session's `completed_at IS NOT NULL` (NOT merely `completed_session_id`,
 * which is set on START); `skipped` mirrors `skipped_at IS NOT NULL` — see
 * `planner/queries.ts` and the plan page mapping.
 */
export function sessionToOverdueCandidate(s: PlanSessionInput) {
  return {
    date: s.date,
    completedSessionId: s.done ? "linked" : null,
    skippedAt: s.skipped ? "skipped" : null,
  };
}

export type PlanWeekState = "completed" | "current" | "past" | "upcoming";

/**
 * A week is `past` — not "needs attention" — when it is behind the current week
 * with sessions left unsettled. Missing a session is normal and carries no
 * penalty, so the state is styled neutrally and reported without alarm; the
 * settled count on the row already says exactly what happened.
 */
export function resolvePlanWeekState(args: {
  weekIndex: number;
  currentWeekIndex: number;
  settled: number;
  total: number;
}): PlanWeekState {
  if (args.weekIndex === args.currentWeekIndex) return "current";
  if (args.total > 0 && args.settled === args.total) return "completed";
  if (args.currentWeekIndex >= 0 && args.weekIndex < args.currentWeekIndex) {
    return "past";
  }
  return "upcoming";
}

function weekComposition(sessions: readonly PlanSessionInput[]): string {
  let strength = 0;
  let cardio = 0;
  let hybrid = 0;
  let rehab = 0;
  const trainedDays = new Set<number>();
  for (const session of sessions) {
    trainedDays.add(session.dayIndex);
    if (session.isRehab) rehab += 1;
    else if (session.isStrength && session.isCardio) hybrid += 1;
    else if (session.isStrength) strength += 1;
    else if (session.isCardio) cardio += 1;
  }
  const parts: string[] = [];
  if (strength > 0) parts.push(`${strength} strength`);
  if (cardio > 0) parts.push(`${cardio} cardio`);
  if (hybrid > 0) parts.push(`${hybrid} hybrid`);
  if (rehab > 0) parts.push(`${rehab} rehab`);
  const rest = Math.max(0, 7 - trainedDays.size);
  if (rest > 0) parts.push(`${rest} rest`);
  return parts.join(" · ") || "No sessions";
}

function percentRange(values: number[]): string | null {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return `${sorted[0]}%`;
  return `${sorted[0]}–${sorted[sorted.length - 1]}%`;
}

function weekLoadSummary(sessions: readonly PlanSessionInput[]): string {
  const main: number[] = [];
  const supplemental: number[] = [];
  for (const session of sessions) {
    for (const item of session.items) {
      if (item.percentTm == null) continue;
      if (item.kind === "main") main.push(item.percentTm);
      else if (item.kind === "back_off") supplemental.push(item.percentTm);
    }
  }
  const parts: string[] = [];
  const mainRange = percentRange(main);
  const supplementalRange = percentRange(supplemental);
  if (mainRange) parts.push(`Main lifts ${mainRange}`);
  if (supplementalRange) parts.push(`Supplemental ${supplementalRange}`);
  return parts.join(" · ") || "Open session for prescription details";
}

function sessionDoseSummary(session: PlanSessionInput): string {
  if (session.isRehab) {
    const movements = new Set(
      session.items.map((item) => item.movementId).filter(Boolean),
    ).size;
    return `Rehab · ${movements} movement${movements === 1 ? "" : "s"}`;
  }
  if (session.isCardio && !session.isStrength) {
    return session.estDurationMin != null
      ? `Conditioning · ~${session.estDurationMin} min`
      : "Conditioning";
  }
  const main = session.items.find((item) => item.kind === "main");
  if (main) {
    const supplementalCount = new Set(
      session.items
        .filter((item) => item.kind === "back_off")
        .map((item) => item.movementId),
    ).size;
    return `${formatPrescriptionItem(main)}${
      supplementalCount > 0
        ? ` · ${supplementalCount} supplemental`
        : ""
    }`;
  }
  const movements = new Set(
    session.items.map((item) => item.movementId).filter(Boolean),
  ).size;
  return `${movements || session.items.length} programmed movement${
    movements === 1 ? "" : "s"
  }${session.estDurationMin != null ? ` · ~${session.estDurationMin} min` : ""}`;
}

/**
 * Plan-header focus-muscle badge. Surfaces the active block's user-chosen
 * focus muscles next to the archetype eyebrow. (Moved here from the Today
 * page — focus is a block-planning concept, not a per-day one.)
 */
function PlanFocusBadge({ muscles }: { muscles: readonly string[] }) {
  const valid = muscles.filter(isFocusMuscle) as FocusMuscle[];
  if (valid.length === 0) return null;
  const label = valid.map((m) => FOCUS_MUSCLE_LABEL[m]).join(", ");
  return (
    <span
      data-testid="plan-focus-badge"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        marginLeft: 8,
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        padding: "2px 8px",
        borderRadius: 999,
        background: "var(--cp-accent-soft)",
        color: "var(--cp-accent)",
        border: "1px solid color-mix(in oklab, var(--cp-accent) 35%, transparent)",
        textTransform: "none",
      }}
    >
      <span aria-hidden="true">🎯</span>
      <span>Focus: {label}</span>
    </span>
  );
}

export function PlanRedesign(props: PlanRedesignProps) {
  const {
    archetypeName,
    programFamilyName = "SxC",
    customized = false,
    segments = [{ startWeekIndex: 0, label: archetypeName }],
    headerActions,
    cycleNoun = "block",
    focusMuscles = [],
    startedOn,
    weeks,
    today,
    currentWeekIndex,
    deloadWeekIndex,
    sessions,
    view: initialView,
    moveAction,
    skipAction,
    unskipAction,
    updateNotesAction,
    seasonEnabled = false,
    seasonContent,
  } = props;

  const router = useRouter();

  // View switching is a pure client-side transform over the same session set.
  // Keep it local and sync the URL so reloads preserve all three Plan views.
  const [view, setView] = useState<PlanViewMode>(initialView);
  const syncUrl = useCallback((nextView: PlanViewMode) => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams();
    if (nextView !== "timeline") params.set("view", nextView);
    const q = params.toString();
    const url = q ? `${window.location.pathname}?${q}` : window.location.pathname;
    window.history.replaceState(null, "", url + window.location.hash);
  }, []);
  const onViewChange = useCallback(
    (v: PlanViewMode) => {
      setView(v);
      syncUrl(v);
    },
    [syncUrl],
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

  // Date of grid cell (0,0), derived from any session: its date minus
  // its (week*7 + day) offset. Lets EVERY cell — including rest days with
  // no session — resolve its calendar date, so "today" highlights even on
  // a rest day (mirrors the month view, which computes dates independently
  // of sessions). Null only when the block has no dated sessions at all.
  const gridAnchorDate = useMemo(() => {
    const anchor = sessions.find((s) => s.date);
    if (!anchor) return null;
    return addDaysToYmd(anchor.date, -(anchor.weekIndex * 7 + anchor.dayIndex));
  }, [sessions]);

  // Per-week progress. A skipped session settles the schedule slot but remains
  // distinct from a completed workout in the program-wide completion count.
  const weekProgress = useMemo(() => {
    const out: { done: number; settled: number; total: number }[] = [];
    for (let w = 0; w < weeks; w++) {
      let done = 0;
      let settled = 0;
      let total = 0;
      for (let d = 0; d < 7; d++) {
        const bucket = byCell.get(`${w}-${d}`) ?? [];
        for (const s of bucket) {
          total += 1;
          if (s.done) done += 1;
          if (s.done || s.skipped) settled += 1;
        }
      }
      out.push({ done, settled, total });
    }
    return out;
  }, [byCell, weeks]);

  // DnD state — mirrors block-wizard Step5Schedule.
  const dragFromRef = useRef<string | null>(null);
  const [dragOverKey, setDragOverKey] = useState<string | null>(null);
  const handleDragStart = (sid: string) => (e: DragEvent<HTMLElement>) => {
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
      // The move action revalidates server data, but an imperatively-invoked
      // server action doesn't refresh the client router on its own — pull the
      // fresh plan so the grid updates without a full page reload.
      router.refresh();
    },
    [moveAction, router],
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

  const phaseGroups = useMemo(
    () => buildPlanPhaseGroups(segments, weeks),
    [segments, weeks],
  );
  const currentPhase =
    phaseGroups.find(
      (phase) =>
        currentWeekIndex >= phase.startWeekIndex &&
        currentWeekIndex <= phase.endWeekIndex,
    ) ??
    (currentWeekIndex >= weeks
      ? phaseGroups[phaseGroups.length - 1]!
      : phaseGroups[0]!);

  const totalSessions = sessions.length;
  const totalDone = sessions.filter((s) => s.done).length;
  const totalSkipped = sessions.filter((s) => s.skipped).length;
  // Overdue = past + not done + not skipped. `skipped` already takes
  // precedence inside `isOverdue`, so a skipped past row is excluded
  // here and only counted under `totalSkipped`. Scoped to the active
  // block because `sessions` only contains the current block's rows.
  const totalOverdue = sessions.filter((s) =>
    isOverdue(sessionToOverdueCandidate(s), today),
  ).length;
  const progressPct =
    totalSessions === 0
      ? 0
      : Math.max(0, Math.min(100, Math.round((totalDone / totalSessions) * 100)));

  return (
    <div data-testid="plan-redesign" style={{ display: "grid", gap: 24 }}>
      <header className="plan-program-head">
        <div className="plan-program-head-row">
          <div>
            <div className="plan-eyebrow">
              Active program · {programFamilyName}
              {customized ? (
                <span className="plan-customized-badge">Customized</span>
              ) : null}
              <PlanFocusBadge muscles={focusMuscles} />
            </div>
            <h1 className="plan-h1">{archetypeName}</h1>
            <div className="plan-program-subtitle">
              {currentWeekIndex < 0
                ? `Starts ${longDate(startedOn)} · ${currentPhase.label}`
                : currentWeekIndex >= weeks
                  ? `Program window complete · ${currentPhase.label}`
                  : `Week ${currentWeekIndex + 1} of ${weeks} · ${
                      currentPhase.label
                    } · ${weekComposition(
                  sessions.filter(
                    (session) => session.weekIndex === currentWeekIndex,
                  ),
                    )}`}
            </div>
          </div>
          {headerActions}
        </div>
        <div className="plan-progress-row">
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
          <span>
            <b>{totalDone}</b> of {totalSessions} sessions complete
          </span>
        </div>
        {(totalSkipped > 0 || totalOverdue > 0) && (
          <div className="plan-meta">
            {totalSkipped > 0 && <span>{totalSkipped} skipped</span>}
            {totalOverdue > 0 && (
              <span data-testid="plan-meta-overdue">
                <b className="plan-meta-overdue-count">{totalOverdue}</b>{" "}
                overdue
              </span>
            )}
          </div>
        )}
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
            Program
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
            Calendar
          </button>
          {seasonEnabled && (
            <button
              type="button"
              className="plan-view-btn"
              role="tab"
              data-active={view === "season" ? "true" : "false"}
              data-testid="plan-view-tab-season"
              aria-selected={view === "season"}
              onClick={() => onViewChange("season")}
            >
              Season
            </button>
          )}
        </div>
        <span className="plan-overview-hint">
          {view === "season"
            ? "Long-range training roadmap"
            : view === "month"
              ? "Date-oriented program calendar"
              : "Full program overview · current week expanded"}
        </span>
      </div>

      {view === "timeline" ? (
        <section
          className="plan-timeline plan-phase-stack"
          data-testid="plan-timeline"
          aria-label={`${cycleNoun === "cycle" ? "Cycle" : "Block"} overview`}
        >
          {phaseGroups.map((phase, phaseIndex) => {
            const phaseWeeks = Array.from(
              {
                length: phase.endWeekIndex - phase.startWeekIndex + 1,
              },
              (_, index) => phase.startWeekIndex + index,
            );
            const phaseSessions = sessions.filter(
              (session) =>
                session.weekIndex >= phase.startWeekIndex &&
                session.weekIndex <= phase.endWeekIndex,
            );
            const phaseSettled = phaseSessions.filter(
              (session) => session.done || session.skipped,
            ).length;
            const isCurrentPhase =
              currentWeekIndex >= phase.startWeekIndex &&
              currentWeekIndex <= phase.endWeekIndex;
            const weekLabel =
              phase.startWeekIndex === phase.endWeekIndex
                ? `Week ${phase.startWeekIndex + 1}`
                : `Weeks ${phase.startWeekIndex + 1}–${
                    phase.endWeekIndex + 1
                  }`;
            return (
              <details
                key={`${phase.startWeekIndex}-${phase.label}`}
                className={`plan-phase${isCurrentPhase ? " current" : ""}`}
                open={isCurrentPhase}
                data-testid={`plan-phase-${phaseIndex}`}
              >
                <summary className="plan-phase-head">
                  <span>
                    <span className="plan-phase-name">
                      {phase.label}
                      {isCurrentPhase && (
                        <span className="plan-phase-current">
                          Current phase
                        </span>
                      )}
                    </span>
                    <span className="plan-phase-meta">
                      {weekLabel} · {phaseSessions.length} sessions
                    </span>
                  </span>
                  <span className="plan-phase-progress">
                    {phaseSettled} / {phaseSessions.length} settled
                    <span className="plan-phase-chevron" aria-hidden="true">
                      ⌄
                    </span>
                  </span>
                </summary>
                <div className="plan-phase-weeks">
                  {phaseWeeks.map((weekIndex) => {
                    const progress = weekProgress[weekIndex]!;
                    const weekSessions = sessions.filter(
                      (session) => session.weekIndex === weekIndex,
                    );
                    const state = resolvePlanWeekState({
                      weekIndex,
                      currentWeekIndex,
                      settled: progress.settled,
                      total: progress.total,
                    });
                    const stateLabel =
                      state === "completed"
                        ? "Completed"
                        : state === "current"
                          ? "Current"
                          : state === "past"
                            ? "Past"
                            : "Upcoming";
                    const weekStart = addDaysToYmd(
                      startedOn,
                      weekIndex * 7,
                    );
                    const weekEnd = addDaysToYmd(weekStart, 6);
                    return (
                      <details
                        key={weekIndex}
                        className={`plan-week ${state}`}
                        open={state === "current"}
                        data-testid={`plan-timeline-week-${weekIndex}`}
                        data-today-row={
                          state === "current" ? "true" : undefined
                        }
                      >
                        <summary className="plan-week-head">
                          <span>
                            <span className="plan-week-name-row">
                              <strong>Week {weekIndex + 1}</strong>
                              <span className={`plan-week-tag ${state}`}>
                                {stateLabel}
                              </span>
                              {deloadWeekIndex === weekIndex && (
                                <span
                                  className="plan-week-tag deload"
                                  data-testid={`plan-week-deload-${weekIndex}`}
                                >
                                  Deload
                                </span>
                              )}
                            </span>
                            <span className="plan-week-dates">
                              {longDate(weekStart)}–{longDate(weekEnd)}
                            </span>
                          </span>
                          <span className="plan-week-summary">
                            <b>{weekComposition(weekSessions)}</b>
                            <span>{weekLoadSummary(weekSessions)}</span>
                          </span>
                          <span
                            className={`plan-week-result ${
                              state === "completed" ? "done" : ""
                            }`}
                          >
                            <b>
                              {progress.settled} / {progress.total || "—"}
                              {state === "completed" ? " ✓" : ""}
                            </b>
                            <span className="plan-week-chevron" aria-hidden="true">
                              ⌄
                            </span>
                          </span>
                        </summary>
                        <div className="plan-week-body">
                          <div className="plan-agenda-head">
                            <b>Week schedule</b>
                            <span>
                              Select a session to review or adjust it
                            </span>
                          </div>
                          <div className="plan-agenda-grid">
                            {Array.from({ length: 7 }, (_, dayIndex) => {
                              const cellKey = `${weekIndex}-${dayIndex}`;
                              const daySessions =
                                byCell.get(cellKey) ?? [];
                              const dayDate =
                                daySessions[0]?.date ??
                                (gridAnchorDate
                                  ? addDaysToYmd(
                                      gridAnchorDate,
                                      weekIndex * 7 + dayIndex,
                                    )
                                  : addDaysToYmd(
                                      startedOn,
                                      weekIndex * 7 + dayIndex,
                                    ));
                              const isToday = dayDate === today;
                              const dayCompleted =
                                daySessions.length > 0 &&
                                daySessions.every(
                                  (session) => session.done,
                                );
                              const dayState = dayCompleted
                                ? isToday
                                  ? "today-completed"
                                  : "completed"
                                : isToday
                                  ? "today"
                                  : daySessions.length === 0
                                    ? "rest"
                                    : "planned";
                              return (
                                <div
                                  key={dayIndex}
                                  className={`plan-agenda-day${
                                    isToday ? " today" : ""
                                  }${
                                    daySessions.length === 0 ? " rest" : ""
                                  }${
                                    dayCompleted ? " completed" : ""
                                  }`}
                                  data-today={
                                    isToday ? "true" : undefined
                                  }
                                  data-state={dayState}
                                  data-drag-over={
                                    dragOverKey === cellKey
                                      ? "true"
                                      : undefined
                                  }
                                  data-testid={`plan-day-cell-${weekIndex}-${dayIndex}`}
                                  onDragOver={handleDragOver(cellKey)}
                                  onDragLeave={handleDragLeave}
                                  onDrop={handleDrop(weekIndex, dayIndex)}
                                >
                                  <div className="plan-agenda-date mono">
                                    <span>{DOW_FULL[dayIndex]}</span>
                                    <b>
                                      {Number(dayDate.slice(8, 10))}
                                    </b>
                                    {isToday &&
                                      (dayCompleted ||
                                        daySessions.length === 0) && (
                                        <span className="plan-day-today-marker">
                                          Today
                                        </span>
                                      )}
                                  </div>
                                  <div className="plan-agenda-sessions">
                                    {daySessions.length === 0 ? (
                                      <div className="plan-agenda-rest">
                                        <b>Rest</b>
                                        <span>No programmed work</span>
                                      </div>
                                    ) : (
                                      daySessions.map((session) => {
                                        const overdue = isOverdue(
                                          sessionToOverdueCandidate(
                                            session,
                                          ),
                                          today,
                                        );
                                        const status = session.done
                                          ? "Done"
                                          : session.skipped
                                            ? "Skipped"
                                            : session.inProgress
                                              ? "In progress"
                                              : overdue
                                                ? `Overdue · ${overdueDays(
                                                    sessionToOverdueCandidate(
                                                      session,
                                                    ),
                                                    today,
                                                  )}d`
                                                : isToday
                                                  ? "Today"
                                                  : "Planned";
                                        const statusClass = session.done
                                          ? "done"
                                          : session.skipped
                                            ? "skipped"
                                            : session.inProgress
                                              ? "in-progress"
                                              : overdue
                                                ? "overdue"
                                                : isToday
                                                  ? "today"
                                                  : "planned";
                                        return (
                                          <button
                                            type="button"
                                            key={session.id}
                                            className={`plan-agenda-session${
                                              session.done ? " done" : ""
                                            }`}
                                            draggable={
                                              !session.done &&
                                              !session.skipped
                                            }
                                            data-testid={`plan-pill-${session.id}`}
                                            onClick={() =>
                                              openDrawer(session.id)
                                            }
                                            onDragStart={handleDragStart(
                                              session.id,
                                            )}
                                            onDragEnd={handleDragEnd}
                                          >
                                            <span>
                                              <strong>
                                                {session.title}
                                              </strong>
                                              <small>
                                                {sessionDoseSummary(
                                                  session,
                                                )}
                                              </small>
                                            </span>
                                            <span
                                              className={`plan-session-status ${statusClass}`}
                                              data-testid={
                                                overdue
                                                  ? `overdue-pill-${session.id}`
                                                  : undefined
                                              }
                                            >
                                              {session.done ? "✓ " : ""}
                                              {status}
                                            </span>
                                          </button>
                                        );
                                      })
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </details>
                    );
                  })}
                </div>
              </details>
            );
          })}
        </section>
      ) : view === "month" ? (
        <MonthAlternate
          sessions={sessions}
          today={today}
          onOpen={openDrawer}
        />
      ) : (
        <div data-testid="plan-season-view">{seasonContent}</div>
      )}

      {openSession && (
        <SessionDrawer
          session={openSession}
          today={today}
          weeks={weeks}
          onClose={closeDrawer}
          onMutated={() => router.refresh()}
          moveAction={moveAction}
          skipAction={skipAction}
          unskipAction={unskipAction}
          updateNotesAction={updateNotesAction}
          allowLogging={false}
        />
      )}

      <style>{`
        .plan-head { display: grid; gap: 6px; }
        .plan-eyebrow {
          font-size: 12px;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          font-weight: 600;
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
          font-weight: 800;
          letter-spacing: -0.02em;
          line-height: 1.1;
        }
        .plan-nav-link {
          /* Defined globally in globals.css — declared here too so
           * mobile-first viewports without globals.css cache still
           * paint correctly during SSR. Muted until hover, then accent. */
          color: var(--cp-text-muted);
          text-decoration: none;
          font-size: 13px;
          transition: color 0.12s;
        }
        .plan-nav-link:hover { color: var(--cp-link); }
        .plan-meta b.plan-meta-overdue-count {
          color: var(--cp-danger);
        }
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
        .plan-program-head {
          display: grid;
          gap: 16px;
          padding-bottom: 24px;
          border-bottom: 1px solid var(--cp-border);
        }
        .plan-program-head-row {
          display: flex;
          align-items: flex-start;
          justify-content: space-between;
          gap: 24px;
        }
        .plan-program-subtitle {
          margin-top: 7px;
          color: var(--cp-text-muted);
          font-size: 15px;
        }
        .plan-customized-badge {
          display: inline-flex;
          align-items: center;
          margin-left: 8px;
          border: 1px solid var(--cp-accent);
          border-radius: 999px;
          padding: 2px 7px;
          color: var(--cp-accent);
          font-size: 9px;
          font-weight: 700;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .plan-program-head .plan-h1 {
          margin-top: 4px;
          font-size: clamp(30px, 5vw, 44px);
          letter-spacing: -0.04em;
        }
        .plan-progress-row {
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 16px;
          align-items: center;
          color: var(--cp-text-muted);
          font-size: 13px;
        }
        .plan-progress-row .plan-progress {
          height: 7px;
          margin-top: 0;
          border-radius: 999px;
          background: var(--cp-surface-soft);
        }
        .plan-progress-row .plan-progress > span { border-radius: 999px; }
        .plan-progress-row b { color: var(--cp-text); }
        .plan-overview-hint {
          color: var(--cp-text-muted);
          font-size: 12px;
        }
        .plan-timeline.plan-phase-stack {
          max-height: none;
          display: grid;
          gap: 12px;
          overflow: visible;
          border: 0;
          border-radius: 0;
          background: transparent;
        }
        .plan-phase {
          overflow: hidden;
          border: 1px solid var(--cp-border);
          border-radius: 16px;
          background: var(--cp-surface);
          box-shadow: 0 0 2px var(--cp-border);
        }
        .plan-phase > summary,
        .plan-week > summary {
          list-style: none;
        }
        .plan-phase > summary::-webkit-details-marker,
        .plan-week > summary::-webkit-details-marker {
          display: none;
        }
        .plan-phase-head {
          min-height: 70px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 14px 18px;
          cursor: pointer;
          background: var(--cp-bg-elevated);
        }
        .plan-phase[open] > .plan-phase-head {
          border-bottom: 1px solid var(--cp-border);
        }
        .plan-phase-name {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 16px;
          font-weight: 800;
        }
        .plan-phase-current {
          padding: 3px 8px;
          border-radius: 999px;
          background: var(--cp-accent-soft);
          color: var(--cp-accent);
          font-size: 10px;
          font-weight: 800;
          text-transform: uppercase;
        }
        .plan-phase-meta,
        .plan-phase-progress {
          display: block;
          margin-top: 3px;
          color: var(--cp-text-muted);
          font-size: 12px;
        }
        .plan-phase-progress {
          margin-top: 0;
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          white-space: nowrap;
        }
        .plan-phase-chevron,
        .plan-week-chevron {
          display: inline-block;
          color: var(--cp-text-muted);
          font-size: 18px;
          transition: transform 140ms ease;
        }
        .plan-phase[open] > .plan-phase-head .plan-phase-chevron,
        .plan-week[open] > .plan-week-head .plan-week-chevron {
          transform: rotate(180deg);
        }
        .plan-week {
          border-bottom: 1px solid var(--cp-border);
        }
        .plan-week:last-child { border-bottom: 0; }
        .plan-week.completed { box-shadow: inset 4px 0 0 var(--cp-success); }
        .plan-week.current { box-shadow: inset 5px 0 0 var(--cp-accent); }
        .plan-week-head {
          min-height: 78px;
          display: grid;
          grid-template-columns: 160px minmax(0, 1fr) 86px;
          gap: 20px;
          align-items: center;
          padding: 12px 18px;
          cursor: pointer;
          background: var(--cp-surface);
        }
        .plan-week.completed > .plan-week-head {
          background: var(--cp-surface-soft);
        }
        .plan-week.current > .plan-week-head {
          background: color-mix(in srgb, var(--cp-accent) 22%, var(--cp-surface));
        }
        .plan-week.past > .plan-week-head {
          background: var(--cp-surface-soft);
        }
        .plan-week.upcoming > .plan-week-head {
          background: var(--cp-bg-elevated);
        }
        .plan-week-head:hover {
          filter: brightness(0.98);
        }
        .plan-week-name-row {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }
        .plan-week-name-row > strong { font-size: 16px; }
        .plan-week-dates {
          display: block;
          margin-top: 4px;
          color: var(--cp-text-muted);
          font-size: 12px;
        }
        .plan-week-tag {
          display: inline-flex;
          min-height: 22px;
          align-items: center;
          padding: 2px 7px;
          border-radius: 999px;
          font-size: 10px;
          font-weight: 800;
          letter-spacing: 0.03em;
          text-transform: uppercase;
        }
        .plan-week-tag.completed {
          color: var(--cp-success);
          background: color-mix(in srgb, var(--cp-success) 12%, transparent);
        }
        .plan-week-tag.current {
          color: var(--cp-accent);
          background: var(--cp-accent-soft);
        }
        .plan-week-tag.past {
          color: var(--cp-text-muted);
          border: 1px solid var(--cp-border);
          background: var(--cp-surface-soft);
        }
        .plan-week-tag.upcoming {
          color: var(--cp-text-muted);
          border: 1px solid var(--cp-border);
          background: var(--cp-surface-soft);
        }
        .plan-week-tag.deload {
          color: var(--cp-accent);
          border: 1px solid var(--cp-accent);
          background: transparent;
        }
        .plan-week-summary {
          display: grid;
          gap: 4px;
          min-width: 0;
        }
        .plan-week-summary b { font-size: 13px; }
        .plan-week-summary span {
          color: var(--cp-text-muted);
          font-size: 12px;
          line-height: 1.35;
        }
        .plan-week-result {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 10px;
          text-align: right;
          color: var(--cp-text-muted);
          white-space: nowrap;
        }
        .plan-week-result b { color: var(--cp-text); font-size: 14px; }
        .plan-week-result.done b { color: var(--cp-success); }
        .plan-week-body {
          padding: 0 18px 18px;
          background: var(--cp-surface);
        }
        .plan-agenda-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 16px;
          padding: 12px 0 10px;
          color: var(--cp-text-muted);
          font-size: 12px;
        }
        .plan-agenda-head b { color: var(--cp-text); font-size: 13px; }
        .plan-agenda-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 1px;
          overflow: hidden;
          border: 1px solid var(--cp-border);
          border-radius: 12px;
          background: var(--cp-border);
        }
        .plan-agenda-day {
          min-height: 82px;
          display: grid;
          grid-template-columns: 62px minmax(0, 1fr);
          gap: 12px;
          padding: 12px 14px;
          background: var(--cp-surface);
          transition: background 120ms ease;
        }
        .plan-agenda-day.today {
          background: var(--cp-bg-elevated);
          box-shadow: inset 0 0 0 2px var(--cp-text-soft);
        }
        .plan-agenda-day.completed {
          background: color-mix(in srgb, var(--cp-success) 18%, var(--cp-surface));
          box-shadow:
            inset 6px 0 0 var(--cp-success),
            inset 0 0 0 1px color-mix(in srgb, var(--cp-success) 32%, var(--cp-border));
        }
        .plan-agenda-day.today.completed {
          background: var(--cp-bg-elevated);
          box-shadow:
            inset 6px 0 0 var(--cp-success),
            inset 0 0 0 2px var(--cp-text-soft);
        }
        .plan-agenda-day.today .plan-agenda-date {
          color: var(--cp-text-soft);
        }
        .plan-agenda-day.today .plan-agenda-date b {
          color: var(--cp-text);
        }
        .plan-agenda-day.completed .plan-agenda-date b {
          color: var(--cp-success);
        }
        .plan-agenda-day.rest { grid-column: 1 / -1; }
        .plan-agenda-day[data-drag-over="true"] {
          outline: 2px dashed var(--cp-border-strong);
          outline-offset: -3px;
          background: var(--cp-surface-soft);
        }
        .plan-agenda-date {
          grid-row: 1;
          display: grid;
          align-content: center;
          gap: 2px;
          color: var(--cp-text-muted);
          font-size: 11px;
          font-weight: 800;
          letter-spacing: 0.08em;
          text-transform: uppercase;
        }
        .plan-agenda-date b {
          color: var(--cp-text);
          font-size: 18px;
          line-height: 1;
        }
        .plan-day-today-marker {
          width: fit-content;
          margin-top: 4px;
          padding: 2px 5px;
          border-radius: 4px;
          background: var(--cp-text);
          color: var(--cp-bg);
          font-size: 9px;
          font-weight: 800;
          letter-spacing: 0.04em;
          text-transform: none;
        }
        .plan-agenda-sessions {
          display: grid;
          align-content: center;
          gap: 6px;
        }
        .plan-agenda-session {
          width: 100%;
          min-width: 0;
          display: grid;
          grid-template-columns: minmax(0, 1fr) auto;
          gap: 12px;
          align-items: center;
          padding: 7px 0;
          border: 0;
          background: transparent;
          color: var(--cp-text);
          text-align: left;
          cursor: pointer;
        }
        .plan-agenda-session + .plan-agenda-session {
          border-top: 1px solid var(--cp-border);
        }
        .plan-agenda-session.done {
          padding: 10px 12px;
          border-radius: 8px;
          background: color-mix(in srgb, var(--cp-success) 16%, var(--cp-surface));
          box-shadow:
            inset 6px 0 0 var(--cp-success),
            inset 0 0 0 1px color-mix(in srgb, var(--cp-success) 30%, var(--cp-border));
        }
        .plan-agenda-day.completed .plan-agenda-session.done {
          padding: 7px 0;
          border-radius: 0;
          background: transparent;
          box-shadow: none;
        }
        .plan-agenda-session strong,
        .plan-agenda-session small {
          display: block;
          overflow-wrap: anywhere;
        }
        .plan-agenda-session strong { font-size: 14px; }
        .plan-agenda-session small {
          margin-top: 4px;
          color: var(--cp-text-muted);
          font-size: 12px;
        }
        .plan-agenda-rest {
          display: grid;
          align-content: center;
          gap: 4px;
        }
        .plan-agenda-rest span {
          color: var(--cp-text-muted);
          font-size: 12px;
        }
        .plan-session-status {
          padding: 4px 7px;
          border-radius: 999px;
          background: var(--cp-surface-soft);
          color: var(--cp-text-muted);
          font-size: 11px;
          white-space: nowrap;
        }
        .plan-session-status.done {
          color: var(--cp-text);
          border: 1px solid color-mix(in srgb, var(--cp-success) 48%, var(--cp-border));
          background: color-mix(in srgb, var(--cp-success) 15%, var(--cp-surface));
          font-weight: 700;
        }
        .plan-session-status.today {
          color: var(--cp-bg);
          background: var(--cp-text);
          border: 1px solid var(--cp-text);
          font-weight: 800;
        }
        .plan-session-status.overdue,
        .plan-session-status.in-progress {
          color: var(--cp-warning);
          background: color-mix(in srgb, var(--cp-warning) 10%, transparent);
        }
        .plan-session-status.skipped { text-decoration: line-through; }

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
          white-space: nowrap;
        }
        .plan-day-cell[data-today="true"] .day-num { color: var(--cp-accent); font-weight: 700; }
        .plan-day-cell[data-past="true"] .day-num { opacity: 0.5; }

        .today-dot {
          width: 6px;
          height: 6px;
          border-radius: 50%;
          background: var(--cp-accent);
          flex: none;
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
        .session-pill.rehab {
          background: color-mix(in srgb, var(--cp-warning) 12%, transparent);
          border-left-color: var(--cp-warning);
        }
        .session-pill.muted { opacity: 0.5; text-decoration: line-through; }
        /* Completed sessions read clearly at a glance: a bold check, full-
           strength left border and solid text (no fade / strikethrough) so
           "done" is obvious against incomplete/past pills. Stays non-green —
           green is reserved for today. */
        .session-pill.done {
          opacity: 1;
          border-left-width: 3px;
          font-weight: 600;
          text-decoration: none;
          color: var(--cp-text);
        }
        .session-pill.done .done-check {
          font-weight: 800;
          color: var(--cp-strength);
        }
        .session-pill.cardio.done .done-check {
          color: var(--cp-cardio);
        }
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

        .plan-month-grid {
          max-height: none;
          overflow-y: visible;
        }
        @media (max-width: 768px) {
          .plan-program-head-row {
            display: grid;
            gap: 18px;
          }
          .plan-program-subtitle {
            font-size: 14px;
            line-height: 1.45;
          }
          .plan-progress-row {
            grid-template-columns: 1fr;
            gap: 8px;
          }
          .plan-view-toggle {
            display: inline-flex !important;
            width: 100%;
          }
          .plan-view-btn {
            flex: 1;
            min-height: 42px;
          }
          .plan-overview-hint { display: none; }
          .plan-phase-head {
            align-items: flex-start;
            padding-inline: 14px;
          }
          .plan-phase-progress {
            max-width: 76px;
            text-align: right;
            white-space: normal;
          }
          .plan-week-head {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
            padding-inline: 14px;
          }
          .plan-week-summary {
            grid-column: 1;
          }
          .plan-week-summary span { font-size: 11px; }
          .plan-week-result {
            grid-column: 2;
            grid-row: 1 / span 2;
          }
          .plan-week-body { padding-inline: 14px; }
          .plan-agenda-head > span { display: none; }
          .plan-agenda-grid { grid-template-columns: 1fr; }
          .plan-agenda-day.rest { grid-column: auto; }
          .plan-agenda-day {
            grid-template-columns: 54px minmax(0, 1fr);
            gap: 8px;
          }
          .plan-agenda-session {
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 8px;
          }
          .plan-session-status {
            max-width: 82px;
            white-space: normal;
            text-align: center;
          }
        }
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
                const kind = s.isRehab
                  ? "rehab"
                  : s.isCardio
                    ? "cardio"
                    : "strength";
                const muted = isPast && !s.done;
                const overdue = isOverdue(sessionToOverdueCandidate(s), today);
                return (
                  <div
                    key={s.id}
                    className={`session-pill ${kind}${s.done ? " done" : ""}${muted ? " muted" : ""}${overdue ? " overdue" : ""}`}
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
                    {s.done && (
                      <span className="done-check" aria-hidden="true">
                        {"\u2713 "}
                      </span>
                    )}
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

/**
 * Pure helper: does this pointer-down originate on an interactive control
 * (button / link / form field) rather than the bare drag region?
 *
 * The drawer header doubles as the swipe-to-dismiss grip, so its pointer-down
 * handler calls `setPointerCapture`. If the press lands on the × close button
 * (which lives inside the header), capturing the pointer swallows the button's
 * synthesized `click`, so the close never fires. We bail out of the drag in
 * that case so interactive children behave normally. Accepts any object with a
 * `closest` method so it's unit-testable without a real DOM.
 */
export function pressStartsOnInteractive(
  target: { closest?: (selector: string) => unknown } | null,
): boolean {
  return !!target?.closest?.(
    "button, a, input, textarea, select, [role='button']",
  );
}

export function SessionDrawer({
  session,
  today,
  weeks,
  logHrefBase,
  onClose,
  onMutated,
  moveAction,
  skipAction,
  unskipAction,
  updateNotesAction,
  startSessionAction,
  markCardioDoneAction,
  allowLogging = true,
}: {
  session: PlanSessionInput;
  today: string;
  weeks: number;
  logHrefBase?: string;
  onClose: () => void;
  /**
   * Called after a mutation (swap) that needs the route re-fetched. The PARENT
   * supplies its own `router.refresh` so the refresh fires from a component that
   * stays MOUNTED — closing the drawer unmounts it (ThisWeekRail nulls the open
   * id), which dropped the drawer's own `router.refresh()` and left the Today
   * "This week" rail stale. Falls back to the drawer's router if omitted.
   */
  onMutated?: () => void;
  moveAction: (formData: FormData) => Promise<void> | void;
  skipAction: (formData: FormData) => Promise<void> | void;
  unskipAction: (formData: FormData) => Promise<void> | void;
  updateNotesAction: (
    id: string,
    notes: string,
  ) => Promise<{ ok?: true; error?: string }>;
  startSessionAction?: (formData: FormData) => Promise<void> | void;
  /**
   * One-tap completion for a PURE cardio slot. When supplied, the drawer's
   * "Mark done" finishes the session in place instead of routing the lifter to
   * the session screen only to press an identical "Mark done" there. The action
   * is `markExternalCardioComplete`: it lazily materialises the session, writes
   * the cardio log and completes the session, and is idempotent on re-click.
   * Omitted (or a hybrid/strength slot) falls back to the navigation link,
   * because those sessions still need sets logged.
   */
  markCardioDoneAction?: (formData: FormData) => Promise<{
    ok?: true;
    error?: string;
    sessionId?: string;
    sessionCompleted?: boolean;
  }>;
  /** Plan is review/edit-only; Today keeps workout logging actions enabled. */
  allowLogging?: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [showSwap, setShowSwap] = useState(false);
  const router = useRouter();
  // Inline error surfaced from a failed swap-day submit. The project
  // has no toast helper today (no `useToast`, no `toast(` callsites),
  // so we render the message inside the drawer and keep the drawer
  // open so the user can retry without losing context.
  const [swapError, setSwapError] = useState<string | null>(null);
  const [swapPending, setSwapPending] = useState(false);
  // One-tap cardio completion (see `markCardioDoneAction`). Kept separate from
  // the swap error so a failed finish doesn't clear a swap message.
  const [cardioDoneError, setCardioDoneError] = useState<string | null>(null);
  const [cardioDonePending, setCardioDonePending] = useState(false);
  const isToday = session.date === today;
  const overdue = isOverdue(sessionToOverdueCandidate(session), today);
  const overdueDayCount = overdue
    ? overdueDays(sessionToOverdueCandidate(session), today)
    : 0;

  // One-tap cardio: the index of the cardio item to complete, or null when this
  // slot isn't a pure cardio session. Gated on the SAME predicate the server
  // action uses for `isPureCardio` (plan §6.9) so the drawer can never offer a
  // one-tap finish for a session the server would refuse to complete.
  const pureCardioItemIndex = (() => {
    if (!markCardioDoneAction) return null;
    const items = session.items ?? [];
    if (prescriptionItemsHaveStrength(items)) return null;
    const idx = items.findIndex((it) =>
      typeof it?.kind === "string" && it.kind.startsWith("cardio_"),
    );
    return idx >= 0 ? idx : null;
  })();

  const onMarkCardioDone = () => {
    if (pureCardioItemIndex == null || !markCardioDoneAction) return;
    setCardioDoneError(null);
    setCardioDonePending(true);
    void (async () => {
      try {
        const fd = new FormData();
        fd.set("plannedSessionId", session.id);
        fd.set("itemIndex", String(pureCardioItemIndex));
        const res = await markCardioDoneAction(fd);
        if (res?.error) {
          setCardioDoneError(res.error);
          return;
        }
        // The rail reads from the server; refresh through the PARENT so the
        // refresh survives this drawer unmounting on close.
        onClose();
        if (onMutated) onMutated();
        else router.refresh();
      } catch {
        setCardioDoneError("Could not finish this session. Try again.");
      } finally {
        setCardioDonePending(false);
      }
    })();
  };

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
    // Don't start a drag (and capture the pointer) when the press lands on an
    // interactive control inside the header — e.g. the × close button.
    // Capturing would swallow that control's click. See pressStartsOnInteractive.
    if (pressStartsOnInteractive(e.target as unknown as { closest?: (s: string) => unknown })) {
      return;
    }
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
  const mainLiftCount = sections.movements.filter(
    (section) => !isSupplementalOnlySection(section),
  ).length;
  const supplementalLiftCount = sections.movements.filter(
    isSupplementalOnlySection,
  ).length;
  const accessoryCount =
    sections.accessories.length +
    sections.hingeCompensations.length +
    sections.tendon.length;
  const rehabMovementCount = sections.rehab.length;
  const rehabProtocolName = sections.rehab
    .flatMap((row) => row.items)
    .map((item) => item.meta?.rehabProtocolName)
    .find((name): name is string => typeof name === "string" && name.length > 0);
  const compositionLabel = useMemo(() => {
    const parts: string[] = [];
    if (mainLiftCount > 0) {
      parts.push(`${mainLiftCount} main lift${mainLiftCount === 1 ? "" : "s"}`);
    }
    if (supplementalLiftCount > 0) {
      parts.push(
        `${supplementalLiftCount} supplemental lift${
          supplementalLiftCount === 1 ? "" : "s"
        }`,
      );
    }
    if (accessoryCount > 0) {
      parts.push(`${accessoryCount} accessor${accessoryCount === 1 ? "y" : "ies"}`);
    }
    if (rehabMovementCount > 0) {
      parts.push(
        `${rehabMovementCount} rehab movement${rehabMovementCount === 1 ? "" : "s"}`,
      );
    }
    return parts.join(" + ");
  }, [
    mainLiftCount,
    supplementalLiftCount,
    accessoryCount,
    rehabMovementCount,
  ]);
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
      // Close the drawer FIRST, then refresh. onClose strips the #session=<id>
      // hash via history.replaceState; doing that AFTER router.refresh() changed
      // the URL out from under the in-flight refresh, so the refreshed RSC was
      // dropped and the Today hero / week-rail stayed stale until a manual
      // reload. Settling the URL before refreshing makes the refresh stick. The
      // move action already revalidated server data; an imperative server-action
      // call just doesn't refresh the client router on its own.
      onClose();
      // Defer the refresh to a fresh tick AFTER React commits onClose's unmount.
      // onClose sets the parent's openId to null, which unmounts this drawer in
      // the same synchronous block; firing router.refresh() inline let that
      // unmount commit swallow the refresh transition, so the "This week" rail
      // stayed stale until a manual reload (unlike the link-activity refresh,
      // which fires while the drawer is still mounted and so always stuck). A
      // post-commit timeout lets the refresh land on a settled tree + URL.
      const refresh = onMutated ?? (() => router.refresh());
      setTimeout(refresh, 0);
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
              {compositionLabel && ` · ${compositionLabel}`}
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
          <div
            className="drawer-actions"
            data-complete={session.done ? "true" : "false"}
            style={
              session.done
                ? { gridTemplateColumns: "repeat(2, minmax(0, 1fr))" }
                : undefined
            }
          >
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
            {/* "Mark done" and "Skip" only make sense for an un-logged session —
                hide them once the workout is complete. */}
            {!session.done && (
              <>
                {allowLogging && pureCardioItemIndex != null ? (
                  <button
                    type="button"
                    className="cp-btn"
                    onClick={onMarkCardioDone}
                    disabled={cardioDonePending}
                    data-testid="plan-drawer-mark-done"
                    data-one-tap="true"
                  >
                    {cardioDonePending ? "Finishing…" : "✓ Mark done"}
                  </button>
                ) : (
                  allowLogging &&
                  logHrefBase && (
                    <Link
                      href={`${logHrefBase}/${session.id}`}
                      className="cp-btn"
                      data-testid="plan-drawer-mark-done"
                    >
                      ✓ Mark done
                    </Link>
                  )
                )}
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
              </>
            )}
          </div>

          {cardioDoneError && (
            <p
              className="swap-form-error"
              role="alert"
              data-testid="plan-drawer-cardio-done-error"
            >
              {cardioDoneError}
            </p>
          )}

          {((overdue && !session.skipped && !session.done) ||
            (session.isCardio && !session.done && !session.skipped)) && (
            <div className="drawer-cta-extras">
              {allowLogging &&
                startSessionAction &&
                overdue &&
                !session.skipped &&
                !session.done && (
                <LogNowDateForm
                  plannedId={session.id}
                  title={session.title}
                  defaultDateYmd={session.date <= today ? session.date : today}
                  maxDateYmd={today}
                  minDateYmd={addDaysToYmd(today, -14)}
                  action={startSessionAction}
                />
              )}
              {session.isCardio && !session.done && !session.skipped && (
                <LinkActivityControl plannedId={session.id} onLinked={() => router.refresh()} />
              )}
            </div>
          )}

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

          {editing ? (
            <MovementEditList
              plannedSessionId={session.id}
              items={session.items}
              canRemoveMovements={!session.completedSessionId}
              onChanged={() => router.refresh()}
            />
          ) : session.done && session.completedSessionId ? (
            <CompletedSummaryCard sessionId={session.completedSessionId} />
          ) : (
            <>
              {sections.rehab.length > 0 && (
                <DrawerRowSection
                  testId="plan-drawer-section-rehab"
                  label={
                    rehabProtocolName && rehabProtocolName !== "Rehab"
                      ? `Rehab · ${rehabProtocolName}`
                      : "Rehab"
                  }
                  hint={session.isRehab ? undefined : "Do during warm-up"}
                  prefix="R"
                  rows={sections.rehab}
                  accent
                />
              )}
              <DrawerMovementSections sections={sections.movements} />

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
            </>
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
          /* Mobile (<=768px): full-screen bottom sheet with slide-up
             entrance, visible grab handle, and pointer-driven swipe-
             down dismiss. Desktop stays as the right-side panel.

             Declared *after* the base .drawer-head / .drawer-body rules on
             purpose: the selectors have equal specificity, so when this block
             sat earlier the base "padding: 18px 20px" shorthand won and reset
             the safe-area padding-top back to 18px. */
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
              /* Only .drawer-body scrolls (below), so the grab handle and the
                 header — and with them the × close button — stay pinned rather
                 than sliding under the status bar / notch on scroll. */
              overflow: hidden;
            }
            .drawer-drag-handle {
              display: flex;
              justify-content: center;
              align-items: center;
              /* inset:0 puts the top of the sheet under the status bar /
                 Dynamic Island, so push the grip past the safe area. */
              margin: calc(env(safe-area-inset-top, 0px) + 10px) 0 6px;
              flex: 0 0 auto;
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
              /* The handle above already clears the safe area and the header no
                 longer scrolls, so it needs no sticky offset of its own. */
              position: static;
              padding-top: 4px;
              flex: 0 0 auto;
              touch-action: none;
            }
            /* 24px glyph in a 44px hit area — the close target was otherwise
               below the minimum touch size and sat partly under the notch. */
            .plan-drawer .close {
              min-width: 44px;
              min-height: 44px;
              display: flex;
              align-items: center;
              justify-content: center;
              margin-right: -10px;
            }
            .plan-drawer .drawer-body {
              flex: 1 1 auto;
              min-height: 0;
              overflow-y: auto;
              overscroll-behavior: contain;
              -webkit-overflow-scrolling: touch;
              padding-bottom: calc(32px + env(safe-area-inset-bottom, 0px));
            }
          }
          @keyframes plan-drawer-slide-up {
            from { transform: translateY(100%); }
            to   { transform: translateY(0); }
          }
          @media (prefers-reduced-motion: reduce) {
            .plan-drawer { animation: none; }
          }
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
          .plan-drawer .drawer-cta-extras {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            gap: 8px;
            margin-bottom: 12px;
          }
          /* The "Log now" CTA (and its expanded date form) takes the full row so
             the form is readable and the primary button never wraps to 2 lines. */
          .plan-drawer .drawer-cta-extras > [data-testid^="overdue-log-"],
          .plan-drawer .drawer-cta-extras > [data-testid^="log-now-form-"] {
            flex: 1 1 100%;
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
          .plan-drawer .set-row > span:nth-child(2) {
            min-width: 0;
            overflow-wrap: anywhere;
          }
          .plan-drawer .set-row .v {
            font-family: var(--cp-font-mono);
            color: var(--cp-text);
            font-weight: 600;
            white-space: nowrap;
          }
          .plan-drawer .set-row.optional-set-row {
            grid-template-columns: 104px minmax(0, 1fr) auto;
          }
          .plan-drawer .set-row .optional-marker {
            color: var(--cp-text-muted);
            white-space: nowrap;
          }
          @media (max-width: 520px) {
            .plan-drawer .set-row.optional-set-row {
              grid-template-columns: 88px minmax(0, 1fr) auto;
              gap: 6px;
            }
          }
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
          .plan-drawer .cardio-block { margin-bottom: 8px; }
          .plan-drawer .cardio-line {
            display: grid;
            grid-template-columns: 84px 1fr;
            gap: 8px;
            padding: 8px 0;
            border-bottom: 1px solid var(--cp-border);
            font-size: 14px;
            align-items: baseline;
          }
          .plan-drawer .cardio-line .lbl {
            color: var(--cp-text-muted);
            font-family: var(--cp-font-mono);
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.06em;
          }
          .plan-drawer .cardio-line .val { color: var(--cp-text); }
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

function rangeHint(rows: PlanSetRow[]): string | null {
  // UI-only target label shown as a pill on the movement head, e.g.
  // "Target 3 × 5" — the count of working sets × their rep target.
  // Warm-ups are excluded (they live in a separate list), so this
  // mirrors the numbered set rows shown directly below. Purely a
  // glanceable summary — nothing is validated.
  const reps = rows
    .map((r) => r.item.reps)
    .filter((n): n is number => n != null);
  const count = rows.length;
  if (count === 0) return null;
  const prescribedSetRange = rows[0]?.item.setRange;
  const setLabel = prescribedSetRange
    ? `${prescribedSetRange.min}–${prescribedSetRange.max}`
    : String(count);
  const prescribedRepRange = rows[0]?.item.repRange;
  if (prescribedRepRange) {
    return `Target ${setLabel} × ${prescribedRepRange.min}–${prescribedRepRange.max}`;
  }
  if (reps.length === 0) {
    return prescribedSetRange
      ? `Target ${setLabel} sets`
      : `Target ${count} set${count === 1 ? "" : "s"}`;
  }
  const min = Math.min(...reps);
  const max = Math.max(...reps);
  const repLabel = min === max ? String(min) : `${min}–${max}`;
  return `Target ${setLabel} × ${repLabel}`;
}

function DrawerMovement({
  section,
  editing,
}: {
  section: MovementPrescriptionSection;
  editing: boolean;
}) {
  if (section.sets.length === 0 && section.warmups.length === 0) return null;
  const supplementalOnly = isSupplementalOnlySection(section);
  return (
    <div data-testid={`plan-drawer-movement-${section.rowKey}`}>
      <div className="movement-head">
        <span>{section.movementName}</span>
        {section.sets.length > 0 && rangeHint(section.sets) && (
          <span className="range-pill" data-testid="plan-drawer-range-pill">
            {rangeHint(section.sets)}
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
          <div className="section">
            {supplementalOnly
              ? "Supplemental lift"
              : section.sets.length > 1
                ? "Main lift"
                : "Main"}
          </div>
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
    <div
      className={`set-row${item.optional ? " optional-set-row" : ""}`}
      {...(item.optional ? { "data-optional": "true" } : {})}
    >
      <span className="n">
        {label}
        {item.optional ? (
          <span className="optional-marker"> · optional</span>
        ) : null}
      </span>
      <span>{item.movementName ?? "Movement"}</span>
      <span className="v">{formatPrescriptionItem(item)}</span>
    </div>
  );
}

/**
 * Edit mode for the plan drawer: a flat list of the workout's strength movements,
 * each with Swap + Remove, plus an "Add movement" control. Edits persist to THIS
 * planned session only (per-instance) and repaint via `onChanged` (router.refresh).
 */
function MovementEditList({
  plannedSessionId,
  items,
  canRemoveMovements,
  onChanged,
}: {
  plannedSessionId: string;
  items: PrescriptionItem[];
  canRemoveMovements: boolean;
  onChanged: () => void;
}) {
  const movements = useMemo(() => {
    const seen = new Set<string>();
    const out: { movementId: string; name: string; rehab: boolean }[] = [];
    for (const it of items) {
      if ((it.kind ?? "").startsWith("cardio_")) continue;
      const id = it.movementId;
      const rehab = isRehabItem(it);
      const key = `${rehab ? "rehab" : "core"}:${id}`;
      if (!id || seen.has(key)) continue;
      seen.add(key);
      const name = it.movementName ?? it.movementSlug ?? "Movement";
      out.push({
        movementId: id,
        name: rehab ? `Rehab · ${name}` : name,
        rehab,
      });
    }
    return out;
  }, [items]);
  const coreMovementCount = movements.filter((movement) => !movement.rehab).length;

  return (
    <div data-testid="plan-drawer-edit-movements" style={{ display: "grid", gap: 8 }}>
      {movements.length > 0 && <div className="section">Movements</div>}
      {movements.map((m) => (
        <MovementEditRow
          key={`${m.rehab ? "rehab" : "core"}:${m.movementId}`}
          plannedSessionId={plannedSessionId}
          movementId={m.movementId}
          rehab={m.rehab}
          name={m.name}
          canRemove={
            canRemoveMovements &&
            (m.rehab ? movements.length > 1 : coreMovementCount > 1)
          }
          removalLocked={!canRemoveMovements}
          onChanged={onChanged}
        />
      ))}
      {movements.length > 0 && (
        <AddMovementControl plannedSessionId={plannedSessionId} onChanged={onChanged} />
      )}
      <StationEditList plannedSessionId={plannedSessionId} items={items} onChanged={onChanged} />
    </div>
  );
}

/**
 * Edit the stations of a HYROX conditioning session (ADR 0064). Each station the
 * engine prescribed (carrying a stable `key`) gets a Swap to a curated equipment
 * alternative — persisted for THIS session only. Hidden for non-station sessions.
 */
function StationEditList({
  plannedSessionId,
  items,
  onChanged,
}: {
  plannedSessionId: string;
  items: PrescriptionItem[];
  onChanged: () => void;
}) {
  const stations = useMemo(() => {
    const cardio = items.find((it) => (it.cardioPlan?.stations?.length ?? 0) > 0);
    const overrides = ((cardio?.meta as Record<string, unknown> | undefined)?.stationOverrides ??
      {}) as Record<string, string>;
    const seen = new Set<string>();
    const out: { key: string; name: string; current?: string }[] = [];
    for (const r of cardio?.cardioPlan?.stations ?? []) {
      if (!r.key || seen.has(r.key)) continue;
      seen.add(r.key);
      if (stationAlternativesFor(r.key).length === 0) continue;
      out.push({ key: r.key, name: r.name, ...(overrides[r.key] ? { current: overrides[r.key] } : {}) });
    }
    return out;
  }, [items]);

  if (stations.length === 0) return null;
  return (
    <div data-testid="plan-drawer-edit-stations" style={{ display: "grid", gap: 8, marginTop: 4 }}>
      <div className="section">Stations</div>
      <div style={{ fontSize: 12, color: "var(--cp-text-muted)", marginTop: -4 }}>
        No kit for a station? Swap it for this workout only.
      </div>
      {stations.map((s) => (
        <StationEditRow
          key={s.key}
          plannedSessionId={plannedSessionId}
          stationKey={s.key}
          name={s.name}
          current={s.current}
          onChanged={onChanged}
        />
      ))}
    </div>
  );
}

function StationEditRow({
  plannedSessionId,
  stationKey,
  name,
  current,
  onChanged,
}: {
  plannedSessionId: string;
  stationKey: string;
  name: string;
  current?: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const alts = stationAlternativesFor(stationKey);

  const submit = (substituteKey: string) => {
    if (pending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("stationKey", stationKey);
      fd.set("substituteKey", substituteKey);
      const r = await setHyroxStationOverride(fd);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        onChanged();
      }
    });
  };

  return (
    <div
      data-testid={`plan-drawer-edit-station-${stationKey}`}
      style={{
        display: "grid",
        gap: 6,
        padding: "8px 10px",
        border: "1px solid var(--cp-border)",
        borderRadius: 8,
        background: "var(--cp-surface-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>
          {name}
          {current && <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}> · swapped</span>}
        </span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          {current && (
            <button
              type="button"
              className="cp-btn"
              onClick={() => submit("")}
              disabled={pending}
              style={editBtnStyle}
              data-testid={`plan-drawer-reset-station-${stationKey}`}
            >
              Reset
            </button>
          )}
          <button
            type="button"
            className="cp-btn"
            data-testid={`plan-drawer-swap-station-${stationKey}`}
            onClick={() => setOpen((v) => !v)}
            disabled={pending}
            style={editBtnStyle}
          >
            {open ? "Cancel" : "Swap"}
          </button>
        </span>
      </div>
      {open && (
        <div style={{ display: "grid", gap: 4 }}>
          {alts.map((a) => (
            <button
              key={a.key}
              type="button"
              onClick={() => submit(a.key)}
              disabled={pending}
              data-testid={`plan-drawer-station-alt-${stationKey}-${a.key}`}
              style={{
                textAlign: "left",
                background: a.key === current ? "var(--cp-accent-soft)" : "transparent",
                border: "1px solid var(--cp-border)",
                borderRadius: 7,
                padding: "7px 10px",
                fontSize: 13,
                color: "var(--cp-text)",
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {a.name}
              {a.approximate && (
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}> · approximate</span>
              )}
            </button>
          ))}
        </div>
      )}
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

function MovementEditRow({
  plannedSessionId,
  movementId,
  rehab,
  name,
  canRemove,
  removalLocked,
  onChanged,
}: {
  plannedSessionId: string;
  movementId: string;
  rehab: boolean;
  name: string;
  canRemove: boolean;
  removalLocked: boolean;
  onChanged: () => void;
}) {
  const [swapping, setSwapping] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const doRemove = () => {
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("movementId", movementId);
      fd.set("rehab", String(rehab));
      const r = await removePlannedMovement(fd);
      if (r.error) setError(r.error);
      else onChanged();
    });
  };
  const doSwap = (m: MovementSearchResult | null) => {
    if (!m || pending) return;
    setError(null);
    setWarning(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("movementId", movementId);
      fd.set("rehab", String(rehab));
      fd.set("newMovementId", m.id);
      const r = await swapPlannedMovement(fd);
      if (r.error) setError(r.error);
      else {
        setSwapping(false);
        onChanged();
        setWarning(r.warning ?? null);
      }
    });
  };

  return (
    <div
      data-testid={`plan-drawer-edit-movement-${rehab ? "rehab-" : ""}${movementId}`}
      style={{
        display: "grid",
        gap: 6,
        padding: "8px 10px",
        border: "1px solid var(--cp-border)",
        borderRadius: 8,
        background: "var(--cp-surface-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{name}</span>
        <span style={{ display: "inline-flex", gap: 6 }}>
          <button
            type="button"
            className="cp-btn"
            data-testid={`plan-drawer-swap-movement-${rehab ? "rehab-" : ""}${movementId}`}
            onClick={() => setSwapping((v) => !v)}
            disabled={pending}
            style={editBtnStyle}
          >
            {swapping ? "Cancel" : "Swap"}
          </button>
          <button
            type="button"
            className="cp-btn"
            data-testid={`plan-drawer-remove-movement-${rehab ? "rehab-" : ""}${movementId}`}
            onClick={doRemove}
            disabled={pending || !canRemove}
            title={
              canRemove
                ? undefined
                : removalLocked
                  ? "Movements can't be removed after a workout has started"
                  : "A workout needs at least one movement"
            }
            style={editBtnStyle}
          >
            Remove
          </button>
        </span>
      </div>
      {swapping && (
        <MovementPicker
          name={`__swap_${rehab ? "rehab_" : ""}${movementId}`}
          placeholder="Swap for…"
          onChange={doSwap}
        />
      )}
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </span>
      )}
      {warning && (
        <span
          role="status"
          data-testid="plan-drawer-swap-warning"
          style={{ fontSize: 12, color: "var(--cp-warning, var(--cp-text-muted))" }}
        >
          {warning}
        </span>
      )}
    </div>
  );
}

function AddMovementControl({
  plannedSessionId,
  onChanged,
}: {
  plannedSessionId: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const doAdd = (m: MovementSearchResult | null) => {
    if (!m || pending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("plannedSessionId", plannedSessionId);
      fd.set("movementId", m.id);
      const r = await addPlannedMovement(fd);
      if (r.error) setError(r.error);
      else {
        setOpen(false);
        onChanged();
      }
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        data-testid="plan-drawer-add-movement"
        onClick={() => setOpen(true)}
        style={{
          justifySelf: "start",
          background: "transparent",
          border: "1px dashed var(--cp-border)",
          borderRadius: 999,
          padding: "6px 14px",
          fontSize: 13,
          color: "var(--cp-text-muted)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        + Add movement
      </button>
    );
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <MovementPicker
        name="__add_planned_movement"
        placeholder="Search the catalog…"
        onChange={doAdd}
      />
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <button
          type="button"
          data-testid="plan-drawer-add-movement-cancel"
          onClick={() => setOpen(false)}
          style={{ background: "transparent", border: "none", color: "var(--cp-text-muted)", fontSize: 12, cursor: "pointer", padding: 0 }}
        >
          × cancel
        </button>
        {pending && <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Adding…</span>}
      </div>
      {error && (
        <span role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </span>
      )}
    </div>
  );
}

const editBtnStyle: React.CSSProperties = {
  fontSize: 12,
  padding: "4px 10px",
  minHeight: 32,
};

/**
 * Bracket around a set of linked movements or rows.
 *
 * Shared by the drawer's accessory rows and its main/supplemental movement
 * cards so a link looks the same wherever it appears. Falls back to a
 * size-derived name only when the link carries none.
 */
function DrawerSupersetCluster({
  groupId,
  name,
  size,
  children,
}: {
  groupId: string;
  name?: string | null;
  size?: number;
  children: React.ReactNode;
}) {
  const label =
    name && name.length > 0
      ? name
      : size != null && size > 3
        ? "Giant set"
        : size === 3
          ? "Tri-set"
          : "Superset";
  return (
    <div
      data-testid="superset-cluster"
      data-superset-group={groupId}
      style={{
        borderLeft: "2px solid var(--cp-accent, var(--cp-text-muted))",
        paddingLeft: 8,
        margin: "2px 0",
      }}
    >
      <div
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          color: "var(--cp-accent, var(--cp-text-muted))",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      {children}
    </div>
  );
}

/**
 * The drawer's main + supplemental movement cards, with linked movements
 * bracketed together.
 *
 * Exported so the bracketing is reachable from a test: the drawer itself only
 * opens through interaction, which is how it shipped rendering user-authored
 * links as plain, unrelated cards.
 */
export function DrawerMovementSections({
  sections,
}: {
  sections: readonly MovementPrescriptionSection[];
}) {
  return (
    <>
      {segmentSupersetSections(sections).map((seg) =>
        seg.kind === "solo" ? (
          <DrawerMovement
            key={seg.section.rowKey}
            section={seg.section}
            editing={false}
          />
        ) : (
          <DrawerSupersetCluster
            key={seg.groupId}
            groupId={seg.groupId}
            name={seg.name}
            size={seg.sections.length}
          >
            {seg.sections.map((sec) => (
              <DrawerMovement key={sec.rowKey} section={sec} editing={false} />
            ))}
          </DrawerSupersetCluster>
        ),
      )}
    </>
  );
}

function DrawerRowSection({
  label,
  hint,
  prefix,
  rows,
  testId,
  accent = false,
}: {
  label: string;
  hint?: string;
  prefix: string;
  rows: PrescriptionMovementRow[];
  testId: string;
  accent?: boolean;
}) {
  const segments = segmentSupersetRows(rows);
  const rendered: React.ReactNode[] = [];
  let num = 0;
  for (const seg of segments) {
    if (seg.kind === "solo") {
      num += 1;
      rendered.push(
        <DrawerAccessoryRow key={seg.row.rowKey} prefix={prefix} num={num} row={seg.row} />,
      );
      continue;
    }
    const inner: React.ReactNode[] = [];
    for (const r of seg.rows) {
      num += 1;
      inner.push(<DrawerAccessoryRow key={r.rowKey} prefix={prefix} num={num} row={r} />);
    }
    rendered.push(
      <DrawerSupersetCluster
        key={seg.groupId}
        groupId={seg.groupId}
        name={circuitNameOfRow(seg.rows[0]!)}
        size={seg.rows.length}
      >
        {inner}
      </DrawerSupersetCluster>,
    );
  }
  return (
    <div
      data-testid={testId}
      style={
        accent
          ? {
              borderLeft: "2px solid var(--cp-accent)",
              paddingLeft: 10,
            }
          : undefined
      }
    >
      <div className="section">
        {label}
        {hint && (
          <span
            style={{
              marginLeft: 8,
              fontSize: 11,
              fontWeight: 500,
              color: "var(--cp-accent)",
              textTransform: "none",
              letterSpacing: 0,
            }}
          >
            {hint}
          </span>
        )}
      </div>
      {rendered}
    </div>
  );
}

function DrawerAccessoryRow({
  prefix,
  num,
  row,
}: {
  prefix: string;
  num: number;
  row: PrescriptionMovementRow;
}) {
  return (
    <div className="set-row">
      <span className="n">
        {prefix}
        {num}
      </span>
      <span>{row.movementName}</span>
      <span className="v">
        {collapseIdenticalSetItems(row.items).map((it, j) => (
          <span key={j}>
            {j > 0 ? " · " : ""}
            {formatPrescriptionItem(it)}
          </span>
        ))}
      </span>
    </div>
  );
}

function DrawerCardio({ items }: { items: PrescriptionItem[] }) {
  return (
    <div data-testid="plan-drawer-section-cardio">
      <div className="section">Cardio</div>
      {items.map((it, i) => {
        const duration = it.durationMin != null ? `${it.durationMin} min` : null;
        const target = it.hrCap ?? null;
        // Plans materialised before cardioPlan still carry the engine's rich note
        // in `notes` plus a generic "display-only" placeholder in protocolNote.
        // Prefer the real note; suppress the placeholder so the drawer shows the
        // actual instructions, not "log it from your tracker".
        const richNote = (it.notes ?? "").trim();
        const protoRaw = (it.protocolNote ?? "").trim();
        const protocol =
          protoRaw && protoRaw !== EXTERNAL_CARDIO_DISPLAY_NOTE.trim() ? protoRaw : null;
        // When nothing meaningful is present, fall back to the one-line formatter.
        const fallback = !target && !protocol && !richNote ? formatPrescriptionItem(it) : null;
        return (
          <div key={i} data-testid={`plan-drawer-cardio-${i}`} className="cardio-block">
            <div className="movement-head">
              <span>{it.movementName ?? "Cardio"}</span>
              {duration && (
                <span className="range-pill" data-testid="plan-drawer-cardio-duration">
                  {duration}
                </span>
              )}
            </div>
            {it.cardioPlan ? (
              <div style={{ marginTop: 8 }}>
                <CardioPlanView plan={it.cardioPlan} />
              </div>
            ) : (
              <>
                {richNote && (
                  <div className="cardio-line">
                    <span className="lbl">Session</span>
                    <span className="val">{richNote}</span>
                  </div>
                )}
                {target && (
                  <div className="cardio-line">
                    <span className="lbl">Target</span>
                    <span className="val">{target}</span>
                  </div>
                )}
                {protocol && (
                  <div className="cardio-line">
                    <span className="lbl">Protocol</span>
                    <span className="val">{protocol}</span>
                  </div>
                )}
                {fallback && (
                  <div className="cardio-line">
                    <span className="lbl">Detail</span>
                    <span className="val">{fallback}</span>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })}
    </div>
  );
}
