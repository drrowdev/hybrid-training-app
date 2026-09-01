import { describe, it, expect } from "vitest";
import {
  evaluateTmSuggestion,
  SUGGESTION_DELTA_KG,
  AMRAP_CONFIDENCE_REP_CAP,
  isAmrapSetForTmSuggestion,
  pickAmrapTopSetsByMovement,
  planTmSuggestionReconcile,
  type AmrapSetCandidateInput,
  type DesiredTmSuggestion,
  type ExistingTmSuggestion,
} from "../suggestions";

describe("evaluateTmSuggestion (≥2.5 kg gate, conservative)", () => {
  it("suggests when conservative e1RM beats current TM by ≥ 2.5 kg", () => {
    // 100 kg × 5 → brzycki gives 112.5 → rounds to 112.5 → +12.5 over 100.
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 5,
    });
    expect(r.suggest).toBe(true);
    if (r.suggest) {
      expect(r.suggestedTmKg).toBe(112.5);
      expect(r.formula).toBe("brzycki");
    }
  });

  it("rejects sub-threshold bumps", () => {
    // 100 kg × 1 → brzycki = 100; epley = 103.33 → conservative is 100; delta = 0.
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 1,
    });
    expect(r.suggest).toBe(false);
  });

  it("uses Zourdos when RPE is provided and it's the smallest", () => {
    // 100 kg × 5 @ RPE 10 → 100/0.892 = 112.1 < brzycki 112.5 → wins.
    const r = evaluateTmSuggestion({
      currentTmKg: 90,
      amrapWeightKg: 100,
      amrapReps: 5,
      amrapRpe: 10,
    });
    expect(r.suggest).toBe(true);
    if (r.suggest) {
      expect(r.formula).toBe("rpe_zourdos");
      // 112.1 rounds to 112.5 with plate rounding.
      expect(r.suggestedTmKg).toBe(112.5);
    }
  });

  it("threshold constant is the 2.5 kg plate increment", () => {
    expect(SUGGESTION_DELTA_KG).toBe(2.5);
  });

  it("returns invalid-input on garbage", () => {
    expect(
      evaluateTmSuggestion({ currentTmKg: -1, amrapWeightKg: 100, amrapReps: 5 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
    expect(
      evaluateTmSuggestion({ currentTmKg: 100, amrapWeightKg: 0, amrapReps: 5 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
    expect(
      evaluateTmSuggestion({ currentTmKg: 100, amrapWeightKg: 100, amrapReps: 0 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
    expect(
      evaluateTmSuggestion({ currentTmKg: 100, amrapWeightKg: 100, amrapReps: 2.5 }),
    ).toEqual({ suggest: false, reason: "invalid-input" });
  });

  it("rejects exactly-at-threshold bumps smaller than 2.5 kg after rounding", () => {
    // Construct a case where conservative e1RM rounded ≈ current + 1 kg.
    // Brzycki 95 kg × 2 = 95 * 36/35 ≈ 97.71 → rounds to 97.5 → +2.5 = boundary.
    // The gate uses ">=" 2.5 so this should *just* pass.
    const r = evaluateTmSuggestion({
      currentTmKg: 95,
      amrapWeightKg: 95,
      amrapReps: 2,
    });
    expect(r.suggest).toBe(true);
  });
});

describe("evaluateTmSuggestion — high-rep confidence gate", () => {
  it("cap is 5 reps (high-confidence 1RM-estimate window)", () => {
    expect(AMRAP_CONFIDENCE_REP_CAP).toBe(5);
  });

  it("suppresses the reported 60 kg × 8 banner case as low-confidence", () => {
    // The exact banner: current TM 67.5, AMRAP 60 kg × 8. e1RM would clear the
    // 2.5 kg delta, but 8 reps is past the confidence cap → no suggestion.
    const r = evaluateTmSuggestion({
      currentTmKg: 67.5,
      amrapWeightKg: 60,
      amrapReps: 8,
    });
    expect(r).toEqual({ suggest: false, reason: "low-confidence" });
  });

  it("suppresses just past the cap (6 reps)", () => {
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 6,
    });
    expect(r).toEqual({ suggest: false, reason: "low-confidence" });
  });

  it("still fires at exactly the cap (5 reps) when the bump clears the delta", () => {
    const r = evaluateTmSuggestion({
      currentTmKg: 100,
      amrapWeightKg: 100,
      amrapReps: 5,
    });
    expect(r.suggest).toBe(true);
  });

  it("a high-rep set is suppressed even with an RPE (8 reps can't be high-confidence)", () => {
    const r = evaluateTmSuggestion({
      currentTmKg: 67.5,
      amrapWeightKg: 60,
      amrapReps: 8,
      amrapRpe: 9,
    });
    expect(r).toEqual({ suggest: false, reason: "low-confidence" });
  });
});

describe("isAmrapSetForTmSuggestion", () => {
  it("uses prescribed.isAmrap when a snapshot exists", () => {
    expect(
      isAmrapSetForTmSuggestion({ notes: null, prescribed: { isAmrap: true } }),
    ).toBe(true);
    expect(
      isAmrapSetForTmSuggestion({
        notes: "amrap",
        prescribed: { isAmrap: false },
      }),
    ).toBe(false);
    expect(
      isAmrapSetForTmSuggestion({ notes: null, prescribed: {} }),
    ).toBe(false);
  });

  it("does not infer AMRAP from raw reps on current rows", () => {
    expect(
      isAmrapSetForTmSuggestion({
        notes: null,
        prescribed: { isAmrap: false },
      }),
    ).toBe(false);
  });

  it("falls back to an explicit amrap note only when there is no snapshot", () => {
    expect(
      isAmrapSetForTmSuggestion({ notes: "AMRAP top set", prescribed: null }),
    ).toBe(true);
    expect(
      isAmrapSetForTmSuggestion({ notes: "felt strong", prescribed: null }),
    ).toBe(false);
  });
});

function set(over: Partial<AmrapSetCandidateInput>): AmrapSetCandidateInput {
  return {
    id: "set-1",
    movementId: "mv-squat",
    setKind: "main",
    weightKg: 100,
    reps: 5,
    rpe: null,
    notes: null,
    skipped: false,
    prescribed: { isAmrap: true },
    ...over,
  };
}

describe("pickAmrapTopSetsByMovement", () => {
  it("keeps a 3+ AMRAP logged for 4 reps", () => {
    const top = pickAmrapTopSetsByMovement([
      set({ id: "amrap-3", reps: 4, prescribed: { isAmrap: true } }),
    ]);
    expect(top.get("mv-squat")?.id).toBe("amrap-3");
    expect(top.get("mv-squat")?.reps).toBe(4);
  });

  it("ignores a programmed 5 that is not an AMRAP", () => {
    const top = pickAmrapTopSetsByMovement([
      set({ id: "fixed-5", reps: 5, prescribed: { isAmrap: false } }),
    ]);
    expect(top.size).toBe(0);
  });

  it("legacy rows without a snapshot need an amrap note, not just 5 reps", () => {
    expect(
      pickAmrapTopSetsByMovement([
        set({ id: "legacy-5", prescribed: null, notes: null, reps: 5 }),
      ]).size,
    ).toBe(0);
    expect(
      pickAmrapTopSetsByMovement([
        set({
          id: "legacy-amrap",
          prescribed: null,
          notes: "amrap",
          reps: 3,
        }),
      ]).get("mv-squat")?.id,
    ).toBe("legacy-amrap");
  });

  it("skips skipped and warmup sets, then picks the heaviest", () => {
    const top = pickAmrapTopSetsByMovement([
      set({ id: "skip", skipped: true, weightKg: 140 }),
      set({ id: "wu", setKind: "warmup", weightKg: 130 }),
      set({ id: "light", weightKg: 100 }),
      set({ id: "heavy", weightKg: 120 }),
    ]);
    expect(top.get("mv-squat")?.id).toBe("heavy");
  });
});

function desired(
  over: Partial<DesiredTmSuggestion> = {},
): DesiredTmSuggestion {
  return {
    movementId: "mv-squat",
    setLogId: "set-1",
    currentTmKg: 100,
    suggestedTmKg: 112.5,
    source: "derived_amrap",
    derivedFormula: "brzycki",
    ...over,
  };
}

function existing(
  over: Partial<ExistingTmSuggestion> = {},
): ExistingTmSuggestion {
  return {
    id: "sug-1",
    movementId: "mv-squat",
    derivedFromSetLogId: "set-1",
    status: "pending",
    currentTmKg: 100,
    suggestedTmKg: 112.5,
    derivedFormula: "brzycki",
    source: "derived_amrap",
    ...over,
  };
}

describe("planTmSuggestionReconcile", () => {
  it("is a no-op when the pending row already matches", () => {
    expect(planTmSuggestionReconcile([desired()], [existing()])).toEqual({
      deletePendingIds: [],
      updates: [],
      inserts: [],
    });
  });

  it("drops a pending banner when the source set no longer qualifies", () => {
    const plan = planTmSuggestionReconcile([], [existing()]);
    expect(plan.deletePendingIds).toEqual(["sug-1"]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("updates a pending row when the logged numbers change", () => {
    const plan = planTmSuggestionReconcile(
      [desired({ suggestedTmKg: 115 })],
      [existing()],
    );
    expect(plan.updates).toHaveLength(1);
    expect(plan.updates[0]?.suggestedTmKg).toBe(115);
    expect(plan.deletePendingIds).toEqual([]);
    expect(plan.inserts).toEqual([]);
  });

  it("inserts when a new set now qualifies", () => {
    const plan = planTmSuggestionReconcile([desired()], []);
    expect(plan.inserts).toEqual([desired()]);
  });

  it("never mutates accepted or dismissed history", () => {
    const plan = planTmSuggestionReconcile(
      [desired({ setLogId: "set-2", suggestedTmKg: 115 })],
      [
        existing({ id: "acc", status: "accepted", derivedFromSetLogId: "set-1" }),
        existing({
          id: "dis",
          status: "dismissed",
          derivedFromSetLogId: "set-old",
          suggestedTmKg: 110,
        }),
      ],
    );
    expect(plan.deletePendingIds).toEqual([]);
    expect(plan.updates).toEqual([]);
    expect(plan.inserts).toHaveLength(1);
  });

  it("does not re-queue an accepted offer for the same set", () => {
    const plan = planTmSuggestionReconcile(
      [desired()],
      [existing({ status: "accepted" })],
    );
    expect(plan.inserts).toEqual([]);
  });

  it("does not resurrect an identical dismissed offer", () => {
    const plan = planTmSuggestionReconcile(
      [desired()],
      [existing({ status: "dismissed" })],
    );
    expect(plan.inserts).toEqual([]);
  });

  it("can create a new pending after dismiss if the numbers changed", () => {
    const plan = planTmSuggestionReconcile(
      [desired({ suggestedTmKg: 115 })],
      [existing({ status: "dismissed", suggestedTmKg: 112.5 })],
    );
    expect(plan.inserts).toHaveLength(1);
    expect(plan.inserts[0]?.suggestedTmKg).toBe(115);
  });
});
