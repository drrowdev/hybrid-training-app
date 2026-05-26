/**
 * PR Z1 — `readDayPrefFromValue` + `writeDayPref` seed-merge tests.
 *
 * The DB-first read path uses `readDayPrefFromValue` to project the
 * server-loaded `profiles.wizard_day_pref` JSONB into the same shape
 * the wizard already consumes from localStorage. The write path
 * accepts a `seed` (the DB payload) so the merged result returned to
 * the caller is what should be written back to the server.
 *
 * Pure pull, no jsdom — passes an in-memory `Storage`-like.
 */
import { describe, it, expect } from "vitest";
import { readDayPrefFromValue, writeDayPref } from "../day-pref";

function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => {
      m.set(k, v);
    },
    removeItem: (k: string) => {
      m.delete(k);
    },
    _dump: () => Object.fromEntries(m),
  };
}

describe("readDayPrefFromValue", () => {
  it("returns the slot for the given archetype + session count", () => {
    const value = {
      byArchetype: {
        strength_anchor: {
          "4": { days: [0, 2, 4, 6], twoADay: false },
        },
      },
    };
    expect(readDayPrefFromValue(value, "strength_anchor", 4)).toEqual({
      days: [0, 2, 4, 6],
      twoADay: false,
    });
  });

  it("returns null on missing archetype, missing count, or null value", () => {
    expect(readDayPrefFromValue(null, "x", 4)).toBeNull();
    expect(
      readDayPrefFromValue({ byArchetype: {} }, "x", 4),
    ).toBeNull();
    expect(
      readDayPrefFromValue(
        { byArchetype: { x: { "5": { days: [0], twoADay: false } } } },
        "x",
        4,
      ),
    ).toBeNull();
  });
});

describe("writeDayPref with seed (DB-first merge)", () => {
  it("merges into the seed payload instead of clobbering it with stale localStorage", () => {
    const storage = memoryStorage();
    // localStorage on this device is stale (only has a 3-day pref);
    // the DB has the live 4-day pref from another device. After write
    // the merged result should keep the 4-day slot from the seed AND
    // add the new 5-day slot the user just saved.
    storage.setItem(
      "hta-day-pref-v2",
      JSON.stringify({
        byArchetype: { strength_anchor: { "3": { days: [0, 2, 4], twoADay: false } } },
      }),
    );
    const seed = {
      byArchetype: {
        strength_anchor: { "4": { days: [0, 2, 4, 6], twoADay: false } },
      },
    };
    const merged = writeDayPref(
      storage,
      "strength_anchor",
      5,
      { days: [0, 1, 3, 4, 6], twoADay: true },
      seed,
    );
    expect(merged.byArchetype.strength_anchor).toEqual({
      "4": { days: [0, 2, 4, 6], twoADay: false },
      "5": { days: [0, 1, 3, 4, 6], twoADay: true },
    });
    // localStorage is mirrored for fast-paint on the next visit.
    const persisted = JSON.parse(storage.getItem("hta-day-pref-v2")!);
    expect(persisted).toEqual(merged);
  });

  it("falls back to localStorage when no seed is provided", () => {
    const storage = memoryStorage();
    storage.setItem(
      "hta-day-pref-v2",
      JSON.stringify({
        byArchetype: { hybrid: { "3": { days: [0, 2, 4], twoADay: false } } },
      }),
    );
    const merged = writeDayPref(
      storage,
      "hybrid",
      4,
      { days: [1, 3, 4, 6], twoADay: false },
    );
    expect(merged.byArchetype.hybrid).toEqual({
      "3": { days: [0, 2, 4], twoADay: false },
      "4": { days: [1, 3, 4, 6], twoADay: false },
    });
  });
});
