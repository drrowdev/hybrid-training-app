/**
 * Per-archetype saved day-pattern persistence tests.
 *
 * Covers the v2 storage layout (archetype × session-count), the v1 → v2
 * migration on first read, and the two-a-day-mismatch guard in
 * applySavedPrefIfPossible.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  DAY_PREF_KEY_V1,
  DAY_PREF_KEY_V2,
  migrateV1IfNeeded,
  readDayPref,
  writeDayPref,
  type StorageLike,
} from "../../../../lib/planner/wizard/day-pref";
import {
  applySavedPrefIfPossible,
  type ScheduleCell,
  type SessionShape,
} from "../../../../lib/planner/wizard/schedule";

function memStorage(): StorageLike & { dump: () => Record<string, string> } {
  const map = new Map<string, string>();
  return {
    getItem: (k) => (map.has(k) ? map.get(k)! : null),
    setItem: (k, v) => {
      map.set(k, v);
    },
    removeItem: (k) => {
      map.delete(k);
    },
    dump: () => Object.fromEntries(map),
  };
}

function makeSession(title: string): SessionShape {
  return { icon: "🏋️", title, meta: "", weightKey: "Strength day (moderate)", durationMin: 45 };
}

function cellsOn(days: number[], twoADay = false): ScheduleCell[] {
  return Array.from({ length: 7 }, (_, day) => {
    const filled = days.includes(day);
    return {
      day,
      am: filled ? makeSession(`s${day}`) : null,
      pm: filled && twoADay ? makeSession(`s${day}-pm`) : null,
    };
  });
}

function filledDays(cells: ScheduleCell[]): number[] {
  return cells.filter((c) => c.am || c.pm).map((c) => c.day);
}

describe("per-archetype saved day pref (v2)", () => {
  let storage: ReturnType<typeof memStorage>;

  beforeEach(() => {
    storage = memStorage();
  });

  it("save Strength 4d pref, switch to Hybrid 4d → no pref applied", () => {
    writeDayPref(storage, "strength_anchor", 4, { days: [0, 2, 4, 6], twoADay: false });

    // Switching to Hybrid 4d — different archetype, same session-count slot
    // must be empty.
    const hybridPref = readDayPref(storage, "concurrent_hybrid", 4);
    expect(hybridPref).toBeNull();

    const cells = cellsOn([1, 3, 5, 6]); // default Hybrid placement
    const used = applySavedPrefIfPossible(cells, hybridPref, false);
    expect(used).toBe(false);
    expect(filledDays(cells)).toEqual([1, 3, 5, 6]);
  });

  it("save Strength 4d, save Hybrid 5d, then read back → both isolated", () => {
    writeDayPref(storage, "strength_anchor", 4, { days: [0, 2, 4, 6], twoADay: false });
    writeDayPref(storage, "concurrent_hybrid", 5, { days: [1, 2, 3, 5, 6], twoADay: false });

    const strength = readDayPref(storage, "strength_anchor", 4);
    expect(strength).toEqual({ days: [0, 2, 4, 6], twoADay: false });

    const hybrid = readDayPref(storage, "concurrent_hybrid", 5);
    expect(hybrid).toEqual({ days: [1, 2, 3, 5, 6], twoADay: false });

    // Strength still applies when we come back to it.
    const cells = cellsOn([0, 1, 2, 3]); // default Strength placement
    const used = applySavedPrefIfPossible(cells, strength, false);
    expect(used).toBe(true);
    expect(filledDays(cells)).toEqual([0, 2, 4, 6]);
  });

  it("migration: v1 pref is lifted under current archetype + session-count and v1 removed", () => {
    storage.setItem(
      DAY_PREF_KEY_V1,
      JSON.stringify({ days: [0, 2, 4, 6], twoADay: false }),
    );

    migrateV1IfNeeded(storage, "strength_anchor", 4);

    // v1 key removed
    expect(storage.getItem(DAY_PREF_KEY_V1)).toBeNull();

    // v2 has the lifted entry under current archetype × session-count
    const lifted = readDayPref(storage, "strength_anchor", 4);
    expect(lifted).toEqual({ days: [0, 2, 4, 6], twoADay: false });

    // Other archetypes / counts are still empty
    expect(readDayPref(storage, "concurrent_hybrid", 4)).toBeNull();
    expect(readDayPref(storage, "strength_anchor", 5)).toBeNull();
  });

  it("migration: malformed v1 payload is removed without crashing", () => {
    storage.setItem(DAY_PREF_KEY_V1, "{not json");
    expect(() => migrateV1IfNeeded(storage, "strength_anchor", 4)).not.toThrow();
    expect(storage.getItem(DAY_PREF_KEY_V1)).toBeNull();
    expect(readDayPref(storage, "strength_anchor", 4)).toBeNull();
  });

  it("migration: never clobbers an existing v2 slot", () => {
    writeDayPref(storage, "strength_anchor", 4, { days: [1, 3, 5, 6], twoADay: false });
    storage.setItem(
      DAY_PREF_KEY_V1,
      JSON.stringify({ days: [0, 2, 4, 6], twoADay: false }),
    );

    migrateV1IfNeeded(storage, "strength_anchor", 4);

    expect(storage.getItem(DAY_PREF_KEY_V1)).toBeNull();
    // Existing v2 entry wins.
    expect(readDayPref(storage, "strength_anchor", 4)).toEqual({
      days: [1, 3, 5, 6],
      twoADay: false,
    });
  });

  it("two-a-day mismatch: saved 4d × singleADay does NOT apply to 4d × twoADay", () => {
    // Save 4d × singleADay → 4 sessions total
    writeDayPref(storage, "strength_anchor", 4, { days: [0, 2, 4, 6], twoADay: false });

    // Now the user picks 4d × twoADay, which produces 5 sessions
    // (e.g. one day has both AM+PM). The session-count key differs, so
    // the read returns null — different slot.
    const pref = readDayPref(storage, "strength_anchor", 5);
    expect(pref).toBeNull();

    // Belt-and-suspenders: even if we forced the singleADay pref into
    // applySavedPrefIfPossible against a twoADay schedule, the twoADay
    // mismatch guard in apply() must reject it.
    const forced = readDayPref(storage, "strength_anchor", 4);
    const cells = cellsOn([1, 3, 5, 6], /* twoADay= */ true);
    const used = applySavedPrefIfPossible(cells, forced, /* twoADay= */ true);
    expect(used).toBe(false);
    expect(filledDays(cells)).toEqual([1, 3, 5, 6]);
  });

  it("writeDayPref preserves entries for other archetypes", () => {
    writeDayPref(storage, "strength_anchor", 4, { days: [0, 2, 4, 6], twoADay: false });
    writeDayPref(storage, "concurrent_hybrid", 4, { days: [1, 3, 5, 6], twoADay: false });
    writeDayPref(storage, "strength_anchor", 4, { days: [0, 1, 3, 5], twoADay: false });

    expect(readDayPref(storage, "strength_anchor", 4)).toEqual({
      days: [0, 1, 3, 5],
      twoADay: false,
    });
    expect(readDayPref(storage, "concurrent_hybrid", 4)).toEqual({
      days: [1, 3, 5, 6],
      twoADay: false,
    });
  });

  it("readDayPref tolerates a missing or malformed v2 blob", () => {
    expect(readDayPref(storage, "strength_anchor", 4)).toBeNull();
    storage.setItem(DAY_PREF_KEY_V2, "not json");
    expect(readDayPref(storage, "strength_anchor", 4)).toBeNull();
    storage.setItem(DAY_PREF_KEY_V2, JSON.stringify({ byArchetype: "nope" }));
    expect(readDayPref(storage, "strength_anchor", 4)).toBeNull();
  });
});
