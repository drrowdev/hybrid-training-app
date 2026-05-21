/**
 * Taper rules (Phase 2 + new §6).
 *
 * Pure logic: given the next A-priority event and a calendar date,
 * return the taper recommendation (volume cut + intensity action).
 *
 * Research basis (citations resolved in design-constraints):
 *   - Mujika & Padilla 2003 meta — 14-day taper preserves performance,
 *     ≥20% volume cut with intensity held high is the best dose.
 *   - Bosquet 2007 — non-linear taper (steeper later) beats linear.
 *
 * For MVP we stick with a 14-day window split into two phases:
 *   14–8 days out: -20% volume, hold intensity (Mujika baseline)
 *    7–4 days out: -40% volume, hold intensity (deeper unload)
 *    3–1 days out: -60% volume, drop top-end CNS work
 *           day 0: rest or activation only
 *
 * B-priority events get half the dose (a "mini-taper" — 7 day window,
 * -20% volume). C-priority events don't trigger taper.
 */

export type TaperPhase =
  | "none"
  | "approach" // 14-8 days out
  | "deep" // 7-4 days out
  | "polish" // 3-1 days out
  | "event_day";

export type TaperRecommendation = {
  phase: TaperPhase;
  daysOut: number;
  volumeScale: number; // 1.0 = normal, 0.4 = -60%
  intensityAction: "hold" | "hold_then_taper" | "minimal";
  headline: string;
  detail: string;
  eventName: string;
};

/**
 * Returns the taper recommendation for the next A or B event from now.
 * Returns null when:
 *   - no upcoming priority event
 *   - next priority event is C (no taper)
 *   - event is > 14 days out
 */
export function computeTaperRecommendation(
  event: { name: string; date: string; priority: "A" | "B" | "C" } | null,
  now: Date = new Date(),
): TaperRecommendation | null {
  if (!event) return null;
  if (event.priority === "C") return null;

  const today = startOfDay(now);
  const eventDay = startOfDay(new Date(event.date + "T00:00:00"));
  const daysOut = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);

  // Event already past.
  if (daysOut < 0) return null;

  // Outside the window.
  const maxWindow = event.priority === "B" ? 7 : 14;
  if (daysOut > maxWindow) return null;

  return phaseFor(event, daysOut);
}

function phaseFor(
  event: { name: string; priority: "A" | "B" | "C" },
  daysOut: number,
): TaperRecommendation {
  const isB = event.priority === "B";
  // B events get half the volume cut at every phase.
  const adjust = (scale: number) => (isB ? 1.0 - (1.0 - scale) * 0.5 : scale);

  if (daysOut === 0) {
    return {
      phase: "event_day",
      daysOut: 0,
      volumeScale: 0,
      intensityAction: "minimal",
      headline: `${event.name} is today`,
      detail: "Rest or 5–10 minutes of activation. Save it for the event.",
      eventName: event.name,
    };
  }
  if (daysOut <= 3) {
    return {
      phase: "polish",
      daysOut,
      volumeScale: adjust(0.4),
      intensityAction: "minimal",
      headline: `${daysOut}d out — polish only`,
      detail: "Volume down 60%, drop max effort work. Short, sharp, fresh.",
      eventName: event.name,
    };
  }
  if (daysOut <= 7) {
    return {
      phase: "deep",
      daysOut,
      volumeScale: adjust(0.6),
      intensityAction: "hold",
      headline: `${daysOut}d out — deeper unload`,
      detail: "Volume down 40%, intensity held. Movement quality > load.",
      eventName: event.name,
    };
  }
  return {
    phase: "approach",
    daysOut,
    volumeScale: adjust(0.8),
    intensityAction: "hold",
    headline: `${daysOut}d out — start tapering`,
    detail: "Volume down 20%, intensity held. Cut the optional/extra work.",
    eventName: event.name,
  };
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
