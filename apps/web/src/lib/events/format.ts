/**
 * Formatting helpers for the /app/settings/events page. Pure functions — no
 * React, no Supabase — so they're trivially unit-testable.
 */
import { daysBetweenYmd } from "@/lib/dates";
import type { EventModality, EventPerformance, EventPriority } from "./schema";

/**
 * Returns a short "in N weeks" / "in 4 days" / "tomorrow" / "today"
 * style string for a YYYY-MM-DD `eventDate`, anchored to `todayYmd`.
 *
 * Negative deltas (event already past) flip to "N days ago" /
 * "N weeks ago". Both arguments are tz-anchored calendar strings so
 * this is timezone-irrelevant.
 */
export function formatRelativeEventDate(
  eventDate: string,
  todayYmd: string,
): string {
  const days = daysBetweenYmd(todayYmd, eventDate);
  if (days === 0) return "today";
  if (days === 1) return "tomorrow";
  if (days === -1) return "yesterday";
  const abs = Math.abs(days);
  const past = days < 0;
  if (abs < 14) {
    return past ? `${abs} days ago` : `in ${abs} days`;
  }
  if (abs < 60) {
    const w = Math.round(abs / 7);
    return past ? `${w} weeks ago` : `in ${w} weeks`;
  }
  if (abs < 365) {
    const m = Math.round(abs / 30);
    return past ? `${m} months ago` : `in ${m} months`;
  }
  const y = Math.round((abs / 365) * 10) / 10;
  return past ? `${y} years ago` : `in ${y} years`;
}

/**
 * Status of an upcoming event relative to today. Mirrors the taper
 * windows in @/lib/planner/taper but uses calendar-day arithmetic so
 * it's safe to call without a Date object.
 */
export type EventStatus = "today" | "tapering" | "upcoming" | "past";

export function eventStatus(
  eventDate: string,
  todayYmd: string,
  priority: EventPriority,
): EventStatus {
  const days = daysBetweenYmd(todayYmd, eventDate);
  if (days < 0) return "past";
  if (days === 0) return "today";
  const window = priority === "B" ? 7 : priority === "A" ? 14 : 0;
  if (window > 0 && days <= window) return "tapering";
  return "upcoming";
}

export function priorityColor(p: EventPriority): string {
  if (p === "A") return "var(--cp-danger)";
  if (p === "B") return "var(--cp-warning)";
  return "var(--cp-text-muted)";
}

export function priorityLabel(p: EventPriority): string {
  if (p === "A") return "A — peak";
  if (p === "B") return "B — important";
  return "C — logged";
}

const MODALITY_LABEL: Record<EventModality, string> = {
  run: "Run",
  bike: "Bike",
  swim: "Swim",
  row: "Row",
  ski: "Ski",
  strength: "Strength meet",
  padel: "Padel",
  other: "Other",
};

export function modalityLabel(m: string | null | undefined): string {
  if (!m) return "Unspecified";
  return MODALITY_LABEL[m as EventModality] ?? m;
}

/**
 * Format a modality-specific target or result payload as a short
 * human-readable string. Returns null when there's nothing useful to
 * render so callers can decide whether to hide the line entirely.
 */
export function formatPerformance(
  modality: string | null | undefined,
  perf: EventPerformance | null | undefined,
): string | null {
  if (!perf) return null;
  const parts: string[] = [];

  switch (modality) {
    case "run":
    case "bike":
    case "swim":
    case "row":
    case "ski": {
      if (typeof perf.targetDistanceKm === "number") {
        parts.push(`${perf.targetDistanceKm} km`);
      }
      if (typeof perf.targetTime === "string" && perf.targetTime) {
        parts.push(perf.targetTime);
      }
      if (typeof perf.paceSecPerKm === "number") {
        parts.push(`${formatPace(perf.paceSecPerKm)}/km`);
      }
      if (typeof perf.avgPowerW === "number" && modality === "bike") {
        parts.push(`${perf.avgPowerW} W`);
      }
      break;
    }
    case "strength": {
      if (typeof perf.targetTotal === "number") {
        parts.push(`Total ${perf.targetTotal} kg`);
      }
      const lifts = perf.lifts;
      if (lifts && typeof lifts === "object") {
        for (const [k, v] of Object.entries(lifts)) {
          if (typeof v === "number") parts.push(`${k} ${v}kg`);
        }
      }
      break;
    }
    case "padel": {
      if (typeof perf.targetRank === "string" && perf.targetRank) {
        parts.push(perf.targetRank);
      }
      break;
    }
    default: {
      if (typeof perf.description === "string" && perf.description) {
        parts.push(perf.description);
      }
      // Best-effort: spill any string/number fields we don't recognise.
      for (const [k, v] of Object.entries(perf)) {
        if (k === "description") continue;
        if (typeof v === "string" && v) parts.push(`${k}: ${v}`);
        if (typeof v === "number") parts.push(`${k}: ${v}`);
      }
    }
  }

  return parts.length > 0 ? parts.join(" · ") : null;
}

/** Format a seconds-per-km pace as M:SS. */
export function formatPace(secPerKm: number): string {
  const total = Math.round(secPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}
