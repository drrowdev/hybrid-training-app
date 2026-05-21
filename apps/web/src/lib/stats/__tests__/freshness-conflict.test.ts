import { describe, it, expect } from "vitest";
import { findHeavyOnRecoveringConflict } from "../region-freshness-queries";

const MOV_SQUAT = "00000000-0000-0000-0000-000000000001";
const MOV_BENCH = "00000000-0000-0000-0000-000000000002";
const MOV_CURL = "00000000-0000-0000-0000-000000000003";

const movements = new Map([
  [MOV_SQUAT, { primaryRegion: "knee", name: "Back squat" }],
  [MOV_BENCH, { primaryRegion: "shoulder_scapular", name: "Bench press" }],
  [MOV_CURL, { primaryRegion: "elbow_forearm", name: "Curl" }],
]);

const recoveringQuads = new Map([
  ["knee", { freshness: 0.1, regionLabel: "Knees & quads" }],
  ["shoulder_scapular", { freshness: 0.8, regionLabel: "Shoulders & upper back" }],
]);

const allFresh = new Map([
  ["knee", { freshness: 0.9, regionLabel: "Knees & quads" }],
  ["shoulder_scapular", { freshness: 0.9, regionLabel: "Shoulders & upper back" }],
]);

describe("findHeavyOnRecoveringConflict — DC-V2 soft warning gate", () => {
  it("fires when a main lift @ 85% TM hits a recovering region", () => {
    const items = [{ kind: "main", movementId: MOV_SQUAT, percentTm: 85 }];
    const c = findHeavyOnRecoveringConflict(items, movements, recoveringQuads);
    expect(c).not.toBeNull();
    expect(c?.regionLabel).toBe("Knees & quads");
    expect(c?.movementName).toBe("Back squat");
  });

  it("fires on heavy back-off (low reps) even with no percentTm", () => {
    const items = [{ kind: "back_off", movementId: MOV_SQUAT, reps: 3 }];
    expect(findHeavyOnRecoveringConflict(items, movements, recoveringQuads)).not.toBeNull();
  });

  it("does NOT fire on a light recovery wave (60% TM, 8 reps)", () => {
    const items = [{ kind: "main", movementId: MOV_SQUAT, percentTm: 60, reps: 8 }];
    expect(findHeavyOnRecoveringConflict(items, movements, recoveringQuads)).toBeNull();
  });

  it("does NOT fire on an accessory or warmup, even with low reps", () => {
    const items = [
      { kind: "accessory", movementId: MOV_SQUAT, reps: 3 },
      { kind: "warmup", movementId: MOV_SQUAT, reps: 3 },
    ];
    expect(findHeavyOnRecoveringConflict(items, movements, recoveringQuads)).toBeNull();
  });

  it("does NOT fire when the region is merely 'Recovering' (freshness 0.2)", () => {
    const mild = new Map([["knee", { freshness: 0.2, regionLabel: "Knees & quads" }]]);
    const items = [{ kind: "main", movementId: MOV_SQUAT, percentTm: 90 }];
    expect(findHeavyOnRecoveringConflict(items, movements, mild)).toBeNull();
  });

  it("does NOT fire when freshness is just above the 0.15 floor", () => {
    const edge = new Map([["knee", { freshness: 0.15, regionLabel: "Knees & quads" }]]);
    const items = [{ kind: "main", movementId: MOV_SQUAT, percentTm: 90 }];
    expect(findHeavyOnRecoveringConflict(items, movements, edge)).toBeNull();
  });

  it("does NOT fire when the heavy movement targets a fresh region", () => {
    const items = [{ kind: "main", movementId: MOV_BENCH, percentTm: 90, reps: 3 }];
    expect(findHeavyOnRecoveringConflict(items, movements, recoveringQuads)).toBeNull();
  });

  it("does NOT fire on a cardio-only / fresh-region session", () => {
    const items = [{ kind: "main", movementId: MOV_BENCH, percentTm: 90 }];
    expect(findHeavyOnRecoveringConflict(items, movements, allFresh)).toBeNull();
  });

  it("returns the first matching conflict (single warning, no spam)", () => {
    const items = [
      { kind: "main", movementId: MOV_SQUAT, percentTm: 90, movementName: "Back squat" },
      { kind: "back_off", movementId: MOV_SQUAT, reps: 5, movementName: "Back squat" },
    ];
    const c = findHeavyOnRecoveringConflict(items, movements, recoveringQuads);
    expect(c?.movementName).toBe("Back squat");
  });

  it("skips items whose movement is not in the lookup (unknown region)", () => {
    const items = [{ kind: "main", movementId: "missing", percentTm: 90 }];
    expect(findHeavyOnRecoveringConflict(items, movements, recoveringQuads)).toBeNull();
  });
});
