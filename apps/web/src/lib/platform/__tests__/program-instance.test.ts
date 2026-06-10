/**
 * buildProgramInstanceWrite — the pure deploy computation behind
 * `createProgramInstance`, exercised against the real 5/3/1 engine with no DB.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { wendler531Engine, type WendlerInstance } from "@hta/wendler";
import { buildProgramInstanceWrite } from "../program-instance";
import type { MovementResolver } from "../adapter";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 165, bench: 118, deadlift: 212, press: 71 },
  roundingKg: 2.5,
};

const resolve: MovementResolver = (key) => ({
  movementId: `mv-${key}`,
  slug: `${key}-variant`,
  displayName: key[0]!.toUpperCase() + key.slice(1),
});

function setup(values: Record<string, unknown> = {}): WendlerInstance {
  return wendler531Engine.setup(
    { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85, ...values } },
    ctx,
  );
}

const weekdays = [0, 1, 3, 4];

describe("buildProgramInstanceWrite — 5/3/1", () => {
  const instance = setup();
  const write = buildProgramInstanceWrite({
    engine: wendler531Engine,
    instance,
    ctx,
    resolveMovement: resolve,
    weekdays,
    startedOn: "2026-06-15",
  });

  it("carries the materialised block shape", () => {
    expect(write.weeks).toBe(11);
    expect(write.daysPerWeek).toBe(4);
    expect(write.sessions).toHaveLength(44);
    expect(write.dayIndexOverrides).toEqual({ days: [0, 1, 3, 4], twoADay: false });
  });

  it("seeds a tm_percent for each anchored main lift, mapped to its movement id", () => {
    const byId = Object.fromEntries(write.tmPercents.map((t) => [t.movementId, t.tmPercent]));
    // TM = round(1RM × 0.85); tm_percent = round(TM / 1RM × 100), 1 dp.
    // squat 140/165 = 84.8, bench 100/118 = 84.7, deadlift 180/212 = 84.9, press 60/71 = 84.5
    expect(byId["mv-squat"]).toBeCloseTo(84.8, 1);
    expect(byId["mv-bench"]).toBeCloseTo(84.7, 1);
    expect(byId["mv-deadlift"]).toBeCloseTo(84.9, 1);
    expect(byId["mv-press"]).toBeCloseTo(84.5, 1);
    expect(write.tmPercents).toHaveLength(4);
  });

  it("only seeds tm_percent for lifts the user has anchored", () => {
    const onlySquat: MovementResolver = (k) => (k === "squat" ? resolve(k) : undefined);
    const w = buildProgramInstanceWrite({
      engine: wendler531Engine,
      instance,
      ctx,
      resolveMovement: onlySquat,
      weekdays,
      startedOn: "2026-06-15",
    });
    expect(w.tmPercents.map((t) => t.movementId)).toEqual(["mv-squat"]);
    // and the unresolved lifts surface as skipped, not silent drops
    expect(w.skipped.length).toBeGreaterThan(0);
  });

  it("propagates the schedule-too-small error", () => {
    expect(() =>
      buildProgramInstanceWrite({
        engine: wendler531Engine,
        instance,
        ctx,
        resolveMovement: resolve,
        weekdays: [0, 1, 2],
        startedOn: "2026-06-15",
      }),
    ).toThrow(/more sessions than/);
  });
});
