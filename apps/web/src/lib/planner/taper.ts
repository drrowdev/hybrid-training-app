/**
 * Taper rules (Phase 2 + new §6) — modality-aware (ADR 0008).
 *
 * Pure logic: given the next A/B-priority event and a calendar date,
 * return the taper recommendation (volume cut + intensity action). The
 * peaking shape now branches on the event's modality, because being
 * "fresh for a marathon" and "peaked for a 1RM" are opposite physiological
 * problems (ADR 0008):
 *
 *   ENDURANCE (Mujika & Padilla 2003 / Bosquet 2007 — HIGH) — unchanged:
 *     14–8 d out: -20% volume, hold intensity (Mujika baseline)
 *      7–4 d out: -40% volume, hold intensity (deeper unload)
 *      3–1 d out: -60% volume, DROP top-end work (polish, minimal)
 *           day 0: rest / activation only
 *
 *   STRENGTH (Pritchard 2015 / Travis 2020 — MODERATE) — heuristic:
 *     shorter 10-day window; HOLD heavy intensity to ~3 d out; volume cut
 *     graded -30% / -45% / -50% (never the endurance 60%); the final phase
 *     keeps heavy low-volume singles (openers) instead of dropping max
 *     effort. Day 0 = openers / activation primer, not a runner's rest.
 *
 *   MIXED (hybrid race / "test both") — heuristic: the endurance volume
 *     curve (the aerobic side must shed fatigue) but intensity is HELD into
 *     the final days so one heavy strength primer survives.
 *
 * B-priority events get half the volume cut (a "mini-taper") and a tighter
 * 7-day window in every modality. C-priority events don't trigger taper.
 */

export type TaperPhase =
  | "none"
  | "approach" // 14-8 days out
  | "deep" // 7-4 days out
  | "polish" // 3-1 days out
  | "event_day";

/** ADR 0008 — peaking physiology category, distinct from the event-UI sport vocab. */
export type TaperModality = "endurance" | "strength" | "mixed";

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
 * Map the free-text event-UI modality (`run | bike | swim | row | ski |
 * strength | padel | other`) to a peaking category. Only `strength` maps to
 * the strength peak; everything else (including null / unknown) defaults to
 * `endurance` — preserving the pre-ADR-0008 behaviour for every existing row.
 */
export function taperModalityForEvent(
  modality: string | null | undefined,
): TaperModality {
  return modality === "strength" ? "strength" : "endurance";
}

/**
 * Returns the taper recommendation for the next A or B event from now.
 * Returns null when:
 *   - no upcoming priority event
 *   - next priority event is C (no taper)
 *   - event is outside the modality's taper window
 */
export function computeTaperRecommendation(
  event: {
    name: string;
    date: string;
    priority: "A" | "B" | "C";
    modality?: TaperModality;
  } | null,
  now: Date = new Date(),
): TaperRecommendation | null {
  if (!event) return null;
  if (event.priority === "C") return null;

  const modality = event.modality ?? "endurance";
  const today = startOfDay(now);
  const eventDay = startOfDay(new Date(event.date + "T00:00:00"));
  const daysOut = Math.round((eventDay.getTime() - today.getTime()) / 86_400_000);

  // Event already past.
  if (daysOut < 0) return null;

  // Outside the window. Strength peaks faster, so its A-window is shorter.
  const maxWindow =
    event.priority === "B" ? 7 : modality === "strength" ? 10 : 14;
  if (daysOut > maxWindow) return null;

  if (modality === "strength") return strengthPhase(event, daysOut);
  if (modality === "mixed") return mixedPhase(event, daysOut);
  return endurancePhase(event, daysOut);
}

/** Endurance taper — the original, well-cited curve. Unchanged (ADR 0008 D2). */
function endurancePhase(
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

/**
 * Strength peak (ADR 0008 D3) — heuristic, per Pritchard 2015 (MODERATE) /
 * Travis 2020 (MODERATE-LOW). Shorter window, intensity HELD throughout
 * (including the final phase — heavy low-volume singles, NOT a drop to
 * minimal), volume graded -30% / -45% / -50%. Day 0 is an opener/activation
 * primer, not a runner's full rest.
 */
function strengthPhase(
  event: { name: string; priority: "A" | "B" | "C" },
  daysOut: number,
): TaperRecommendation {
  const isB = event.priority === "B";
  const adjust = (scale: number) => (isB ? 1.0 - (1.0 - scale) * 0.5 : scale);

  if (daysOut === 0) {
    return {
      phase: "event_day",
      daysOut: 0,
      volumeScale: 0,
      // Hold, not minimal: the day-0 ritual is openers + activation, not rest.
      intensityAction: "hold",
      headline: `${event.name} is today`,
      detail: "Openers and activation only — the heavy work is banked. Trust the peak.",
      eventName: event.name,
    };
  }
  if (daysOut <= 3) {
    return {
      phase: "polish",
      daysOut,
      volumeScale: adjust(0.5),
      // Key fix vs endurance: HOLD heavy intensity instead of dropping it.
      intensityAction: "hold",
      headline: `${daysOut}d out — sharpen`,
      detail: "Volume down ~50%, intensity held. Heavy low-volume singles (openers), not failure.",
      eventName: event.name,
    };
  }
  if (daysOut <= 7) {
    return {
      phase: "deep",
      daysOut,
      volumeScale: adjust(0.55),
      intensityAction: "hold",
      headline: `${daysOut}d out — unload, stay sharp`,
      detail: "Volume down ~45%, intensity held. Keep bar speed crisp on the main lifts.",
      eventName: event.name,
    };
  }
  return {
    phase: "approach",
    daysOut,
    volumeScale: adjust(0.7),
    intensityAction: "hold",
    headline: `${daysOut}d out — begin the peak`,
    detail: "Volume down ~30%, intensity held. Trim assistance, keep the main lifts heavy.",
    eventName: event.name,
  };
}

/**
 * Mixed-event peak (ADR 0008 D4) — heuristic. Endurance volume curve so the
 * aerobic side sheds fatigue, but intensity is HELD into the final days so one
 * heavy strength primer survives (neither pure model fits a hybrid race).
 */
function mixedPhase(
  event: { name: string; priority: "A" | "B" | "C" },
  daysOut: number,
): TaperRecommendation {
  const isB = event.priority === "B";
  const adjust = (scale: number) => (isB ? 1.0 - (1.0 - scale) * 0.5 : scale);

  if (daysOut === 0) {
    return {
      phase: "event_day",
      daysOut: 0,
      volumeScale: 0,
      intensityAction: "minimal",
      headline: `${event.name} is today`,
      detail: "Rest or light activation. Save both engines for the event.",
      eventName: event.name,
    };
  }
  if (daysOut <= 3) {
    return {
      phase: "polish",
      daysOut,
      volumeScale: adjust(0.4),
      // Endurance-depth volume cut, but hold a heavy primer (don't go minimal).
      intensityAction: "hold",
      headline: `${daysOut}d out — sharpen both`,
      detail: "Volume down 60%, but keep one heavy strength primer. Stay sharp on both systems.",
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
      detail: "Volume down 40%, intensity held on both the cardio and strength primers.",
      eventName: event.name,
    };
  }
  return {
    phase: "approach",
    daysOut,
    volumeScale: adjust(0.8),
    intensityAction: "hold",
    headline: `${daysOut}d out — start tapering`,
    detail: "Volume down 20%, intensity held. Cut the optional/extra work on both sides.",
    eventName: event.name,
  };
}

function startOfDay(d: Date): Date {
  const out = new Date(d);
  out.setHours(0, 0, 0, 0);
  return out;
}
