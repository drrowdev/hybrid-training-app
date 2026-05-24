"use client";

/**
 * MonthGrid — calendar month view of plan + logged items.
 *
 * Renders the canonical 7×6 Monday-first grid (42 cells). Items are
 * grouped by date into ≤3 chips per cell + an overflow "+N more" pill.
 * The today cell carries a 2px accent ring; out-of-month days are
 * muted at 40% opacity.
 *
 * Tapping a cell expands it inline (single open cell at a time) and
 * lists every item with the full title + meta. Chip taps navigate to
 * the item's href (start session, view session, race detail, or the
 * MatchUnfulfilledModal opener).
 */
import Link from "next/link";
import { useState } from "react";
import type { CalendarItem } from "@/lib/plan/calendar-data";
import { monthGridCells, monthShift, parseMonthAnchor } from "@/lib/plan/month-grid";
import { chipPaint } from "./calendar-paint";

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export type MonthGridProps = {
  items: CalendarItem[];
  /** Anchor date (any day in the visible month) — YYYY-MM-DD. */
  anchor: string;
  today: string;
  /** Open the match modal for the given past_unfulfilled planned id. */
  onMatchUnfulfilled?: (plannedId: string) => void;
};

export function MonthGrid({ items, anchor, today, onMatchUnfulfilled }: MonthGridProps) {
  const { year, month } = parseMonthAnchor(anchor, today);
  const cells = monthGridCells(year, month);
  const monthLabel = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

  // Bucket items by date.
  const byDate = new Map<string, CalendarItem[]>();
  for (const it of items) {
    const bucket = byDate.get(it.date);
    if (bucket) bucket.push(it);
    else byDate.set(it.date, [it]);
  }

  const [openDate, setOpenDate] = useState<string | null>(null);

  return (
    <section
      className="cp-card"
      data-testid="plan-month-grid"
      style={{ padding: 16, display: "grid", gap: 12 }}
    >
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 16, fontWeight: 600 }}>{monthLabel}</h2>
        <nav style={{ display: "flex", gap: 6 }} aria-label="Month navigation">
          <Link
            data-testid="plan-month-prev"
            href={`/app/plan?view=month&date=${monthShift(year, month, -1)}`}
            className="cp-btn ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            aria-label="Previous month"
          >
            ← prev
          </Link>
          <Link
            data-testid="plan-month-today"
            href={`/app/plan?view=month&date=${today}`}
            className="cp-btn ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
          >
            today
          </Link>
          <Link
            data-testid="plan-month-next"
            href={`/app/plan?view=month&date=${monthShift(year, month, 1)}`}
            className="cp-btn ghost"
            style={{ fontSize: 12, padding: "4px 10px" }}
            aria-label="Next month"
          >
            next →
          </Link>
        </nav>
      </header>

      <div
        role="grid"
        aria-label={`${monthLabel} calendar`}
        style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 4 }}
      >
        {DOW.map((d) => (
          <div
            key={d}
            role="columnheader"
            style={{
              fontSize: 10,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              textAlign: "center",
              padding: "4px 0",
            }}
          >
            {d}
          </div>
        ))}
        {cells.map((cell) => {
          const dayItems = byDate.get(cell.date) ?? [];
          const isToday = cell.date === today;
          const isOpen = openDate === cell.date;
          return (
            <DayCell
              key={cell.date}
              date={cell.date}
              day={cell.day}
              inMonth={cell.inMonth}
              isToday={isToday}
              isOpen={isOpen}
              items={dayItems}
              onToggle={() => setOpenDate(isOpen ? null : cell.date)}
              onMatchUnfulfilled={onMatchUnfulfilled}
            />
          );
        })}
      </div>
    </section>
  );
}

