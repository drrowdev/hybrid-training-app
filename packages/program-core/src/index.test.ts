/**
 * Contract test — a trivial mock ProgramEngine exercises the full interface,
 * proving the contract is coherent and usable (setup → timeline → prescribe →
 * onSessionLogged) and that an Instance round-trips through JSON (it must, since
 * the platform persists it).
 */
import { describe, it, expect } from "vitest";
import {
  type ProgramEngine,
  type PlatformContext,
  type SessionPrescription,
  totalPrescribedSets,
  itemsOfKind,
  oneRepMaxFor,
} from "./index";

// A minimal 2-session "program": one squat day, then a deload, driven entirely
// by the shared training max from PlatformContext.
interface MockInstance {
  movement: string;
  days: number;
}

const mockEngine: ProgramEngine<MockInstance> = {
  meta: { id: "mock", name: "Mock", family: "test", summary: "A test program." },

  describeSetup() {
    return {
      fields: [
        { key: "movement", label: "Lift", type: "select", options: [{ value: "squat", label: "Squat" }], required: true },
        { key: "days", label: "Days", type: "number", defaultValue: 2 },
      ],
    };
  },

  setup(input) {
    const movement = String(input.values.movement ?? "squat");
    const days = Number(input.values.days ?? 2);
    return { movement, days };
  },

  timeline(instance) {
    return Array.from({ length: instance.days }, (_, i) => ({
      ref: `d${i}`,
      index: i,
      label: `Day ${i + 1}`,
      kind: i === instance.days - 1 ? ("deload" as const) : ("training" as const),
    }));
  },

  prescribe(instance, ref, ctx): SessionPrescription {
    const tm = oneRepMaxFor(ctx, instance.movement) ?? 100;
    const isDeload = ref === `d${instance.days - 1}`;
    const pct = isDeload ? 0.6 : 0.85;
    return {
      items: [
        {
          kind: isDeload ? "main" : "amrap",
          name: instance.movement,
          sets: 1,
          reps: 5,
          percentOfTm: pct,
          weightKg: Math.round(tm * pct),
          isAmrap: !isDeload,
        },
      ],
    };
  },

  onSessionLogged(instance, log, _ctx) {
    const top = log.sets[log.sets.length - 1];
    const recommendations =
      top && top.isAmrap && top.reps >= 8
        ? [
            {
              kind: "tm-bump" as const,
              title: "Strong AMRAP — consider a TM bump",
              detail: `Hit ${top.reps} reps on the top set.`,
              data: { movement: instance.movement },
            },
          ]
        : [];
    return { instance, recommendations };
  },
};

const ctx: PlatformContext = { oneRepMaxes: { squat: 140 }, roundingKg: 2.5 };

describe("ProgramEngine contract — mock implementation", () => {
  it("setup → timeline produces an ordered plan", () => {
    const inst = mockEngine.setup({ values: { movement: "squat", days: 3 } }, ctx);
    const tl = mockEngine.timeline(inst);
    expect(tl.map((s) => s.ref)).toEqual(["d0", "d1", "d2"]);
    expect(tl[2]!.kind).toBe("deload");
    expect(tl.map((s) => s.index)).toEqual([0, 1, 2]);
  });

  it("prescribe materialises against the shared training max", () => {
    const inst = mockEngine.setup({ values: { movement: "squat", days: 2 } }, ctx);
    const p = mockEngine.prescribe(inst, "d0", ctx);
    expect(p.items[0]).toMatchObject({ name: "squat", weightKg: 119, isAmrap: true }); // 140*0.85
    const deload = mockEngine.prescribe(inst, "d1", ctx);
    expect(deload.items[0]).toMatchObject({ weightKg: 84, isAmrap: false }); // 140*0.6
  });

  it("onSessionLogged surfaces a program-owned recommendation, never auto-applies", () => {
    const inst = mockEngine.setup({ values: { movement: "squat", days: 2 } }, ctx);
    const strong = mockEngine.onSessionLogged(
      inst,
      { ref: "d0", performedAt: "2026-01-01", sets: [{ movement: "squat", weightKg: 119, reps: 10, isAmrap: true }] },
      ctx,
    );
    expect(strong.recommendations[0]?.kind).toBe("tm-bump");
    // The TM in ctx is unchanged — recommendations are surfaced, not applied.
    expect(ctx.oneRepMaxes.squat).toBe(140);

    const weak = mockEngine.onSessionLogged(
      inst,
      { ref: "d0", performedAt: "2026-01-01", sets: [{ movement: "squat", weightKg: 119, reps: 5, isAmrap: true }] },
      ctx,
    );
    expect(weak.recommendations).toEqual([]);
  });

  it("the instance round-trips through JSON (platform persists it)", () => {
    const inst = mockEngine.setup({ values: { movement: "squat", days: 2 } }, ctx);
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });
});

describe("prescription helpers", () => {
  const p: SessionPrescription = {
    items: [
      { kind: "warmup", name: "Squat", sets: 3, reps: 5 },
      { kind: "main", name: "Squat", reps: 5 },
      { kind: "supplemental", name: "Squat", sets: 5, reps: 10 },
      { kind: "assistance", name: "Chinup", sets: 3, reps: 10 },
    ],
  };

  it("totalPrescribedSets sums sets (default 1)", () => {
    expect(totalPrescribedSets(p)).toBe(3 + 1 + 5 + 3);
  });

  it("itemsOfKind filters in order", () => {
    expect(itemsOfKind(p, "supplemental").map((i) => i.name)).toEqual(["Squat"]);
    expect(itemsOfKind(p, "main")).toHaveLength(1);
  });
});
