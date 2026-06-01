/**
 * Step-5 schedule placement: pure functions that compute the default
 * Mon..Sun layout, classify session severity, and surface spacing warnings.
 *
 * Ported verbatim (semantically) from the approved mockup. Lives outside
 * React so it can be unit-tested in milliseconds and shared between the
 * wizard component, the server action, and any future tooling.
 *
 * Sequencing warnings only fire for **high-CNS** sessions back-to-back —
 * heavy lifts, VO2 intervals, tendon work. Hypertrophy + moderate
 * concurrent-style sessions are allowed adjacent because the recovery cost
 * is lower (DC-D4 covers the high-glycolytic side; moderate-intensity
 * placement is unrestricted by design).
 */
import type { ResolvedArchetype, Goal, Secondary } from "./wizard-mapping";

/** Names of session-shape "weight keys" used to compute STIMULUS + severity. */
export type WeightKey =
  | "Strength day (heavy)"
  | "Strength day (heavy + accessories)"
  | "Strength day (moderate)"
  | "Strength day (moderate + hypertrophy)"
  | "Hypertrophy day"
  | "Maintenance lift"
  | "Maintenance lift (with accessories)"
  | "Heavy maintenance lift"
  | "Capped lift"
  | "Tendon day"
  | "Easy Z2 (recovery)"
  | "Polarized Z2"
  | "VO2 intervals"
  | "Long Z2 + alactic finisher"
  | "Maintenance Z2";

export type SessionShape = {
  icon: string;
  title: string;
  meta: string;
  weightKey: WeightKey;
  durationMin: number;
};

export type ScheduleCell = {
  day: number; // 0..6 Mon..Sun
  am: SessionShape | null;
  pm: SessionShape | null;
};

export type SequencingWarning = {
  days: [number, number];
  text: string;
};

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Hard = any quality session (lift / cardio / tendon) — used to pair AM/PM. */
export function isHardSession(s: SessionShape | null | undefined): boolean {
  if (!s) return false;
  switch (s.weightKey) {
    case "Strength day (heavy)":
    case "Strength day (heavy + accessories)":
    case "Strength day (moderate)":
    case "Strength day (moderate + hypertrophy)":
    case "Hypertrophy day":
    case "Heavy maintenance lift":
    case "Maintenance lift (with accessories)":
    case "VO2 intervals":
    case "Long Z2 + alactic finisher":
    case "Capped lift":
    case "Tendon day":
      return true;
    default:
      return false;
  }
}

/**
 * Subset of "hard" — sessions whose CNS / aerobic-power cost is high enough
 * that back-to-back placement is a real recovery concern. Moderate lifts +
 * hypertrophy don't qualify (24h spacing is fine for most lifters).
 * Drives both the spacing pass and the user-visible warning. Cites DC-D4
 * for the back-to-back glycolytic case.
 */
export function isHighCNS(s: SessionShape | null | undefined): boolean {
  if (!s) return false;
  switch (s.weightKey) {
    case "Strength day (heavy)":
    case "Strength day (heavy + accessories)":
    case "Heavy maintenance lift":
    case "VO2 intervals":
    case "Long Z2 + alactic finisher":
    case "Tendon day":
      return true;
    default:
      return false;
  }
}

/**
 * Pick which days of the week to use for N training days. Spread evenly
 * when N < 7 so rest days fall between training days; picks chosen to
 * minimise consecutive high-CNS pairs.
 *
 * (Verbatim from the mockup — exposed for testing.)
 */
export function pickDayIndices(n: number): number[] {
  const presets: Record<number, number[]> = {
    1: [2], // Wed
    2: [0, 3], // Mon Thu
    3: [0, 2, 4], // Mon Wed Fri
    4: [0, 2, 4, 6], // Mon Wed Fri Sun
    5: [0, 1, 3, 5, 6], // Mon Tue Thu Sat Sun
    6: [0, 1, 2, 4, 5, 6], // Mon-Wed Fri-Sun (rest Thu)
    7: [0, 1, 2, 3, 4, 5, 6],
  };
  return presets[n] ?? [0, 1, 2, 3, 4, 5, 6].slice(0, n);
}

/**
 * Build the per-archetype week-shape (the actual sessions for the week)
 * — what the sidebar lists and what the schedule grid places.
 *
 * Ported verbatim from `buildWeekShape()` in the mockup.
 */
