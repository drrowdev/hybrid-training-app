import { describe, it, expect } from "vitest";
import {
  countSessionTmAnchoredPrs,
  getSessionTmAnchoredPrSummaries,
} from "../pr-queries";
import type { Prescription } from "@hta/db";

const mv = { id: "m1", slug: "back_squat", display_name: "Back Squat" };

const prescription5: Prescription = {
  items: [
    {
      kind: "main",
      movementId: "m1",
      reps: 5,
      percentTm: 85,
    },
  ],
} as unknown as Prescription;

const set = (overrides: {
  weight_kg?: number;
  reps?: number;
  set_kind?: string;
  rpe?: number | null;
}) => ({
  set_kind: overrides.set_kind ?? "main",
  weight_kg: overrides.weight_kg ?? 100,
  reps: overrides.reps ?? 5,
  rpe: overrides.rpe ?? null,
  movement: mv,
});

describe("countSessionTmAnchoredPrs", () => {
  it("returns 0 when movement has no saved 1RM", () => {
    const n = countSessionTmAnchoredPrs([set({ weight_kg: 200, reps: 1 })], {}, null);
    expect(n).toBe(0);
  });

  it("returns 0 when set is below TM", () => {
    const n = countSessionTmAnchoredPrs(
      [set({ weight_kg: 95, reps: 5 })],
      { back_squat: 140 },
      null,
    );
    expect(n).toBe(0);
  });

  it("counts Weight + e1RM when set beats TM", () => {
    const n = countSessionTmAnchoredPrs(
      [set({ weight_kg: 145, reps: 1 })],
      { back_squat: 140 },
      null,
    );
    expect(n).toBe(2); // Weight PR + e1RM PR (Epley at reps=1 ≈ 149.8)
  });

  it("does NOT count a Rep PR (rep overshoot is not a saved-1RM beat)", () => {
    const n = countSessionTmAnchoredPrs(
      [set({ weight_kg: 100, reps: 10 })],
      { back_squat: 140 },
      prescription5,
    );
    expect(n).toBe(0); // 100 kg is below the 140 TM → no Weight/e1RM PR; Rep PR suppressed
  });

  it("ignores warmup sets", () => {
    const n = countSessionTmAnchoredPrs(
      [set({ weight_kg: 200, reps: 1, set_kind: "warmup" })],
      { back_squat: 140 },
      null,
    );
    expect(n).toBe(0);
  });
});

describe("getSessionTmAnchoredPrSummaries", () => {
  it("emits one summary per movement with PR hits", () => {
    const out = getSessionTmAnchoredPrSummaries(
      [set({ weight_kg: 145, reps: 3 })],
      { back_squat: 140 },
      prescription5,
    );
    expect(out).toHaveLength(1);
    expect(out[0]!.movementId).toBe("m1");
    const kinds = out[0]!.hits.map((h) => h.kind).sort();
    expect(kinds).toContain("weight");
    expect(kinds).toContain("e1rm");
  });

  it("returns nothing when TM is unset", () => {
    const out = getSessionTmAnchoredPrSummaries(
      [set({ weight_kg: 999, reps: 5 })],
      {},
      prescription5,
    );
    expect(out).toEqual([]);
  });

  it("picks heaviest set per movement", () => {
    const out = getSessionTmAnchoredPrSummaries(
      [
        set({ weight_kg: 80, reps: 5 }),
        set({ weight_kg: 145, reps: 1 }),
        set({ weight_kg: 100, reps: 5 }),
      ],
      { back_squat: 140 },
      null,
    );
    expect(out[0]!.bestSet.weight).toBe(145);
  });

  it("never emits a reps_at_weight hit (rep overshoot is not surfaced as a PR)", () => {
    // 100 kg × 10 beats the prescribed 5 reps but is below the 140 TM, so the
    // only candidate hit would be a Rep PR — which we now suppress entirely.
    const out = getSessionTmAnchoredPrSummaries(
      [set({ weight_kg: 100, reps: 10 })],
      { back_squat: 140 },
      prescription5,
    );
    expect(out).toEqual([]);
  });
});
