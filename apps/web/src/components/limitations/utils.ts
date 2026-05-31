/**
 * Small UI helpers shared by the limitations components.
 */
import type { CSSProperties } from "react";

export type Severity = "mild" | "moderate" | "severe";

const SEVERITY_STYLE: Record<Severity, { bg: string; fg: string; border: string }> = {
  mild: {
    bg: "var(--cp-info-soft, rgba(56, 132, 255, 0.12))",
    fg: "var(--cp-info, #3b82f6)",
    border: "var(--cp-info, #3b82f6)",
  },
  moderate: {
    bg: "var(--cp-warn-soft, rgba(202, 138, 4, 0.16))",
    fg: "var(--cp-warn, #ca8a04)",
    border: "var(--cp-warn, #ca8a04)",
  },
  severe: {
    bg: "var(--cp-danger-soft, rgba(185, 28, 28, 0.16))",
    fg: "var(--cp-danger, #ef4444)",
    border: "var(--cp-danger, #ef4444)",
  },
};

export function severityBadgeStyle(s: Severity): CSSProperties {
  const v = SEVERITY_STYLE[s];
  return {
    display: "inline-flex",
    alignItems: "center",
    fontSize: 11,
    fontWeight: 700,
    textTransform: "uppercase",
    letterSpacing: "0.04em",
    padding: "2px 8px",
    borderRadius: 999,
    background: v.bg,
    color: v.fg,
    border: `1px solid ${v.border}`,
  };
}

/**
 * "3 days ago", "today", "2 weeks ago". Coarse-grained — fine-grain
 * absolute date is still rendered in a tooltip on the card.
 */
export function relativeFromNow(iso: string, nowMs: number = Date.now()): string {
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const diff = nowMs - t;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const day = 86_400_000;
  if (abs < day) return future ? "soon" : "today";
  const days = Math.floor(abs / day);
  if (days < 14) return future ? `in ${days} day${days === 1 ? "" : "s"}` : `${days} day${days === 1 ? "" : "s"} ago`;
  const weeks = Math.floor(days / 7);
  if (weeks < 8) return future ? `in ${weeks} week${weeks === 1 ? "" : "s"}` : `${weeks} weeks ago`;
  const months = Math.floor(days / 30);
  if (months < 18) return future ? `in ${months} month${months === 1 ? "" : "s"}` : `${months} months ago`;
  const years = Math.floor(days / 365);
  return future ? `in ${years} year${years === 1 ? "" : "s"}` : `${years} year${years === 1 ? "" : "s"} ago`;
}

export function durationDays(startIso: string, endIso: string | null): number {
  const a = new Date(startIso).getTime();
  const b = endIso ? new Date(endIso).getTime() : Date.now();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

/**
 * Free-text search predicate for an active-limitation card. Matches an
 * all-lowercase, whitespace-collapsed query against the row's kind,
 * severity, affected-side, notes, region label, affected-muscle labels,
 * and resolved affected-movement names. Pure + unit-tested; the caller
 * pre-resolves the label/name strings so this stays free of label maps.
 */
export function matchesLimitationQuery(
  item: {
    kind?: string | null;
    severity?: string | null;
    side?: string | null;
    notes?: string | null;
    regionLabel?: string | null;
    muscleLabels?: readonly string[];
    movementNames?: readonly string[];
  },
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (q === "") return true;
  const haystack = [
    item.kind ?? "",
    item.severity ?? "",
    item.side ?? "",
    item.notes ?? "",
    item.regionLabel ?? "",
    ...(item.muscleLabels ?? []),
    ...(item.movementNames ?? []),
  ]
    .join(" ")
    .toLowerCase();
  return q.split(/\s+/).every((token) => haystack.includes(token));
}

/**
 * Free-text filter for the affected-movements preview. Matches against
 * the movement display name and slug (case-insensitive substring).
 * Generic so it can be unit-tested without the preview's full shape.
 */
export function filterAffectedMovements<
  T extends { displayName: string; slug: string },
>(items: readonly T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [...items];
  return items.filter(
    (m) =>
      m.displayName.toLowerCase().includes(q) ||
      m.slug.toLowerCase().includes(q),
  );
}

const EVENT_VERB: Record<string, string> = {
  skip: "Skipped",
  swap: "Substituted",
  manual_end: "Ended block early on",
  custom: "Adjusted",
};

export function describeEngineEvent(ev: {
  eventType: string;
  originalMovementSlug: string | null;
  newMovementSlug: string | null;
}): string {
  const verb = EVENT_VERB[ev.eventType] ?? "Adjusted";
  if (ev.eventType === "swap" && ev.originalMovementSlug && ev.newMovementSlug) {
    return `${verb} ${ev.newMovementSlug} for ${ev.originalMovementSlug}`;
  }
  if (ev.originalMovementSlug) return `${verb} ${ev.originalMovementSlug}`;
  return verb;
}
