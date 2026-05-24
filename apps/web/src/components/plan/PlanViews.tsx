"use client";

/**
 * PlanViews — client wrapper around the three view modes.
 *
 * Owns:
 *   - View-mode tabs (Month / Timeline / List) — navigate via Link so
 *     the URL drives which view server renders.
 *   - Filter chips (All / Strength / Cardio) — pure client state,
 *     filters the pre-fetched items in place.
 *   - Legend collapse toggle — default collapsed on mobile, expanded
 *     on desktop (driven by initial prop).
 *   - MatchUnfulfilledModal open/close state for past-unfulfilled
 *     planned rows.
 */
import Link from "next/link";
import { useState, useMemo } from "react";
import type { CalendarItem, CalendarFilter } from "@/lib/plan/calendar-data";
import { filterCalendarItems } from "@/lib/plan/calendar-data";
import { MonthGrid } from "./MonthGrid";
import { Timeline } from "./Timeline";
import { PlanList } from "./PlanList";
import {
  MatchUnfulfilledModal,
  type StravaCandidate,
} from "./MatchUnfulfilledModal";
import { LEGEND_ITEMS, chipPaint } from "./calendar-paint";
import type { ProfileForFormat } from "@/lib/format/datetime";

export type ViewMode = "month" | "timeline" | "list";

export type PlanViewsProps = {
  items: CalendarItem[];
  view: ViewMode;
  filter: CalendarFilter;
  anchor: string;
  today: string;
  /** Initial legend-open state — server passes false on mobile, true on desktop. */
  defaultLegendOpen: boolean;
  /** When `match=<plannedId>` is set in the URL, open the modal on mount. */
  initialMatchPlannedId?: string;
  /**
   * Map of plannedId → list of same-day Strava candidate sessions so
   * the modal can render the matches without a client-side fetch.
   */
  candidatesByPlannedId: Record<string, StravaCandidate[]>;
  /** Planned-row lookup so the modal renders the actual planned details. */
  plannedById: Record<
    string,
    { id: string; date: string; title: string; summary?: string }
  >;
  linkAction: (formData: FormData) => Promise<void> | void;
  skipAction: (formData: FormData) => Promise<void> | void;
  formatProfile?: ProfileForFormat;
};

const TABS: { id: ViewMode; label: string }[] = [
  { id: "month", label: "Month" },
  { id: "timeline", label: "Timeline" },
  { id: "list", label: "List" },
];

const FILTERS: { id: CalendarFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "strength", label: "Strength" },
  { id: "cardio", label: "Cardio" },
];