function DayCell({
  date,
  day,
  inMonth,
  isToday,
  isOpen,
  items,
  onToggle,
  onMatchUnfulfilled,
}: {
  date: string;
  day: number;
  inMonth: boolean;
  isToday: boolean;
  isOpen: boolean;
  items: CalendarItem[];
  onToggle: () => void;
  onMatchUnfulfilled?: (plannedId: string) => void;
}) {
  const visible = items.slice(0, 3);
  const overflow = items.length - visible.length;

  const onKey = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onToggle();
    }
  };

  return (
    <div
      role="gridcell"
      data-testid={`plan-month-cell-${date}`}
      data-today={isToday ? "true" : undefined}
      data-in-month={inMonth ? "true" : "false"}
      tabIndex={inMonth ? 0 : -1}
      onClick={onToggle}
      onKeyDown={onKey}
      aria-label={`${date}${items.length > 0 ? ` — ${items.length} item${items.length === 1 ? "" : "s"}` : ""}`}
      style={{
        minHeight: 84,
        padding: 6,
        borderRadius: 6,
        background: isOpen
          ? "var(--cp-accent-soft, var(--cp-surface-soft))"
          : "var(--cp-surface-soft)",
        border: isToday
          ? "2px solid var(--cp-accent)"
          : "1px solid var(--cp-border)",
        opacity: inMonth ? 1 : 0.4,
        cursor: items.length > 0 ? "pointer" : "default",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        gridColumn: isOpen ? "1 / -1" : undefined,
      }}
    >
      <div
        style={{
          fontSize: 11,
          fontWeight: isToday ? 700 : 500,
          color: isToday ? "var(--cp-accent)" : "var(--cp-text-muted)",
        }}
      >
        {day}
      </div>
      {!isOpen && (
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          {visible.map((it, i) => (
            <Chip key={`${it.kind}-${it.sessionId ?? it.eventId ?? i}`} item={it} compact />
          ))}
          {overflow > 0 && (
            <span
              style={{
                fontSize: 10,
                color: "var(--cp-text-muted)",
                padding: "1px 4px",
              }}
            >
              +{overflow} more
            </span>
          )}
        </div>
      )}
      {isOpen && (
        <div
          data-testid={`plan-month-cell-open-${date}`}
          onClick={(e) => e.stopPropagation()}
          style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 4 }}
        >
          {items.length === 0 && (
            <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
              Nothing scheduled.
            </span>
          )}
          {items.map((it, i) => (
            <ItemRow
              key={`${it.kind}-${it.sessionId ?? it.eventId ?? i}`}
              item={it}
              onMatchUnfulfilled={onMatchUnfulfilled}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function Chip({ item, compact }: { item: CalendarItem; compact?: boolean }) {
  const paint = chipPaint(item.kind, item.priority);
  const isEvent = item.kind === "event";
  return (
    <Link
      href={item.href}
      onClick={(e) => e.stopPropagation()}
      data-testid={`plan-chip-${item.kind}`}
      data-kind={item.kind}
      title={item.title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        fontSize: compact ? 10 : 12,
        padding: compact ? "1px 5px" : "3px 8px",
        borderRadius: isEvent ? 0 : 999,
        transform: isEvent ? "rotate(0)" : undefined,
        background: paint.background,
        border: paint.border,
        color: paint.color,
        textDecoration: "none",
        maxWidth: "100%",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        fontWeight: 500,
      }}
    >
      {isEvent && (
        <span aria-hidden style={{ fontSize: compact ? 8 : 10 }}>
          ◆
        </span>
      )}
      {item.slotBadge && (
        <span
          aria-label={item.slotBadge === "am" ? "two-a-day morning session" : "two-a-day evening session"}
          title="Two-a-day · tap the AM/PM badge on the day card for details"
          className="mono"
          style={{
            fontSize: compact ? 8 : 9,
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            opacity: 0.85,
          }}
        >
          {item.slotBadge}
        </span>
      )}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{item.title}</span>
    </Link>
  );
}

function ItemRow({
  item,
  onMatchUnfulfilled,
}: {
  item: CalendarItem;
  onMatchUnfulfilled?: (plannedId: string) => void;
}) {
  if (item.kind === "past_unfulfilled" && onMatchUnfulfilled) {
    const paint = chipPaint(item.kind);
    return (
      <button
        type="button"
        data-testid={`plan-row-${item.kind}`}
        onClick={(e) => {
          e.stopPropagation();
          if (item.sessionId) onMatchUnfulfilled(item.sessionId);
        }}
        style={{
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 4,
          padding: "6px 8px",
          background: paint.background,
          border: paint.border,
          color: "var(--cp-text)",
          borderRadius: 8,
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <span style={{ fontSize: 12, fontWeight: 500 }}>{item.title}</span>
        <span style={{ fontSize: 10, color: "var(--cp-warning)" }}>Tap to match →</span>
        {item.meta && (
          <span style={{ fontSize: 10, color: "var(--cp-text-muted)", gridColumn: "1 / -1" }}>
            {item.meta}
          </span>
        )}
      </button>
    );
  }
  return (
    <Link
      href={item.href}
      data-testid={`plan-row-${item.kind}`}
      onClick={(e) => e.stopPropagation()}
      style={{
        display: "grid",
        gridTemplateColumns: "auto 1fr",
        gap: 6,
        alignItems: "center",
        padding: "6px 8px",
        borderRadius: 8,
        background: "var(--cp-surface)",
        border: "1px solid var(--cp-border)",
        color: "var(--cp-text)",
        textDecoration: "none",
      }}
    >
      <Chip item={item} />
      <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
        {item.meta ?? ""}
      </span>
    </Link>
  );
}
