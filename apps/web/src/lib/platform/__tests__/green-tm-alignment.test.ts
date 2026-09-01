/**
 * Green Protocol strength basis — engine target === rendered target.
 *
 * Green owns no percentages of its own: every strength day is delegated to a
 * nested Tactical Barbell / Zulu-HT instance, so the Training Max basis lives
 * one level down. Reading `useTrainingMax` / `tmPercent` off the Green instance
 * itself finds nothing and silently concludes "percentages are of the true
 * 1RM" — which renders every prescribed weight ~11% heavy when the user chose a
 * 90% Training Max.
 *
 * These tests pin the round trip: what the engine prescribes is what the app's
 * `1RM × tm_percent × percentTm` renderer produces.
 */
import { describe, it, expect } from "vitest";
import { greenProtocolEngine, greenStrengthBasis, type GreenInstance } from "@hta/green";
import type { PlatformContext } from "@hta/program-core";
import { resolveTargetLoadKg } from "@hta/domain";
import { computeTmAlignment } from "../tm-alignment";
import { activeProgramTmPercent } from "@/lib/training-maxes/active-program-basis";

// 143 kg does not divide cleanly by the 2.5 kg plate step, so the engine's
// rounding order (round the TM, then take the session percentage) is visible:
//   round(143 × 0.90) = 127.5  →  round(127.5 × 0.75) = 95
// A single multiplication would give round(143 × 0.90 × 0.75) = 97.5. A clean
// 100 kg fixture gives the same answer both ways and hides the defect.
const ctx: PlatformContext = {
  oneRepMaxes: { squat: 143, bench: 100, deadlift: 200, press: 70 },
  roundingKg: 2.5,
};

function greenInstance(values: Record<string, unknown>): GreenInstance {
  return greenProtocolEngine.setup({ values: { phaseId: "hybrid", ...values } }, ctx);
}

/**
 * What the lifter is shown, through the app's canonical resolver: the saved max
 * scaled by the seeded `tm_percent`, then by the prescription's percentage.
 */
function renderedKg(oneRm: number, tmPercent: number, percentTm: number): number | null {
  return resolveTargetLoadKg(
    { kind: "main", percentTm },
    {
      tmKg: oneRm * (tmPercent / 100),
      roundKg: (kg) => Math.round(kg / ctx.roundingKg!) * ctx.roundingKg!,
    },
  );
}

describe("greenStrengthBasis — the basis lives on the nested engines", () => {
  it("DC-K4: reports the Training Max the nested strength engines were seeded with", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    expect(greenStrengthBasis(inst)).toEqual({ kind: "training-max", tmPercent: 0.9 });
  });

  it("DC-K4: reports a true-1RM basis when the user did not opt into a Training Max", () => {
    const inst = greenInstance({ useTrainingMax: false });
    expect(greenStrengthBasis(inst)).toEqual({ kind: "one-rm" });
  });

  it("has no answer for an instance with no nested strength engines", () => {
    expect(greenStrengthBasis({ strength: {} } as unknown as GreenInstance)).toBeNull();
  });

  it("has no answer when the nested engines disagree — one percentage cannot describe both", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    const keys = Object.keys(inst.strength);
    expect(keys.length).toBeGreaterThan(1);
    const mixed = {
      ...inst,
      strength: {
        ...inst.strength,
        [keys[0]!]: { ...inst.strength[keys[0]!], useTrainingMax: false },
      },
    } as GreenInstance;
    expect(greenStrengthBasis(mixed)).toBeNull();
  });
});

describe("computeTmAlignment — Green Protocol", () => {
  it("DC-K4: seeds the nested engines' Training Max, not a fabricated 100%", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    const align = computeTmAlignment("tactical-barbell-green", inst, ctx.oneRepMaxes, 2.5);
    // squat: round(143 × 0.90) = 127.5 → 127.5/143 = 89.2%, the engine's own
    // rounded Training Max — not the raw 90%, and nowhere near 100%.
    expect(align.squat).toBeCloseTo(89.2, 1);
    expect(align.bench).toBe(90); // round(100 × 0.90) = 90 → divides cleanly
    expect(align.deadlift).toBe(90); // round(200 × 0.90) = 180
    expect(align.press).toBeCloseTo(89.3, 1); // round(70 × 0.90) = 62.5
  });

  it("seeds 100% when the nested engines load off the true 1RM", () => {
    const inst = greenInstance({ useTrainingMax: false });
    const align = computeTmAlignment("tactical-barbell-green", inst, ctx.oneRepMaxes, 2.5);
    expect(align.squat).toBe(100);
  });

  it("DC-K4: what the engine prescribes is what the app renders", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    const align = computeTmAlignment("tactical-barbell-green", inst, ctx.oneRepMaxes, 2.5);

    // Every strength day of the instance, not just the first.
    const strengthRefs = greenProtocolEngine
      .timeline(inst)
      .filter((s) => s.tags?.includes("modality:strength"))
      .map((s) => s.ref);
    expect(strengthRefs.length).toBeGreaterThan(0);

    let checkedSquat = 0;
    let checked = 0;
    for (const ref of strengthRefs) {
      for (const item of greenProtocolEngine.prescribe(inst, ref, ctx).items) {
        if (item.percentOfTm == null || item.weightKg == null || item.weightKg <= 0) continue;
        if (item.movementId == null) continue;
        const oneRm = ctx.oneRepMaxes[item.movementId];
        const tmPercent = align[item.movementId];
        if (oneRm == null || tmPercent == null) continue;
        expect(renderedKg(oneRm, tmPercent, item.percentOfTm * 100)).toBe(item.weightKg);
        checked++;
        if (item.movementId === "squat") checkedSquat++;
      }
    }
    // The awkward 143 kg squat has to be among them, or the fixture is not
    // exercising the engine's rounding order.
    expect(checked).toBeGreaterThan(0);
    expect(checkedSquat).toBeGreaterThan(0);
  });

  it("seeds nothing when no single basis describes the instance", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    const keys = Object.keys(inst.strength);
    const mixed = {
      ...inst,
      strength: {
        ...inst.strength,
        [keys[0]!]: { ...inst.strength[keys[0]!], useTrainingMax: false },
      },
    } as GreenInstance;
    expect(computeTmAlignment("tactical-barbell-green", mixed, ctx.oneRepMaxes, 2.5)).toEqual({});
  });
});

describe("activeProgramTmPercent — Green Protocol", () => {
  it("DC-K4: the Training Max settings screen reads the same nested basis", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    expect(activeProgramTmPercent("tactical-barbell-green", inst)).toBe(90);
  });

  it("reports the true 1RM when the nested engines use one", () => {
    const inst = greenInstance({ useTrainingMax: false });
    expect(activeProgramTmPercent("tactical-barbell-green", inst)).toBe(100);
  });

  it("has no answer when the nested engines disagree", () => {
    const inst = greenInstance({ useTrainingMax: true, tmPercent: 0.9 });
    const keys = Object.keys(inst.strength);
    const mixed = {
      ...inst,
      strength: {
        ...inst.strength,
        [keys[0]!]: { ...inst.strength[keys[0]!], useTrainingMax: false },
      },
    } as GreenInstance;
    expect(activeProgramTmPercent("tactical-barbell-green", mixed)).toBeNull();
  });
});
