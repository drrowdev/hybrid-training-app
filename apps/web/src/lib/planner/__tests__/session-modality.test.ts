import { describe, expect, it } from "vitest";
import {
  classifySessionModality,
  effectiveStressLoad,
  MODALITY_STRESS_MULTIPLIER,
  type ClassifierMovement,
} from "../session-modality";

const main = (
  archetype: ClassifierMovement["archetype"] = "strength_anchor",
  sets = 5,
): ClassifierMovement => ({
  kind: "main",
  archetype,
  bucket: "main",
  estimatedHardSets: sets,
});

const backOff = (sets = 2): ClassifierMovement => ({
  kind: "back_off",
  archetype: "strength_anchor",
  bucket: "back_off",
  estimatedHardSets: sets,
});

const accessory = (sets = 3): ClassifierMovement => ({
  kind: "accessory",
  archetype: "hypertrophy_anchor",
  bucket: "accessory",
  estimatedHardSets: sets,
});

const warmup = (): ClassifierMovement => ({
  kind: "warmup",
  estimatedHardSets: 0,
});

const cardio = (
  mode: "z2" | "hiit" | "mixed",
  durationMinutes: number,
): ClassifierMovement => ({
  kind: "conditioning",
  cardioBlock: { mode, durationMinutes },
  estimatedHardSets: 0,
});

const skill = (nodeDifficulty = 60): ClassifierMovement => ({
  kind: "main",
  archetype: "strength_anchor",
  bucket: "main",
  bw: {
    prescriptionType: "isometric_hold",
    family: "planche",
    nodeDifficulty,
  },
  estimatedHardSets: 4,
});

describe("classifySessionModality — all 7 classes", () => {
  it("restorative: low set count, no mains, no HIIT", () => {
    expect(
      classifySessionModality({
        movements: [warmup(), accessory(2), accessory(1)],
      }),
    ).toBe("restorative");
  });

  it("pure_z2_aerobic: only Z2 cardio", () => {
    expect(
      classifySessionModality({
        movements: [warmup(), cardio("z2", 45)],
      }),
    ).toBe("pure_z2_aerobic");
  });

  it("pure_hiit: only HIIT cardio", () => {
    expect(
      classifySessionModality({
        movements: [cardio("hiit", 20)],
      }),
    ).toBe("pure_hiit");
  });

  it("skill_focused: ≥60% isometric skill nodes, no long cardio", () => {
    expect(
      classifySessionModality({
        movements: [skill(60), skill(70), accessory(2)],
      }),
    ).toBe("skill_focused");
  });

  it("mixed_modal: strength ≥3 sets + cardio ≥10 min", () => {
    expect(
      classifySessionModality({
        movements: [main("strength_anchor", 5), cardio("hiit", 12)],
      }),
    ).toBe("mixed_modal");
  });

  it("pure_strength: all main/back_off strength_anchor, no cardio", () => {
    expect(
      classifySessionModality({
        movements: [warmup(), main("strength_anchor", 5), backOff(2)],
      }),
    ).toBe("pure_strength");
  });

  it("pure_hypertrophy: mains + accessories, no significant cardio", () => {
    expect(
      classifySessionModality({
        movements: [main("hypertrophy_anchor", 4), accessory(3), accessory(3)],
      }),
    ).toBe("pure_hypertrophy");
  });
});

describe("classifySessionModality — edge cases", () => {
  it("short mixed cardio falls back rather than counting as Z2", () => {
    // mode=mixed but duration ≤ 30 min → not pure Z2
    const out = classifySessionModality({
      movements: [cardio("mixed", 20)],
    });
    expect(out).not.toBe("pure_z2_aerobic");
  });

  it("warmup-only session is restorative", () => {
    expect(
      classifySessionModality({
        movements: [warmup(), warmup()],
      }),
    ).toBe("restorative");
  });

  it("mixed_modal wins over pure_strength when cardio is present", () => {
    expect(
      classifySessionModality({
        movements: [
          main("strength_anchor", 5),
          backOff(2),
          cardio("hiit", 10),
        ],
      }),
    ).toBe("mixed_modal");
  });

  it("strength + tiny cardio (<10 min) stays pure_hypertrophy", () => {
    expect(
      classifySessionModality({
        movements: [main("hypertrophy_anchor", 4), cardio("z2", 5)],
      }),
    ).toBe("pure_hypertrophy");
  });

  it("skill-focused with a long cardio block becomes mixed_modal", () => {
    expect(
      classifySessionModality({
        movements: [skill(60), skill(70), cardio("z2", 30)],
      }),
    ).toBe("mixed_modal");
  });
});

describe("effectiveStressLoad", () => {
  it("applies the per-class multiplier", () => {
    expect(effectiveStressLoad({ modality: "mixed_modal", hardSets: 10 })).toBe(
      12.5,
    );
    expect(effectiveStressLoad({ modality: "pure_z2_aerobic", hardSets: 10 })).toBe(
      4.0,
    );
    expect(effectiveStressLoad({ modality: "pure_strength", hardSets: 8 })).toBe(
      8.0,
    );
  });

  it("clamps negative hard sets to zero", () => {
    expect(effectiveStressLoad({ modality: "pure_strength", hardSets: -3 })).toBe(
      0,
    );
  });

  it("multiplier table matches the addendum §6 contract", () => {
    expect(MODALITY_STRESS_MULTIPLIER.mixed_modal).toBe(1.25);
    expect(MODALITY_STRESS_MULTIPLIER.pure_hiit).toBe(1.3);
    expect(MODALITY_STRESS_MULTIPLIER.skill_focused).toBe(1.2);
  });
});
