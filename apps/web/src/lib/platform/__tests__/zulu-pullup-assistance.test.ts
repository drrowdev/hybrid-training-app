/**
 * Zulu/HT pull-up assistance — end-to-end engine → adapter → materialize.
 *
 * The source table quotes the assistance sets as a share of MAX CLEAN REPS, and
 * that share is already spent producing the prescribed reps (12 / 10 / 8). The
 * engine used to carry the share as `percentOfTm`, which the adapter renders as
 * a percentage of a LOAD — so a lifter with a pull-up entry saw a fabricated
 * kilogram target on a bodyweight set.
 *
 * There is no max-rep anchor in the prescription to divide by, so the honest
 * prescription is the reps themselves plus the source's 3–5 set range.
 */
import { describe, it, expect } from "vitest";
import { zuluHtEngine, type ZuluHtInstance } from "@hta/tacticalbarbell";
import { greenProtocolEngine, type GreenInstance } from "@hta/green";
import type { PlatformContext, ProgramEngine } from "@hta/program-core";
import { materializeProgram } from "../materialize";
import type { MovementResolver } from "../adapter";

const ctx: PlatformContext = {
  // A lifter who recorded a 15-rep pull-up max — it shares the 1RM column, so a
  // percentage of it would be rendered as 15 kg × something.
  oneRepMaxes: { squat: 150, bench: 100, deadlift: 200, press: 70, pullup: 15 },
  roundingKg: 2.5,
};

const resolve: MovementResolver = (key) =>
  ["squat", "bench", "deadlift", "press", "pullup"].includes(key)
    ? { movementId: `mv-${key}`, slug: `${key}-variant`, displayName: key }
    : undefined;

const weekdays = [0, 1, 2, 3, 4, 5, 6];

function pullupItems(engine: ProgramEngine<never>, instance: unknown) {
  const result = materializeProgram(
    engine as never,
    instance as never,
    ctx,
    resolve,
    { weekdays },
  );
  return result.sessions
    .flatMap((s) => s.prescription.items)
    .filter((it) => it.movementId === "mv-pullup");
}

describe("Zulu/HT pull-up assistance — prescribe", () => {
  const inst: ZuluHtInstance = zuluHtEngine.setup({ values: { blocks: 1 } }, ctx);

  it("DC-K4: keeps the source's reps whether or not a pull-up max is recorded", () => {
    // `assistPct` ascends with the wave's other intensity columns while
    // `assistReps` descends — no rep max reproduces 12/10/8 from 60/65/70%, so
    // a recorded pull-up max must not silently replace the table's figure.
    const bare: PlatformContext = {
      ...ctx,
      oneRepMaxes: { squat: 150, bench: 100, deadlift: 200, press: 70 },
    };
    const repsFor = (c: PlatformContext) =>
      [1, 2, 3].map(
        (week) =>
          zuluHtEngine.prescribe(inst, `b0-w${week}-s1`, c).items.find(
            (it) => it.kind === "assistance",
          )!.reps,
      );
    expect(repsFor(ctx)).toEqual([12, 10, 8]);
    expect(repsFor(bare)).toEqual([12, 10, 8]);
  });

  it("keeps the source's 3–5 set range", () => {
    for (const week of [1, 2, 3]) {
      const assist = zuluHtEngine
        .prescribe(inst, `b0-w${week}-s1`, ctx)
        .items.find((it) => it.kind === "assistance")!;
      expect(assist.sets).toBe(3);
      expect(assist.setsMax).toBe(5);
    }
  });

  it("DC-K4: carries no load percentage — the share is of reps, not of a weight", () => {
    for (const week of [1, 2, 3]) {
      const assist = zuluHtEngine
        .prescribe(inst, `b0-w${week}-s1`, ctx)
        .items.find((it) => it.kind === "assistance")!;
      expect(assist.percentOfTm).toBeUndefined();
      expect(assist.weightKg).toBeUndefined();
    }
  });

  it("does not claim a weight", () => {
    const assist = zuluHtEngine
      .prescribe(inst, "b0-w1-s1", ctx)
      .items.find((it) => it.kind === "assistance")!;
    expect(assist.note).not.toMatch(/1RM/i);
    expect(assist.note).not.toMatch(/kg/i);
  });
});

describe("Zulu/HT pull-up assistance — materialized", () => {
  it("DC-K4: no percentage of a rep count survives into the session", () => {
    const items = pullupItems(
      zuluHtEngine as never,
      zuluHtEngine.setup({ values: { blocks: 1 } }, ctx),
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.percentTm ?? null).toBeNull();
      expect(it.targetWeightKg ?? null).toBeNull();
    }
  });

  it("DC-K4: the 3–5 set range reaches the logger as five slots, two optional", () => {
    const items = pullupItems(
      zuluHtEngine as never,
      zuluHtEngine.setup({ values: { blocks: 1 } }, ctx),
    );
    const ranged = items.filter((it) => it.setRange != null);
    expect(ranged.length).toBeGreaterThan(0);
    for (const it of ranged) {
      expect(it.setRange).toEqual({ min: 3, max: 5 });
      expect(it.sets).toBe(1);
    }
    // Five loggable slots per prescribed day; the fourth and fifth are optional.
    expect(ranged.length % 5).toBe(0);
    expect(ranged.filter((it) => it.optional === true).length).toBe((ranged.length / 5) * 2);
  });

  it("DC-K4: Green's delegated Zulu days inherit the same honest prescription", () => {
    // I/CAT is the public phase that runs Zulu/HT under Green.
    const green: GreenInstance = greenProtocolEngine.setup(
      { values: { phaseId: "icat", blocks: 1 } },
      ctx,
    );
    const items = pullupItems(greenProtocolEngine as never, green);
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.percentTm ?? null).toBeNull();
      expect(it.targetWeightKg ?? null).toBeNull();
    }
    // The table's own rep figures, unchanged by the lifter's pull-up entry.
    const reps = new Set(items.map((it) => it.reps));
    expect([...reps].sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([8, 10, 12]);
  });});