export function buildWeekShape(
  a: ResolvedArchetype,
  context: { goal: Goal | null; secondary: Secondary | null },
): SessionShape[] {
  const out: SessionShape[] = [];
  const push = (
    icon: string,
    title: string,
    meta: string,
    weightKey: WeightKey,
    durationMin: number,
  ): void => {
    out.push({ icon, title, meta, weightKey, durationMin });
  };

  if (a.id === "strength_anchor") {
    const tilt = a.accessoryEmphasis === "hypertrophy";
    const heavyMeta = tilt
      ? "top set ≤ 95% TM · 3 working sets + hypertrophy accessories"
      : "top set ≤ 95% TM · 3 working sets";
    for (let i = 0; i < a.sessions.strength; i++)
      push("🏋️", "Strength day", heavyMeta, "Strength day (heavy)", tilt ? 60 : 55);
    // A muscle secondary tilts accessory volume onto the strength days above —
    // it never produces standalone hypertrophy days (sessions.hypertrophy is 0
    // for strength_anchor). This loop is retained defensively only.
    for (let i = 0; i < a.sessions.hypertrophy; i++)
      push(
        "🏋️",
        "Hypertrophy day",
        "moderate weight · 4–5 sets · accessory pool",
        "Hypertrophy day",
        60,
      );
    const c = a.sessions.cardio;
    if (c >= 1) push("🚴", "Easy Z2", "recovery between strength days", "Easy Z2 (recovery)", 45);
    if (c >= 2)
      push(
        "🏃",
        "Long Z2 + alactic finisher",
        "aerobic base · 6–10 × 10–15s near-max",
        "Long Z2 + alactic finisher",
        75,
      );
    for (let i = 2; i < c; i++) push("🚴", "Easy Z2", "aerobic floor", "Easy Z2 (recovery)", 45);
  } else if (a.id === "hypertrophy_anchor") {
    for (let i = 0; i < a.sessions.hypertrophy; i++)
      push(
        "🏋️",
        "Hypertrophy day",
        "60–75% TM · 4 sets · accessory pool",
        "Hypertrophy day",
        70,
      );
    for (let i = 0; i < a.sessions.strength; i++)
      push(
        "🏋️",
        "Strength day",
        "top set ≥ 85% TM · 3 working sets",
        "Strength day (heavy)",
        55,
      );
    for (let i = 0; i < a.sessions.cardio; i++)
      push("🚴", "Easy Z2", "aerobic floor only", "Easy Z2 (recovery)", 40);
  } else if (a.id === "concurrent_hybrid") {
    const isHypertrophyBias = context.goal === "muscle" || context.secondary === "muscle";
    const key: WeightKey = isHypertrophyBias
      ? "Strength day (moderate + hypertrophy)"
      : "Strength day (moderate)";
    const meta = isHypertrophyBias
      ? "top set ≤ 85% TM + accessory pool"
      : "top set ≤ 85% TM · cardio-safe";
    const title = context.goal === "muscle" ? "Hypertrophy day" : "Strength day";
    const liftCount = context.goal === "muscle" ? a.sessions.hypertrophy : a.sessions.strength;
    for (let i = 0; i < liftCount; i++) push("🏋️", title, meta, key, 55);
    const c = a.sessions.cardio;
    if (c >= 1) push("🚴", "Polarized Z2", "aerobic base · conversational pace", "Polarized Z2", 60);
    if (c >= 2)
      push("🏃", "VO2 intervals", "4 × 4 min @ 90–95% HRmax", "VO2 intervals", 45);
    for (let i = 2; i < c; i++) push("🚴", "Easy Z2", "aerobic base", "Easy Z2 (recovery)", 45);
  } else if (a.id === "endurance_anchor") {
    const isStrengthBias = context.secondary === "strength";
    const isMuscleBias = context.secondary === "muscle";
    const key: WeightKey = isStrengthBias
      ? "Heavy maintenance lift"
      : isMuscleBias
        ? "Maintenance lift (with accessories)"
        : "Maintenance lift";
    const meta = isStrengthBias
      ? "heavy singles/triples ≥ 90% TM"
      : isMuscleBias
        ? "≥85% TM + accessory work"
        : "heavy singles/triples ≥ 85% TM";
    const dur = isMuscleBias ? 50 : 40;
    for (let i = 0; i < a.sessions.strength; i++)
      push("🏋️", "Maintenance lift", meta, key, dur);
    const c = a.sessions.cardio;
    if (c >= 1) push("🏃", "Long Z2", "aerobic base · conversational", "Polarized Z2", 75);
    if (c >= 2)
      push("🏃", "VO2 intervals", "4 × 4 min @ 90–95% HRmax", "VO2 intervals", 45);
    if (c >= 3)
      push("🚴", "Easy Z2", "aerobic base · cross-modality", "Easy Z2 (recovery)", 60);
    for (let i = 3; i < c; i++) push("🚴", "Easy Z2", "aerobic base", "Easy Z2 (recovery)", 45);
  } else if (a.id === "maintenance") {
    for (let i = 0; i < a.sessions.strength; i++)
      push("🏋️", "Maintenance lift", "65–70% TM · 3 sets", "Maintenance lift", 35);
    for (let i = 0; i < a.sessions.cardio; i++)
      push("🚴", "Easy Z2", "maintenance dose", "Maintenance Z2", 25);
  } else if (a.id === "rebuild") {
    for (let i = 0; i < a.sessions.strength; i++)
      push("🏋️", "Capped lift", "top set ≤ 80% TM", "Capped lift", 40);
    for (let i = 0; i < a.sessions.tendon; i++)
      push("🦴", "Tendon day", "HSR + heavy isometric holds", "Tendon day", 30);
  }

  return out;
}

