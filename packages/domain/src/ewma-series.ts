/**
 * Daily EWMA series builder (DC-C1).
 *
 *   ATL = EWMA_7(daily_load)
 *   CTL = EWMA_28(daily_load)
 *
 * Pure function. Given a chronologically-ordered daily load series with
 * day-gaps allowed, walks the calendar day-by-day applying the EWMA
 * recurrence — zero-valued days still decay the average, which is what
 * we want (a week off = ATL drops, freshness rises).
 *
 *   EWMA(t) = α × value(t) + (1 − α) × EWMA(t − 1)
 *   α = 2 / (windowDays + 1)
 *
 * Used by apps/web/src/lib/engine/region-ledger.ts to materialise the
 * per-region rolling state from completed sessions.
 */

import { ewmaStep } from "./region-freshness";

/** Inclusive ISO date range, returning every YYYY-MM-DD. */
export function daysBetween(startIso: string, endIso: string): string[] {
  const out: string[] = [];
  const start = new Date(startIso + "T00:00:00Z");
  const end = new Date(endIso + "T00:00:00Z");
  if (end < start) return out;
  for (let d = start; d <= end; d = new Date(d.getTime() + 86400000)) {
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

/**
 * Walk a chronological day-by-day series applying the EWMA recurrence.
 * Returns the final EWMA value (suitable for "current ATL_r" / "current CTL_r").
 *
 * @param dailyLoad        Map of YYYY-MM-DD → load value (missing days = 0).
 * @param fromIso          First day to include (typically the user's first session date).
 * @param toIso            Last day to include (typically today).
 * @param windowDays       7 for ATL, 28 for CTL.
 */
export function finalEwma(
  dailyLoad: ReadonlyMap<string, number>,
  fromIso: string,
  toIso: string,
  windowDays: number,
): number {
  let prev = 0;
  for (const day of daysBetween(fromIso, toIso)) {
    const today = dailyLoad.get(day) ?? 0;
    prev = ewmaStep(prev, today, windowDays);
  }
  return prev;
}

/**
 * Same as finalEwma but emits the full per-day series — useful for
 * charting or for computing CTL+ATL simultaneously in one pass.
 */
export function ewmaSeries(
  dailyLoad: ReadonlyMap<string, number>,
  fromIso: string,
  toIso: string,
  windowDays: number,
): Map<string, number> {
  const out = new Map<string, number>();
  let prev = 0;
  for (const day of daysBetween(fromIso, toIso)) {
    const today = dailyLoad.get(day) ?? 0;
    prev = ewmaStep(prev, today, windowDays);
    out.set(day, prev);
  }
  return out;
}
