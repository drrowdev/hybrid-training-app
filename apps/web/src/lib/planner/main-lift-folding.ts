/**
 * ADR 0005 — frequency-aware dual-main-lift folding.
 *
 * Post-trim transformation: when `daysForFrequency` returns a strength-day
 * count below 4 and one or more of the four canonical patterns
 * (squat / deadlift / horizontal_press / vertical_press) is uncovered,
 * fold the missing pattern(s) onto existing strength days using ADR 0004's
 * ergonomic pairing (squat ↔ vertical_press, deadlift ↔ horizontal_press —
 * same J-cup height on a power rack, so the pair can be supersetted or
 * alternated without re-racking).
 *
 * Pure function. Returns a new array; only the strength days that get a
 * fold attached are cloned. Skip-if-already-present guard: any strength
 * day that already has `secondaryRole` set (e.g. ENDURANCE_ANCHOR's static
 * ADR 0004 templates) is left untouched.
 */
import {
  STRENGTH_ROLE_CANDIDATES,
  type Archetype,
  type DayTemplate,
  type StrengthDay,
  type StrengthRole,
  daySlotKey,
} from "./archetypes";

const CANONICAL_PATTERNS: readonly StrengthRole[] = [
  "squat",
  "deadlift",
  "horizontal_press",
  "vertical_press",
] as const;

const ERGONOMIC_PARTNER: Record<StrengthRole, StrengthRole> = {
  squat: "vertical_press",
  vertical_press: "squat",
  deadlift: "horizontal_press",
  horizontal_press: "deadlift",
};

// Friendly labels used to build folded titles like "Squat + Overhead Press".
// Intentionally separate from the wordier STRENGTH_ROLE_LABELS map, which is
// tuned for Settings-page descriptors.
const FOLDED_TITLE_LABEL: Record<StrengthRole, string> = {
  squat: "Squat",
  deadlift: "Deadlift",
  horizontal_press: "Bench Press",
  vertical_press: "Overhead Press",
};

const DEFAULT_FOLDED_SECONDARY_MAX_SETS = 3;

function isStrength(day: DayTemplate): day is StrengthDay {
  return day.kind === "strength";
}

export function foldDualMainLifts(
  archetype: Archetype,
  trimmedDays: DayTemplate[],
): DayTemplate[] {
  if (archetype.disableFolding === true) return trimmedDays;

  const strengthDays = trimmedDays.filter(isStrength);
  // Each AM/PM strength session counts as its own strength session for the
  // count — Decision 8. daySlotKey gives us a stable per-session bucket.
  const strengthSessionCount = new Set(strengthDays.map(daySlotKey)).size;
  if (strengthSessionCount >= 4) return trimmedDays;

  const present = new Set<StrengthRole>();
  for (const d of strengthDays) {
    present.add(d.role);
    if (d.secondaryRole) present.add(d.secondaryRole);
  }

  const missing = CANONICAL_PATTERNS.filter((p) => !present.has(p));
  if (missing.length === 0) return trimmedDays;

  const cap =
    archetype.foldedSecondaryMaxSets ?? DEFAULT_FOLDED_SECONDARY_MAX_SETS;

  // Build a mutable index of strength-day slots that are eligible to receive
  // a fold (skip-if-already-present guard: anything with `secondaryRole`
  // set, including ADR 0004's static ENDURANCE_ANCHOR templates, is opaque
  // to this step). Cloning happens lazily on first mutation per slot.
  type Slot = { index: number; day: StrengthDay; mutated: boolean };
  const slotBySlotKey = new Map<string, Slot>();
  for (let i = 0; i < trimmedDays.length; i++) {
    const d = trimmedDays[i]!;
    if (!isStrength(d)) continue;
    if (d.secondaryRole) continue;
    slotBySlotKey.set(daySlotKey(d), { index: i, day: d, mutated: false });
  }

  const result = trimmedDays.slice();

  const attach = (slot: Slot, pattern: StrengthRole) => {
    const clone: StrengthDay = { ...slot.day };
    clone.secondaryRole = pattern;
    clone.secondaryCandidateSlugs = STRENGTH_ROLE_CANDIDATES[pattern];
    clone.secondaryTitle = FOLDED_TITLE_LABEL[pattern];
    clone.secondaryMaxSets = cap;
    clone.title = `${FOLDED_TITLE_LABEL[clone.role]} + ${FOLDED_TITLE_LABEL[pattern]}`;
    result[slot.index] = clone;
    slot.day = clone;
    slot.mutated = true;
    // Mark this slot ineligible for any further fold this pass — one
    // secondary per strength day, per ADR 0004's session-length budget.
    slotBySlotKey.delete(daySlotKey(clone));
  };

  for (const pattern of missing) {
    const partner = ERGONOMIC_PARTNER[pattern];

    // First choice: attach to the day whose primary role is the ergonomic
    // partner of the missing pattern (squat↔OHP, deadlift↔bench).
    let target: Slot | undefined;
    for (const slot of slotBySlotKey.values()) {
      if (slot.day.role === partner) {
        target = slot;
        break;
      }
    }

    // Fallback: attach to any eligible strength day, deterministic order
    // by lowest dayIndex first (Decision 4). Honours ergonomic pairing
    // where possible; coverage where not.
    if (!target) {
      const ordered = Array.from(slotBySlotKey.values()).sort(
        (a, b) => a.day.dayIndex - b.day.dayIndex,
      );
      target = ordered[0];
    }

    if (!target) {
      console.warn(
        `[main-lift-folding] no slot available to fold missing pattern '${pattern}' for archetype '${archetype.id}' (strength session count = ${strengthSessionCount}, present roles = ${Array.from(present).join(",")})`,
      );
      continue;
    }

    attach(target, pattern);
    present.add(pattern);
  }

  return result;
}
