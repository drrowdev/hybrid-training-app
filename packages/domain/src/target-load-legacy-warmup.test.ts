/**
 * The reported bug, end to end: a weighted pull-up warm-up of "+40 kg".
 *
 * Three producers could emit a warm-up load for a belt-loaded movement without
 * subtracting bodyweight, and one of them had already written the numbers into
 * a live plan. These cover the app side — the stored item is resolved through
 * the shared resolver, so a plan materialised before the fix stops asking for
 * +40 kg without being regenerated.
 */
import { describe, it, expect } from "vitest";
import { resolveTargetLoadKg } from "./target-load";

const toPlate = (kg: number) => Math.round(kg / 2.5) * 2.5;
const BODYWEIGHT = 82;

describe("a stored warm-up written before the bodyweight subtraction existed", () => {
  // The lifter's report: a 118 kg system max, week at 85% → a 100 kg total
  // working load, ramped 40/60/80% by the shared ladder and handed over raw.
  const legacyRamp = [40, 60, 80];

  it("reads an unmarked absolute target as a total and takes bodyweight off", () => {
    const resolved = legacyRamp.map((kg) =>
      resolveTargetLoadKg(
        { targetWeightKg: kg, kind: "warmup" },
        {
          isSystemLoad: true,
          bodyweightKg: BODYWEIGHT,
          roundKg: toPlate,
          roundAbsoluteKg: toPlate,
        },
      ),
    );
    // Every rung of that ramp is under an 82 kg lifter, so all three are plain
    // bodyweight pull-ups — not +40, +60 and +80 kg on a belt.
    expect(resolved).toEqual([0, 0, 0]);
  });

  it("keeps a heavier rung that genuinely clears bodyweight", () => {
    expect(
      resolveTargetLoadKg(
        { targetWeightKg: 100, kind: "warmup" },
        {
          isSystemLoad: true,
          bodyweightKg: BODYWEIGHT,
          roundKg: toPlate,
          roundAbsoluteKg: toPlate,
        },
      ),
    ).toBe(17.5);
  });

  it("does not subtract twice from a target the engine already resolved", () => {
    // `systemLoad` marks a value that is ALREADY the belt load.
    expect(
      resolveTargetLoadKg(
        { targetWeightKg: 20, systemLoad: true, kind: "warmup" },
        {
          isSystemLoad: true,
          bodyweightKg: BODYWEIGHT,
          roundKg: toPlate,
          roundAbsoluteKg: toPlate,
        },
      ),
    ).toBe(20);
    expect(
      resolveTargetLoadKg(
        { targetWeightKg: 0, systemLoad: true, kind: "warmup" },
        {
          isSystemLoad: true,
          bodyweightKg: BODYWEIGHT,
          roundKg: toPlate,
          roundAbsoluteKg: toPlate,
        },
      ),
    ).toBe(0);
  });

  it("leaves the load unresolved rather than guessing with no bodyweight on file", () => {
    expect(
      resolveTargetLoadKg(
        { targetWeightKg: 40, kind: "warmup" },
        { isSystemLoad: true, roundKg: toPlate, roundAbsoluteKg: toPlate },
      ),
    ).toBeNull();
  });

  it("leaves a barbell lift's absolute target alone", () => {
    expect(
      resolveTargetLoadKg(
        { targetWeightKg: 40, kind: "warmup" },
        { bodyweightKg: BODYWEIGHT, roundKg: toPlate, roundAbsoluteKg: toPlate },
      ),
    ).toBe(40);
  });

  it("does not touch a hand-entered load on a non-warm-up item", () => {
    // `eccentric-chin-up` is a rehab movement the catalog also marks
    // bodyweight-loadable, and its load is the lifter's own number stored
    // verbatim. Reading it as a bodyweight-inclusive total would zero it.
    for (const kind of ["tendon", "main", "accessory", "cardio_external"]) {
      expect(
        resolveTargetLoadKg(
          { targetWeightKg: 10, kind },
          {
            isSystemLoad: true,
            bodyweightKg: BODYWEIGHT,
            roundKg: toPlate,
          },
        ),
      ).toBe(10);
    }
  });
});
