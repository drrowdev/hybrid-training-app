/**
 * `resolveLoadIncrement` — the ± weight-stepper increment per movement.
 *
 * The logger used to hard-code 2.5 kg for every implement, which turned a
 * 5.5 kg dumbbell rehab set into an 8 kg one on a single tap.
 */
import { describe, it, expect } from "vitest";
import {
  DUMBBELL_WEIGHT_STEP,
  loadIncrementForRequirement,
  resolveLoadIncrement,
} from "../load-increment";
import { DEFAULT_WEIGHT_STEP } from "@/lib/stats/units";

describe("resolveLoadIncrement", () => {
  it("steps dumbbell movements by 1 kg from the catalog equipment tag", () => {
    // The slug says nothing about the implement — only the tag does.
    expect(
      resolveLoadIncrement({ slug: "hammer-curl", equipment: "dumbbells" }),
    ).toEqual(DUMBBELL_WEIGHT_STEP);
    expect(
      resolveLoadIncrement({ slug: "kroc-row", equipment: "dumbbell-bench" }),
    ).toEqual(DUMBBELL_WEIGHT_STEP);
    expect(
      resolveLoadIncrement({
        slug: "incline-db-curl",
        equipment: "dumbbells-incline-bench",
      }),
    ).toEqual(DUMBBELL_WEIGHT_STEP);
  });

  it("falls back to the slug heuristic when no equipment tag is available", () => {
    // Regression: the rehab movement from the bug report.
    expect(
      resolveLoadIncrement({ slug: "supported-wrist-radial-deviation-db" }),
    ).toEqual(DUMBBELL_WEIGHT_STEP);
    expect(resolveLoadIncrement({ slug: "db-curl-standing" })).toEqual(
      DUMBBELL_WEIGHT_STEP,
    );
    expect(resolveLoadIncrement({ slug: "dumbbell-snatch" })).toEqual(
      DUMBBELL_WEIGHT_STEP,
    );
  });

  it("keeps the 2.5 kg plate default for bars, machines and cables", () => {
    expect(
      resolveLoadIncrement({ slug: "back-squat", equipment: "barbell" }),
    ).toEqual(DEFAULT_WEIGHT_STEP);
    expect(
      resolveLoadIncrement({ slug: "leg-press-45", equipment: "machine-leg-press" }),
    ).toEqual(DEFAULT_WEIGHT_STEP);
    expect(
      resolveLoadIncrement({ slug: "triceps-pushdown", equipment: "cable-rope" }),
    ).toEqual(DEFAULT_WEIGHT_STEP);
    expect(
      resolveLoadIncrement({ slug: "farmer-carry-kb", equipment: "kettlebells" }),
    ).toEqual(DEFAULT_WEIGHT_STEP);
  });

  it("prefers the tag over the slug for either/or implements", () => {
    // `barbell-or-db` resolves to its first-listed implement (barbell), so a
    // Jefferson curl keeps plate-sized jumps.
    expect(
      resolveLoadIncrement({ slug: "jefferson-curl", equipment: "barbell-or-db" }),
    ).toEqual(DEFAULT_WEIGHT_STEP);
    expect(
      resolveLoadIncrement({ slug: "suitcase-carry", equipment: "dumbbell-or-kb" }),
    ).toEqual(DUMBBELL_WEIGHT_STEP);
  });

  it("defaults when nothing identifies the movement", () => {
    expect(resolveLoadIncrement({})).toEqual(DEFAULT_WEIGHT_STEP);
    expect(resolveLoadIncrement({ slug: null, equipment: null })).toEqual(
      DEFAULT_WEIGHT_STEP,
    );
  });

  it("maps only the dumbbell requirement to the fine increment", () => {
    expect(loadIncrementForRequirement({ kind: "dumbbells" })).toEqual(
      DUMBBELL_WEIGHT_STEP,
    );
    expect(loadIncrementForRequirement({ kind: "barbell" })).toEqual(
      DEFAULT_WEIGHT_STEP,
    );
    expect(loadIncrementForRequirement({ kind: "bodyweight_or_generic" })).toEqual(
      DEFAULT_WEIGHT_STEP,
    );
  });
});
