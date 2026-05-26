/**
 * Per-archetype saved day-pattern persistence for the block wizard.
 *
 * Storage layout (`hta-day-pref-v2`):
 *
 *   {
 *     byArchetype: {
 *       [archetypeId]: {
 *         [sessionCount]: { days: number[]; twoADay: boolean }
 *       }
 *     }
 *   }
 *
 * Two-level keying — archetype × session-count — lets a user have a
 * different "4-day Strength" pattern (Mon/Wed/Fri/Sun) from their
 * "4-day Hybrid" pattern (Tue/Thu/Sat/Sun) without one stomping the
 * other. Session count is the post two-a-day-expansion session count so
 * that a 4d × singleADay pref doesn't accidentally apply to a 4d × twoADay
 * selection.
 *
 * Migration from v1: legacy single-value pref under `hta-day-pref-v1` is
 * lifted under the current archetype + session-count slot on first read,
 * then the v1 key is removed. Best-effort — storage exceptions never
 * block the wizard.
 *
 * Pure module — accepts a minimal `Storage`-like interface, so tests can
 * pass an in-memory fake without jsdom.
 */
import type { DayPref } from "./schedule";

export const DAY_PREF_KEY_V1 = "hta-day-pref-v1";
export const DAY_PREF_KEY_V2 = "hta-day-pref-v2";

export type StorageLike = {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
};

type V2Slot = { days: number[]; twoADay: boolean };
type V2Shape = {
  byArchetype: Record<string, Record<string, V2Slot>>;
};

function emptyV2(): V2Shape {
  return { byArchetype: {} };
}

function isV2Slot(value: unknown): value is V2Slot {
  if (!value || typeof value !== "object") return false;
  const v = value as { days?: unknown; twoADay?: unknown };
  if (!Array.isArray(v.days)) return false;
  if (!v.days.every((d): d is number => typeof d === "number")) return false;
  if (typeof v.twoADay !== "boolean") return false;
  return true;
}

function parseV2(raw: string | null): V2Shape {
  if (!raw) return emptyV2();
  try {
    const parsed = JSON.parse(raw) as { byArchetype?: unknown };
    if (!parsed || typeof parsed !== "object" || !parsed.byArchetype || typeof parsed.byArchetype !== "object") {
      return emptyV2();
    }
    const out: V2Shape = emptyV2();
    for (const [archetypeId, perCount] of Object.entries(parsed.byArchetype as Record<string, unknown>)) {
      if (!perCount || typeof perCount !== "object") continue;
      const cleaned: Record<string, V2Slot> = {};
      for (const [count, slot] of Object.entries(perCount as Record<string, unknown>)) {
        if (isV2Slot(slot)) cleaned[count] = { days: [...slot.days], twoADay: slot.twoADay };
      }
      if (Object.keys(cleaned).length > 0) out.byArchetype[archetypeId] = cleaned;
    }
    return out;
  } catch {
    return emptyV2();
  }
}

function parseV1Slot(raw: string | null): V2Slot | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { days?: unknown; twoADay?: unknown };
    if (isV2Slot(parsed)) return { days: [...parsed.days], twoADay: parsed.twoADay };
    return null;
  } catch {
    return null;
  }
}

/**
 * If a legacy v1 pref exists, lift it under the current
 * archetype + session-count slot (without overwriting an existing v2
 * entry there) and delete the v1 key. Best-effort — silent on errors.
 */
export function migrateV1IfNeeded(
  storage: StorageLike,
  currentArchetypeId: string,
  currentSessionCount: number,
): void {
  try {
    const v1raw = storage.getItem(DAY_PREF_KEY_V1);
    if (v1raw == null) return;
    const slot = parseV1Slot(v1raw);
    // Always remove v1 — even if malformed, it's no longer authoritative.
    try {
      storage.removeItem(DAY_PREF_KEY_V1);
    } catch {
      // ignore
    }
    if (!slot) return;
    const v2 = parseV2(storage.getItem(DAY_PREF_KEY_V2));
    const countKey = String(currentSessionCount);
    const existing = v2.byArchetype[currentArchetypeId]?.[countKey];
    if (existing) return; // don't clobber v2
    v2.byArchetype[currentArchetypeId] = {
      ...(v2.byArchetype[currentArchetypeId] ?? {}),
      [countKey]: slot,
    };
    storage.setItem(DAY_PREF_KEY_V2, JSON.stringify(v2));
  } catch {
    // Storage blocked / quota / etc — never block the wizard.
  }
}

/**
 * Parsed view of a v2 day-pref payload, used by the DB-first read path
 * (the `profiles.wizard_day_pref` JSONB column has the same shape).
 */
export type WizardDayPrefValue = V2Shape;

/**
 * Read a day-pref slot from a server-supplied JSONB payload — used in
 * the wizard's hydration path. The profile column shares the same
 * shape as the v2 localStorage payload, so we can defer to the same
 * shape-checker.
 */
export function readDayPrefFromValue(
  value: WizardDayPrefValue | null | undefined,
  archetypeId: string,
  sessionCount: number,
): DayPref | null {
  if (!value || typeof value !== "object" || !value.byArchetype) return null;
  const slot = value.byArchetype[archetypeId]?.[String(sessionCount)];
  if (!slot || !isV2Slot(slot)) return null;
  return { days: [...slot.days], twoADay: slot.twoADay };
}

/** Look up a saved day-pref for the given archetype + session-count. */
export function readDayPref(
  storage: StorageLike,
  archetypeId: string,
  sessionCount: number,
): DayPref | null {
  try {
    const v2 = parseV2(storage.getItem(DAY_PREF_KEY_V2));
    const slot = v2.byArchetype[archetypeId]?.[String(sessionCount)];
    return slot ? { days: [...slot.days], twoADay: slot.twoADay } : null;
  } catch {
    return null;
  }
}

/**
 * Persist the current day-pref under archetype + session-count. Other
 * archetype/session-count entries are preserved. Returns the merged
 * payload that was written so the caller can forward it to the server
 * action (`updateWizardDayPref`) without re-parsing storage.
 */
export function writeDayPref(
  storage: StorageLike,
  archetypeId: string,
  sessionCount: number,
  pref: DayPref,
  /**
   * Pre-existing payload from `profiles.wizard_day_pref` — when
   * provided, the merge starts from that snapshot so the DB value
   * wins on first write from a previously-empty device. Falls back
   * to whatever localStorage has when omitted.
   */
  seed?: WizardDayPrefValue | null,
): WizardDayPrefValue {
  const base: V2Shape = seed
    ? {
        byArchetype: Object.fromEntries(
          Object.entries(seed.byArchetype ?? {}).map(([k, v]) => [
            k,
            { ...v },
          ]),
        ),
      }
    : parseV2(storage.getItem(DAY_PREF_KEY_V2));
  const countKey = String(sessionCount);
  base.byArchetype[archetypeId] = {
    ...(base.byArchetype[archetypeId] ?? {}),
    [countKey]: { days: [...pref.days], twoADay: pref.twoADay },
  };
  try {
    storage.setItem(DAY_PREF_KEY_V2, JSON.stringify(base));
  } catch {
    // localStorage blocked — fine, the DB column is canonical.
  }
  return base;
}