/**
 * Default 7-cell calendar (Mon..Sun) — places sessions and tries to space
 * hard sessions so they don't fall on consecutive days.
 */
export function defaultSchedule(
  a: ResolvedArchetype,
  context: { goal: Goal | null; secondary: Secondary | null; twoADay: boolean },
): ScheduleCell[] {
  const sessions = buildWeekShape(a, context);
  const cells: ScheduleCell[] = Array.from({ length: 7 }, (_, day) => ({ day, am: null, pm: null }));
  if (sessions.length === 0) return cells;

  if (context.twoADay) {
    // Pair sessions 2-by-2 onto the first ceil(total/2) days. Hard + light when possible.
    const hards = sessions.filter(isHardSession);
    const lights = sessions.filter((s) => !isHardSession(s));
    const paired: { am: SessionShape | null; pm: SessionShape | null }[] = [];
    let h = 0;
    let l = 0;
    while (h < hards.length || l < lights.length) {
      const am: SessionShape | null =
        h < hards.length ? hards[h++]! : l < lights.length ? lights[l++]! : null;
      const pm: SessionShape | null =
        l < lights.length ? lights[l++]! : h < hards.length ? hards[h++]! : null;
      paired.push({ am, pm });
    }
    const dayIndices = pickDayIndices(paired.length);
    paired.forEach((p, i) => {
      const cell = cells[dayIndices[i]];
      if (!cell) return;
      cell.am = p.am;
      cell.pm = p.pm;
    });
    return cells;
  }

  // Single-a-day: spread high-CNS across the week, fill with moderate work between.
  const highs = sessions.filter(isHighCNS);
  const others = sessions.filter((s) => !isHighCNS(s));
  const ordered: SessionShape[] = [];
  let hi = 0;
  let oi = 0;
  let lastWasHigh = false;
  while (hi < highs.length || oi < others.length) {
    if (lastWasHigh && oi < others.length) {
      ordered.push(others[oi++]!);
      lastWasHigh = false;
    } else if (hi < highs.length) {
      ordered.push(highs[hi++]!);
      lastWasHigh = true;
    } else {
      ordered.push(others[oi++]!);
      lastWasHigh = false;
    }
  }
  const dayIndices = pickDayIndices(ordered.length);
  ordered.forEach((s, i) => {
    const cell = cells[dayIndices[i]];
    if (cell) cell.am = s;
  });
  reduceHighAdjacencies(cells);
  return cells;
}

/**
 * Post-placement spacer (DC-D4 indirect): scan for any adjacent-day
 * high-CNS pairs and try to swap one of the two with a nearby non-high
 * session if the swap removes an adjacency without creating a new one.
 * Cheap heuristic — up to 3 passes.
 */