export function PlanViews({
  items,
  view,
  filter: initialFilter,
  anchor,
  today,
  defaultLegendOpen,
  initialMatchPlannedId,
  candidatesByPlannedId,
  plannedById,
  linkAction,
  skipAction,
  formatProfile,
}: PlanViewsProps) {
  const [filter, setFilter] = useState<CalendarFilter>(initialFilter);
  const [legendOpen, setLegendOpen] = useState(defaultLegendOpen);
  const [matchPlannedId, setMatchPlannedId] = useState<string | null>(
    initialMatchPlannedId ?? null,
  );

  const filtered = useMemo(() => filterCalendarItems(items, filter), [items, filter]);

  const matchPlanned = matchPlannedId ? plannedById[matchPlannedId] ?? null : null;
  const matchCandidates = matchPlannedId
    ? candidatesByPlannedId[matchPlannedId] ?? []
    : [];

  const tabHref = (v: ViewMode) =>
    `/app/plan?view=${v}&filter=${filter}&date=${anchor}`;

  return (
    <div data-testid="plan-views" style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 12,
        }}
      >
        {/* View mode tabs */}
        <nav
          role="tablist"
          aria-label="Plan view modes"
          data-testid="plan-view-tabs"
          style={{ display: "flex", gap: 4 }}
        >
          {TABS.map((t) => {
            const active = t.id === view;
            return (
              <Link
                key={t.id}
                role="tab"
                aria-selected={active}
                href={tabHref(t.id)}
                data-testid={`plan-view-tab-${t.id}`}
                data-active={active ? "true" : "false"}
                style={{
                  padding: "6px 12px",
                  borderRadius: 8,
                  fontSize: 13,
                  fontWeight: active ? 700 : 500,
                  background: active ? "var(--cp-accent-soft)" : "transparent",
                  color: active ? "var(--cp-accent)" : "var(--cp-text-muted)",
                  border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  textDecoration: "none",
                }}
              >
                {t.label}
              </Link>
            );
          })}
        </nav>

        {/* Filter chips */}
        <div
          role="group"
          aria-label="Filter items"
          data-testid="plan-filter-chips"
          style={{ display: "flex", gap: 4, marginLeft: "auto" }}
        >
          {FILTERS.map((f) => {
            const active = f.id === filter;
            return (
              <button
                key={f.id}
                type="button"
                role="checkbox"
                aria-checked={active}
                onClick={() => setFilter(f.id)}
                data-testid={`plan-filter-${f.id}`}
                data-active={active ? "true" : "false"}
                style={{
                  padding: "5px 12px",
                  borderRadius: 999,
                  fontSize: 12,
                  fontWeight: active ? 600 : 500,
                  background: active ? "var(--cp-accent)" : "transparent",
                  color: active ? "var(--cp-on-accent, #000)" : "var(--cp-text-muted)",
                  border: `1px solid ${active ? "var(--cp-accent)" : "var(--cp-border)"}`,
                  cursor: "pointer",
                }}
              >
                {f.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Legend */}
      <div data-testid="plan-legend-row">
        <button
          type="button"
          onClick={() => setLegendOpen(!legendOpen)}
          aria-expanded={legendOpen}
          aria-controls="plan-legend-body"
          data-testid="plan-legend-toggle"
          style={{
            background: "transparent",
            border: 0,
            color: "var(--cp-text-muted)",
            fontSize: 11,
            cursor: "pointer",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            padding: 0,
          }}
        >
          {legendOpen ? "▾ Legend" : "▸ Legend"}
        </button>
        {legendOpen && (
          <ul
            id="plan-legend-body"
            data-testid="plan-legend"
            style={{
              listStyle: "none",
              padding: 0,
              margin: "6px 0 0",
              display: "flex",
              flexWrap: "wrap",
              gap: 10,
              fontSize: 11,
              color: "var(--cp-text-muted)",
            }}
          >
            {LEGEND_ITEMS.map((it) => {
              const paint = chipPaint(it.kind, it.priority);
              return (
                <li
                  key={it.id}
                  style={{ display: "flex", alignItems: "center", gap: 5 }}
                >
                  <span
                    aria-hidden
                    style={{
                      display: "inline-block",
                      width: 12,
                      height: 12,
                      background: paint.background === "transparent" ? "transparent" : paint.background,
                      border: paint.border,
                      borderRadius: it.diamond ? 2 : 999,
                      transform: it.diamond ? "rotate(45deg)" : undefined,
                    }}
                  />
                  {it.label}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {view === "month" && (
        <MonthGrid
          items={filtered}
          anchor={anchor}
          today={today}
          onMatchUnfulfilled={setMatchPlannedId}
        />
      )}
      {view === "timeline" && (
        <Timeline
          items={filtered}
          today={today}
          onMatchUnfulfilled={setMatchPlannedId}
          formatProfile={formatProfile}
        />
      )}
      {view === "list" && (
        <PlanList
          items={filtered}
          today={today}
          onMatchUnfulfilled={setMatchPlannedId}
          formatProfile={formatProfile}
        />
      )}

      <MatchUnfulfilledModal
        open={!!matchPlanned}
        planned={matchPlanned}
        candidates={matchCandidates}
        onClose={() => setMatchPlannedId(null)}
        onLink={linkAction}
        onSkip={skipAction}
        formatProfile={formatProfile}
      />
    </div>
  );
}
