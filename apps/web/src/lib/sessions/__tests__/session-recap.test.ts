/**
 * buildSessionRecap — grouping a session's logged sets for display.
 *
 * The behaviour under test that matters most: a recap must never merge sets the
 * lifter did not actually repeat, because the pairing of load and reps is the
 * thing they opened the drawer to read.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { buildSessionRecap, type RecapSetRow } from "../session-recap";

let idx = 0;
function set(over: Partial<RecapSetRow> = {}): RecapSetRow {
  return {
    movement_id: "mv-squat",
    movement_name: "Squat",
    set_index: idx++,
    weight_kg: 100,
    reps: 5,
    duration_sec: null,
    distance_m: null,
    set_kind: "main",
    skipped: false,
    skip_reason: null,
    ...over,
  };
}

describe("buildSessionRecap", () => {
  beforeEach(() => {
    idx = 0;
  });

  it("returns nothing for a session with no logged sets", () => {
    expect(buildSessionRecap([])).toEqual([]);
    expect(buildSessionRecap(null)).toEqual([]);
  });

  it("collapses genuinely identical sets into one entry", () => {
    const [movement] = buildSessionRecap([set(), set(), set()]);
    expect(movement.name).toBe("Squat");
    expect(movement.groups[0].entries).toEqual([
      { sets: 3, measure: { type: "reps", reps: 5 }, weightKg: 100 },
    ]);
  });

  it("keeps sets apart when the load changed", () => {
    const [movement] = buildSessionRecap([
      set({ weight_kg: 100, reps: 5 }),
      set({ weight_kg: 110, reps: 3 }),
    ]);
    expect(movement.groups[0].entries).toEqual([
      { sets: 1, measure: { type: "reps", reps: 5 }, weightKg: 100 },
      { sets: 1, measure: { type: "reps", reps: 3 }, weightKg: 110 },
    ]);
  });

  it("keeps sets apart when only the reps changed", () => {
    const [movement] = buildSessionRecap([set({ reps: 5 }), set({ reps: 3 })]);
    expect(movement.groups[0].entries.map((e) => e.measure)).toEqual([
      { type: "reps", reps: 5 },
      { type: "reps", reps: 3 },
    ]);
  });

  it("does not merge across a gap, so the order of the session survives", () => {
    const [movement] = buildSessionRecap([
      set({ weight_kg: 100 }),
      set({ weight_kg: 110, reps: 3 }),
      set({ weight_kg: 100 }),
    ]);
    expect(movement.groups[0].entries.map((e) => [e.sets, e.weightKg])).toEqual([
      [1, 100],
      [1, 110],
      [1, 100],
    ]);
  });

  it("reads numerics that arrive as strings", () => {
    const [movement] = buildSessionRecap([set({ weight_kg: "102.50" })]);
    expect(movement.groups[0].entries[0].weightKg).toBe(102.5);
  });

  it("treats an unloaded set as bodyweight rather than as zero kg", () => {
    const [a] = buildSessionRecap([set({ weight_kg: null, reps: 10 })]);
    expect(a.groups[0].entries[0].weightKg).toBeNull();
    const [b] = buildSessionRecap([set({ weight_kg: 0, reps: 10 })]);
    expect(b.groups[0].entries[0].weightKg).toBeNull();
  });

  it("reads a hold as a hold, not as zero reps", () => {
    const [movement] = buildSessionRecap([
      set({ reps: 0, duration_sec: 30, weight_kg: null }),
      set({ reps: 0, duration_sec: 30, weight_kg: null }),
    ]);
    expect(movement.groups[0].entries).toEqual([
      { sets: 2, measure: { type: "duration", seconds: 30 }, weightKg: null },
    ]);
  });

  it("reads a loaded carry as a distance", () => {
    const [movement] = buildSessionRecap([
      set({ reps: 0, distance_m: 30, weight_kg: 24, set_kind: "accessory" }),
    ]);
    expect(movement.groups[0]).toEqual({
      kind: "accessory",
      entries: [{ sets: 1, measure: { type: "distance", metres: 30 }, weightKg: 24 }],
    });
  });

  it("never merges a hold with a rep set, even at the same load", () => {
    const [movement] = buildSessionRecap([
      set({ reps: 30, weight_kg: null }),
      set({ reps: 0, duration_sec: 30, weight_kg: null }),
    ]);
    expect(movement.groups[0].entries).toHaveLength(2);
  });

  it("counts warm-ups without itemising them", () => {
    const [movement] = buildSessionRecap([
      set({ set_kind: "warmup", weight_kg: 40 }),
      set({ set_kind: "warmup", weight_kg: 60 }),
      set(),
    ]);
    expect(movement.warmupSets).toBe(2);
    expect(movement.groups.map((g) => g.kind)).toEqual(["main"]);
  });

  it("separates working kinds and orders them main-first", () => {
    const [movement] = buildSessionRecap([
      set({ set_kind: "accessory", weight_kg: 60, reps: 10 }),
      set({ set_kind: "main" }),
    ]);
    expect(movement.groups.map((g) => g.kind)).toEqual(["main", "accessory"]);
  });

  it("keeps a movement whose sets were all skipped, with its reasons", () => {
    const [movement] = buildSessionRecap([
      set({ skipped: true, skip_reason: "pain" }),
      set({ skipped: true, skip_reason: "pain" }),
      set({ skipped: true, skip_reason: "time" }),
    ]);
    expect(movement.name).toBe("Squat");
    expect(movement.groups).toEqual([]);
    expect(movement.skippedSets).toBe(3);
    expect(movement.skipReasons).toEqual(["pain", "time"]);
  });

  it("orders movements by when they were first logged", () => {
    const recap = buildSessionRecap([
      set({ movement_id: "mv-bench", movement_name: "Bench Press", set_index: 0 }),
      set({ movement_id: "mv-squat", movement_name: "Squat", set_index: 1 }),
      set({ movement_id: "mv-bench", movement_name: "Bench Press", set_index: 2 }),
    ]);
    expect(recap.map((m) => m.name)).toEqual(["Bench Press", "Squat"]);
  });

  it("groups a movement done twice in one session under one heading", () => {
    const recap = buildSessionRecap([
      set({ set_index: 0 }),
      set({ movement_id: "mv-bench", movement_name: "Bench", set_index: 1, weight_kg: 80 }),
      set({ set_index: 2 }),
    ]);
    expect(recap).toHaveLength(2);
    // Another movement in between is not a change to this one: the lifter did
    // two identical squat sets, so they read as two identical squat sets.
    expect(recap[0].groups[0].entries).toEqual([
      { sets: 2, measure: { type: "reps", reps: 5 }, weightKg: 100 },
    ]);
  });

  it("sorts by set_index, so rows arriving out of order still read in session order", () => {
    const [movement] = buildSessionRecap([
      set({ set_index: 2, weight_kg: 110, reps: 3 }),
      set({ set_index: 0, weight_kg: 100 }),
      set({ set_index: 1, weight_kg: 100 }),
    ]);
    expect(movement.groups[0].entries.map((e) => [e.sets, e.weightKg])).toEqual([
      [2, 100],
      [1, 110],
    ]);
  });

  it("drops rows that recorded nothing at all", () => {
    expect(
      buildSessionRecap([set({ reps: 0, duration_sec: null, distance_m: null })]),
    ).toEqual([]);
  });

  it("drops rows with no movement", () => {
    expect(buildSessionRecap([set({ movement_id: null })])).toEqual([]);
  });

  it("falls back to a neutral name rather than rendering a blank heading", () => {
    const [movement] = buildSessionRecap([set({ movement_name: null })]);
    expect(movement.name).toBe("Movement");
  });

  it("files an unrecognised set kind as working rather than discarding it", () => {
    const [movement] = buildSessionRecap([set({ set_kind: "something_new" })]);
    expect(movement.groups[0].kind).toBe("main");
  });
});
