/**
 * The lifter's own warm-up ladder reaches every program engine.
 *
 * Before this contract, `profiles.warmup_scheme` governed only natively
 * assembled blocks: each program engine hardcoded a ramp and never read the
 * setting, so "Skip warm-ups" still produced three sets inside 5/3/1, Tactical
 * Barbell, Zulu/HT, HYROX and Green. These tests pin the seam that fixes it —
 * `PlatformContext.warmupRamp` — at the ENGINE level, where the prescription is
 * actually built.
 *
 * DC-K4 (override-and-warn, never silent overrule): a ladder the lifter
 * explicitly configured must not be silently replaced by a program's own ramp.
 */
import { describe, expect, it } from "vitest";
import type { PlatformContext, WarmupRamp } from "@hta/program-core";
import { GLOBAL_WARMUP_RAMP } from "@hta/program-core";
import { wendler531Engine } from "@hta/wendler";
import { tacticalBarbellEngine, zuluHtEngine } from "@hta/tacticalbarbell";
import { greenProtocolEngine } from "@hta/green";

const ONE_RMS = {
  squat: 200,
  bench: 150,
  deadlift: 250,
  "overhead-press": 100,
  press: 100,
  "barbell-row": 120,
  "weighted-pullup": 40,
};

function ctxWith(warmupRamp?: WarmupRamp): PlatformContext {
  return {
    oneRepMaxes: { ...ONE_RMS },
    roundingKg: 2.5,
    ...(warmupRamp ? { warmupRamp } : {}),
  };
}

/** "Skip warm-ups" — how `setCount: 0` crosses the platform seam. */
const SKIP: WarmupRamp = { percents: [], reps: [], anchor: "top_set" };

/** A two-rung custom ladder, deliberately unlike every program default. */
const QUICK: WarmupRamp = { percents: [0.5, 0.75], reps: [5, 3], anchor: "top_set" };

const warmups = (items: ReadonlyArray<{ kind: string }>) =>
  items.filter((it) => it.kind === "warmup");

/**
 * Each engine, with the setup values it needs. The session ref is DISCOVERED
 * from the engine's own `timeline()` rather than hard-coded, so a change to
 * ref formats or phase ordering can't quietly turn these into no-op tests.
 *
 * Green is included because it delegates its strength days to the TB / Zulu-HT
 * engines and forwards the same context — without a test it would only be
 * correct by accident.
 */
const CASES = [
  {
    name: "5/3/1",
    engine: wendler531Engine,
    values: {
      templateId: "5spro-fsl",
      leaderCycles: 2,
      anchorCycles: 1,
      tmPercent: 0.85,
    },
  },
  {
    name: "Tactical Barbell (Operator)",
    engine: tacticalBarbellEngine,
    values: {
      templateId: "operator",
      blocks: 1,
      cluster: ["bench", "squat", "deadlift"],
      useTrainingMax: false,
      useTemplateDefaults: false,
    },
  },
  {
    name: "Zulu/HT",
    engine: zuluHtEngine,
    values: { blocks: 1, useTrainingMax: false },
  },
  {
    name: "Green Protocol",
    engine: greenProtocolEngine,
    values: { phaseId: "hybrid", blocks: 1, useTrainingMax: false },
  },
] as const;

/**
 * The first timeline ref that actually prescribes a warm-up ramp with no user
 * preference. Throws rather than returning undefined so a fixture that stops
 * producing warm-ups fails loudly instead of vacuously passing.
 */
function refWithWarmups(
  engine: (typeof CASES)[number]["engine"],
  values: Record<string, unknown>,
): string {
  const ctx = ctxWith();
  const instance = engine.setup({ values }, ctx);
  for (const spec of engine.timeline(instance as never)) {
    const items = engine.prescribe(instance as never, spec.ref, ctx).items;
    if (warmups(items).length > 0) return spec.ref;
  }
  throw new Error(
    `${engine.meta.id}: no timeline session prescribes warm-ups — fixture is stale`,
  );
}

