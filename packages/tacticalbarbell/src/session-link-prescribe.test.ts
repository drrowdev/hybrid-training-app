/**
 * Link resolution in `prescribe()` — the point where a user-authored link
 * actually becomes circuit metadata on the prescription.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext, PrescribedItem } from "@hta/program-core";
import { tacticalBarbellEngine as tb, type TbInstance } from "./program";

const ctx: PlatformContext = {
  oneRepMaxes: {
    squat: 200,
    bench: 100,
    deadlift: 250,
    press: 100,
    "overhead-press": 100,
    "weighted-pullup": 50,
    pullup: 50,
    "barbell-row": 120,
    "rack-pull": 250,
  },
  roundingKg: 2.5,
};

function setup(values: Record<string, unknown> = {}): TbInstance {
  return tb.setup({ values }, ctx);
}

/** Operator week 1, session 1 — resolved from the timeline rather than guessed. */
function prescribe(instance: TbInstance, ref: string): PrescribedItem[] {
  return tb.prescribe(instance, ref, ctx).items;
}

function working(items: PrescribedItem[]): PrescribedItem[] {
  return items.filter((it) => it.kind !== "warmup");
}

function circuitOf(items: PrescribedItem[], movementId: string) {
  return working(items).find((it) => it.movementId === movementId)?.circuit;
}

const link = (members: string[], over: Record<string, unknown> = {}) => ({
  id: "link-1",
  name: "Superset",
  members,
  ...over,
});

function operatorSessionId(): string {
  // Resolve the real first work-session ref rather than guessing its id.
  const inst = setup();
  const spec = tb.timeline(inst)[0]!;
  return spec.ref;
}

describe("prescribe — anchored main-lift links", () => {
  const ref = operatorSessionId();

  it("emits no circuit when there are no links", () => {
    const items = prescribe(setup(), ref);
    expect(items.every((it) => it.circuit == null)).toBe(true);
  });

  it("emits circuit metadata on ANCHORED %TM lifts", () => {
    // Previously only the unanchored branch could emit a circuit, so linking two
    // percentage-loaded main lifts produced nothing at all.
    const inst = setup({
      customSessionLinks: { "slot-1": [link(["squat", "bench"])] },
    });
    const items = prescribe(inst, ref);
    const squat = circuitOf(items, "squat");
    const bench = circuitOf(items, "bench");
    expect(squat).toMatchObject({ id: "link-1", name: "Superset", size: 2, position: 0 });
    expect(bench).toMatchObject({ id: "link-1", size: 2, position: 1 });
    expect(squat?.rounds).toBe(bench?.rounds);
  });

  it("never puts the circuit on a warm-up", () => {
    const inst = setup({
      customSessionLinks: { "slot-1": [link(["squat", "bench"])] },
    });
    const items = prescribe(inst, ref);
    const warmups = items.filter((it) => it.kind === "warmup");
    expect(warmups.length).toBeGreaterThan(0);
    expect(warmups.every((it) => it.circuit == null)).toBe(true);
  });

  it("keeps each lift's warm-up ramp with its own working set when reordering", () => {
    const inst = setup({
      customSessionLinks: { "slot-1": [link(["squat", "bench"])] },
    });
    const items = prescribe(inst, ref);
    // Walk the list: every warm-up must be followed (eventually) by its own
    // movement's working set before another movement's working set appears.
    const order = items.map((it) => `${it.kind}:${it.movementId}`);
    const squatWork = order.indexOf("main:squat");
    const benchWork = order.indexOf("main:bench");
    const lastSquatWarmup = order.lastIndexOf("warmup:squat");
    const lastBenchWarmup = order.lastIndexOf("warmup:bench");
    expect(lastSquatWarmup).toBeLessThan(squatWork);
    expect(lastBenchWarmup).toBeLessThan(benchWork);
  });

  it("moves members adjacent so the preview can bracket them", () => {
    const inst = setup({
      customSessionLinks: {
        "slot-1": [link(["squat", "weighted-pullup"])],
      },
    });
    const items = prescribe(inst, ref);
    const workingIds = working(items).map((it) => it.movementId);
    const a = workingIds.indexOf("squat");
    const b = workingIds.indexOf("weighted-pullup");
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBe(a + 1);
  });

  it("sets rounds to the LOWEST member set count", () => {
    const inst = setup({
      customSessionLinks: { "slot-1": [link(["squat", "bench"])] },
    });
    const items = prescribe(inst, ref);
    const squatSets = working(items).find((it) => it.movementId === "squat")?.sets ?? 0;
    const benchSets = working(items).find((it) => it.movementId === "bench")?.sets ?? 0;
    expect(circuitOf(items, "squat")?.rounds).toBe(Math.min(squatSets, benchSets));
  });

  it("supports a three-member link", () => {
    const inst = setup({
      customSessionLinks: {
        "slot-1": [
          link(["squat", "bench", "weighted-pullup"], { name: "Tri-set" }),
        ],
      },
    });
    const items = prescribe(inst, ref);
    expect(circuitOf(items, "squat")).toMatchObject({ size: 3, position: 0 });
    expect(circuitOf(items, "bench")).toMatchObject({ size: 3, position: 1 });
    expect(circuitOf(items, "weighted-pullup")).toMatchObject({
      size: 3,
      position: 2,
    });
  });
});

