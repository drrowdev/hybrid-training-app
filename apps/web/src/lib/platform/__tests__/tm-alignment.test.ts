import { describe, it, expect } from "vitest";
import { wendler531Engine } from "@hta/wendler";
import { tacticalBarbellEngine } from "@hta/tacticalbarbell";
import type { PlatformContext } from "@hta/program-core";
import { computeTmAlignment } from "../tm-alignment";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 200, bench: 100, deadlift: 250, press: 100 },
  roundingKg: 2.5,
};

describe("computeTmAlignment — Option A", () => {
  it("5/3/1: tm_percent reflects the engine's rounded Training Max over the 1RM", () => {
    const inst = wendler531Engine.setup(
      { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85 } },
      ctx,
    );
    const align = computeTmAlignment("531", inst, ctx.oneRepMaxes);
    // squat TM = round(200×0.85)=170 → 170/200 = 85%; bench = round(100×0.85)=85 → 85%.
    expect(align.squat).toBe(85);
    expect(align.bench).toBe(85);
    expect(align.deadlift).toBe(85); // round(250×0.85)=212.5 → 212.5/250 = 85%
    // Each lift's basis renders the engine's exact weight through the % of TM UI.
    expect(Object.keys(align).sort()).toEqual(["bench", "deadlift", "press", "squat"]);
  });

  it("5/3/1: captures rounding drift when TM doesn't divide cleanly", () => {
    const odd: PlatformContext = { oneRepMaxes: { squat: 142 }, roundingKg: 2.5 };
    const inst = wendler531Engine.setup({ values: { tmPercent: 0.85 } }, odd);
    // TM = round(142×0.85=120.7) = 120 → 120/142 = 84.5%
    const align = computeTmAlignment("531", inst, odd.oneRepMaxes);
    expect(align.squat).toBeCloseTo(84.5, 1);
  });

  it("Tactical Barbell defaults to % of true 1RM (tm_percent = 100)", () => {
    const inst = tacticalBarbellEngine.setup({ values: { templateId: "operator" } }, ctx);
    const align = computeTmAlignment("tactical-barbell", inst, ctx.oneRepMaxes);
    expect(align).toMatchObject({ squat: 100, bench: 100, deadlift: 100, press: 100 });
  });

  it("Tactical Barbell with a derived Training Max uses that TM%", () => {
    const inst = tacticalBarbellEngine.setup(
      { values: { templateId: "operator", useTrainingMax: true, tmPercent: 0.9 } },
      ctx,
    );
    const align = computeTmAlignment("tactical-barbell", inst, ctx.oneRepMaxes);
    expect(align.squat).toBe(90);
  });

  it("unknown family falls back to % of true 1RM", () => {
    const align = computeTmAlignment("hyrox", {}, ctx.oneRepMaxes);
    expect(align).toMatchObject({ squat: 100, bench: 100, deadlift: 100, press: 100 });
  });
});