describe("PlatformContext.warmupRamp — the lifter's ladder reaches every engine", () => {
  for (const { name, engine, values } of CASES) {
    describe(name, () => {
      const ref = refWithWarmups(engine, values);
      const prescribe = (ramp?: WarmupRamp) => {
        const ctx = ctxWith(ramp);
        const instance = engine.setup({ values }, ctx);
        return engine.prescribe(instance as never, ref, ctx);
      };

      it("emits a warm-up ramp when the lifter has expressed no preference", () => {
        // Guards the fixture itself: a case that prescribed no warm-ups either
        // way would make the "skip" assertion below vacuously pass.
        expect(warmups(prescribe().items).length).toBeGreaterThan(0);
      });

      it('DC-K4: honours "skip warm-ups" instead of silently overruling it', () => {
        expect(warmups(prescribe(SKIP).items)).toHaveLength(0);
      });

      it("DC-K4: honours a custom ladder's rung count", () => {
        const withDefault = warmups(prescribe().items).length;
        const withQuick = warmups(prescribe(QUICK).items).length;
        // Each loaded movement now ramps on 2 rungs rather than the default 3,
        // so the count scales down but stays a whole multiple of the ladder.
        expect(withQuick).toBeLessThan(withDefault);
        expect(withQuick % QUICK.percents.length).toBe(0);
      });

      it("leaves the working sets untouched — only the ramp changes", () => {
        const working = (ramp?: WarmupRamp) =>
          prescribe(ramp).items.filter((it) => it.kind !== "warmup");
        expect(working(SKIP)).toEqual(working());
        expect(working(QUICK)).toEqual(working());
      });
    });
  }
});

describe("5/3/1 keeps its published ramp only as a DEFAULT", () => {
  const values = {
    templateId: "5spro-fsl",
    leaderCycles: 2,
    anchorCycles: 1,
    tmPercent: 0.85,
  };
  const ref = refWithWarmups(wendler531Engine, values);
  const prescribe = (ramp?: WarmupRamp) => {
    const ctx = ctxWith(ramp);
    const instance = wendler531Engine.setup({ values }, ctx);
    return wendler531Engine.prescribe(instance, ref, ctx);
  };

  const loadsOf = (ramp?: WarmupRamp) =>
    warmups(prescribe(ramp).items).map(
      (it) => (it as { weightKg?: number }).weightKg ?? 0,
    );

  it("no preference ⇒ a ramp anchored on the Training Max, flat across the wave", () => {
    const instance = wendler531Engine.setup({ values }, ctxWith());
    const lift = Object.entries(instance.trainingMaxes).find(
      ([, tm]) => tm != null,
    );
    expect(lift).toBeDefined();
    const loads = loadsOf();
    // 40/50/60% of the TRAINING MAX, floored to the 2.5 kg increment. Derived
    // from the instance's own TM so the test can't drift from tmPercent.
    const tm = Object.values(instance.trainingMaxes).find((v) => v != null)!;
    const floor = (n: number) => Math.floor(n / 2.5) * 2.5;
    expect(loads).toEqual([floor(tm * 0.4), floor(tm * 0.5), floor(tm * 0.6)]);
  });

  it("an explicit top-set ladder re-anchors the ramp away from the Training Max", () => {
    const tmAnchored = loadsOf();
    const topSetAnchored = loadsOf(GLOBAL_WARMUP_RAMP);
    // The whole point of honouring the choice: a different ladder, computed off
    // the day's top working set rather than the TM.
    expect(topSetAnchored).not.toEqual(tmAnchored);
    expect(topSetAnchored).toHaveLength(GLOBAL_WARMUP_RAMP.percents.length);

    const items = prescribe(GLOBAL_WARMUP_RAMP).items;
    const topWorking = Math.max(
      ...items
        .filter((it) => it.kind === "main" || it.kind === "amrap")
        .map((it) => (it as { weightKg?: number }).weightKg ?? 0),
    );
    const floor = (n: number) => Math.floor(n / 2.5) * 2.5;
    expect(topSetAnchored).toEqual(
      GLOBAL_WARMUP_RAMP.percents.map((p) => floor(topWorking * p)),
    );
  });
});