describe("prescribe — links that cannot be realised", () => {
  const ref = operatorSessionId();

  it("skips a link whose member is not in this session", () => {
    const inst = setup({
      customSessionLinks: {
        "slot-1": [link(["squat", "not-in-this-session"])],
      },
    });
    const items = prescribe(inst, ref);
    expect(items.every((it) => it.circuit == null)).toBe(true);
  });

  it("still links a member emitted without a resolved 1RM", () => {
    // A lift whose max is missing is deliberately still prescribed (loadless,
    // "set a 1RM before this session") so the platform can resolve the weight
    // later. It IS a real loggable item, so a link over it holds — this is why
    // links resolve against emitted items rather than against a set count.
    const noBench: PlatformContext = {
      ...ctx,
      oneRepMaxes: { ...ctx.oneRepMaxes, bench: 0 },
    };
    const inst = tb.setup(
      {
        values: {
          customSessionLinks: { "slot-1": [link(["squat", "bench"])] },
        },
      },
      noBench,
    );
    const items = tb.prescribe(inst, ref, noBench).items;
    const bench = working(items).find((it) => it.movementId === "bench");
    expect(bench).toBeDefined();
    expect(bench?.weightKg).toBeUndefined();
    expect(bench?.circuit).toMatchObject({ id: "link-1" });
  });

  it("does not let two links claim the same lift", () => {
    const inst = setup({
      customSessionLinks: {
        "slot-1": [
          link(["squat", "bench"], { id: "link-1" }),
          link(["squat", "weighted-pullup"], { id: "link-2" }),
        ],
      },
    });
    const items = prescribe(inst, ref);
    // setup() already drops the second link; nothing carries link-2.
    expect(
      working(items).every((it) => it.circuit?.id !== "link-2"),
    ).toBe(true);
  });

  it("ignores links for a different session series", () => {
    const inst = setup({
      customSessionLinks: { "slot-2": [link(["squat", "bench"])] },
    });
    const items = prescribe(inst, ref);
    expect(items.every((it) => it.circuit == null)).toBe(true);
  });
});

describe("prescribe — AB Triad precedence", () => {
  it("keeps the built-in triad circuit and ignores an overlapping user link", () => {
    // TB3 sessions carry the AB Triad. The engine owns it, an item can hold only
    // one circuit, so a user link touching those slots must be ignored outright.
    const inst = setup({ templateId: "zulu" });
    const withTriad = tb
      .timeline(inst)
      .map((spec) => ({ spec, items: tb.prescribe(inst, spec.ref, ctx).items }))
      .find(({ items }) =>
        items.some((it) => it.circuit?.id === "tb-ab-triad"),
      );
    if (!withTriad) return; // template without the triad — nothing to assert
    const linked = setup({
      templateId: "zulu",
      customSessionLinks: {
        [`slot-1`]: [link(["hanging-leg-raise", "toes-to-bar"])],
      },
    });
    const items = tb.prescribe(linked, withTriad.spec.ref, ctx).items;
    expect(items.some((it) => it.circuit?.id === "link-1")).toBe(false);
    expect(items.some((it) => it.circuit?.id === "tb-ab-triad")).toBe(true);
  });
});