export function reduceHighAdjacencies(cells: ScheduleCell[]): void {
  const cellHigh = (i: number): boolean =>
    i >= 0 && i < 7 && (isHighCNS(cells[i]!.am) || isHighCNS(cells[i]!.pm));
  const occupied = (i: number): boolean =>
    i >= 0 && i < 7 && (cells[i]!.am !== null || cells[i]!.pm !== null);
  const countAdj = (): number => {
    let n = 0;
    for (let d = 0; d < 6; d++) {
      if (cellHigh(d) && cellHigh(d + 1)) n++;
    }
    return n;
  };
  const swap = (a: number, b: number): void => {
    const ca = cells[a]!;
    const cb = cells[b]!;
    const tmpAm = ca.am;
    const tmpPm = ca.pm;
    ca.am = cb.am;
    ca.pm = cb.pm;
    cb.am = tmpAm;
    cb.pm = tmpPm;
  };
  for (let pass = 0; pass < 3; pass++) {
    const before = countAdj();
    if (before === 0) return;
    let didSwap = false;
    for (let d = 0; d < 6 && !didSwap; d++) {
      if (!(cellHigh(d) && cellHigh(d + 1))) continue;
      for (const moveIdx of [d, d + 1]) {
        for (let s = 0; s < 7; s++) {
          if (s === d || s === d + 1) continue;
          if (!occupied(s) || cellHigh(s)) continue;
          swap(moveIdx, s);
          if (countAdj() < before) {
            didSwap = true;
            break;
          }
          swap(moveIdx, s); // revert
        }
        if (didSwap) break;
      }
    }
    if (!didSwap) return;
  }
}

/**
 * Surface adjacent-day high-CNS pairs as warnings (override-and-warn, DC-K4).
 * Hypertrophy + moderate-strength adjacencies are deliberately NOT flagged —
 * those don't trigger meaningful recovery debt for most lifters.
 */
export function sequencingWarnings(cells: ScheduleCell[]): SequencingWarning[] {
  const warnings: SequencingWarning[] = [];
  const sorted = cells
    .filter((c) => c.am || c.pm)
    .slice()
    .sort((a, b) => a.day - b.day);
  for (let i = 0; i < sorted.length - 1; i++) {
    const today = sorted[i]!;
    const tomorrow = sorted[i + 1]!;
    if (tomorrow.day - today.day !== 1) continue;
    const todayHigh = isHighCNS(today.am) || isHighCNS(today.pm);
    const tomorrowHigh = isHighCNS(tomorrow.am) || isHighCNS(tomorrow.pm);
    if (todayHigh && tomorrowHigh) {
      warnings.push({
        days: [today.day, tomorrow.day],
        text: `High-CNS sessions on ${DAY_NAMES[today.day]} and ${DAY_NAMES[tomorrow.day]} back-to-back. Heavy lifts, VO2 intervals and tendon work recover best with at least a day between. Tap to swap one.`,
      });
    }
  }
  return warnings;
}

/** Day-of-week labels in the wizard's canonical Mon..Sun order. */
export const DAY_LABELS = DAY_NAMES;

/**
 * localStorage hint shape — kept in sync with the mockup. The wizard reads
 * this as a hint when first rendering step 5; the DB column is the canonical
 * source after Start.
 */
export type DayPref = { days: number[]; twoADay: boolean };

/** Re-derive a schedule signature for cache invalidation when wizard state changes. */
export function scheduleSignature(
  a: ResolvedArchetype,
  context: { twoADay: boolean; power: boolean; secondary: Secondary | null; sessionCount: number },
): string {
  return [
    a.id,
    context.sessionCount,
    context.twoADay ? "2x" : "1x",
    context.power ? "pow" : "",
    context.secondary ?? "",
  ].join("|");
}

/**
 * Try to apply a saved day-preference to a fresh default schedule. Returns
 * true iff the pref was compatible (same twoADay and same number of filled
 * days) — in that case `cells` is mutated to use the saved day indices.
 */
export function applySavedPrefIfPossible(
  cells: ScheduleCell[],
  pref: DayPref | null,
  twoADay: boolean,
): boolean {
  if (!pref) return false;
  if (pref.twoADay !== twoADay) return false;
  const filled = cells.filter((c) => c.am || c.pm).length;
  if (pref.days.length !== filled) return false;
  const inOrder = cells
    .filter((c) => c.am || c.pm)
    .map((c) => ({ am: c.am, pm: c.pm }));
  cells.forEach((c) => {
    c.am = null;
    c.pm = null;
  });
  pref.days.forEach((dayIdx, i) => {
    const target = cells[dayIdx];
    const src = inOrder[i];
    if (!target || !src) return;
    target.am = src.am;
    target.pm = src.pm;
  });
  return true;
}
