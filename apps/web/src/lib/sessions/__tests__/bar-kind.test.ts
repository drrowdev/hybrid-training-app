import { describe, expect, it } from "vitest";
import {
  BODYWEIGHT_ONLY_PRESET,
  COMMERCIAL_GYM_PRESET,
  CUSTOM_EMPTY_PRESET,
  FUNCTIONAL_GYM_PRESET,
  HOME_GYM_PRESET,
  TRAVEL_HOTEL_PRESET,
} from "@/lib/settings/equipment-presets";
import { resolveBarKind, resolveBarWeightKg } from "../bar-kind";

describe("resolveBarWeightKg", () => {
  it("returns the barbell mass for straight-bar movements", () => {
    expect(
      resolveBarWeightKg("barbell_back_squat", COMMERCIAL_GYM_PRESET.bars),
    ).toBe(20);
    expect(
      resolveBarWeightKg("barbell_bench_press", HOME_GYM_PRESET.bars),
    ).toBe(20);
  });

  it("returns the trap-bar mass only when the user owns a trap bar", () => {
    expect(resolveBarKind("trap_bar_deadlift")).toBe("trap_bar");
    expect(
      resolveBarWeightKg("trap_bar_deadlift", COMMERCIAL_GYM_PRESET.bars),
    ).toBe(25);
  });

  it("returns null for a trap-bar lift when trapBarKg is null (home / functional / custom)", () => {
    // `trapBarKg: null` is the canonical "no such bar" signal — coercing it
    // to 25 makes the focus view floor a warm-up to a bar the user does not
    // own, and diverge from what fillSessionFromPlan persists.
    for (const preset of [
      HOME_GYM_PRESET,
      FUNCTIONAL_GYM_PRESET,
      CUSTOM_EMPTY_PRESET,
    ]) {
      expect(preset.bars.trapBarKg).toBeNull();
      expect(resolveBarWeightKg("trap_bar_deadlift", preset.bars)).toBeNull();
    }
  });

  it("returns null for barbell lifts when barbellKg is 0 (travel / bodyweight-only)", () => {
    for (const preset of [TRAVEL_HOTEL_PRESET, BODYWEIGHT_ONLY_PRESET]) {
      expect(preset.bars.barbellKg).toBe(0);
      expect(resolveBarWeightKg("barbell_back_squat", preset.bars)).toBeNull();
      expect(resolveBarWeightKg("trap_bar_deadlift", preset.bars)).toBeNull();
    }
  });

  it("returns null for movements that are not loaded on a bar", () => {
    expect(resolveBarKind("dumbbell_bench_press")).toBeNull();
    expect(
      resolveBarWeightKg("dumbbell_bench_press", COMMERCIAL_GYM_PRESET.bars),
    ).toBeNull();
    expect(resolveBarWeightKg(undefined, COMMERCIAL_GYM_PRESET.bars)).toBeNull();
  });

  it("treats missing / non-finite inventory entries as no bar", () => {
    expect(resolveBarWeightKg("barbell_back_squat", {})).toBeNull();
    expect(
      resolveBarWeightKg("barbell_back_squat", { barbellKg: Number.NaN }),
    ).toBeNull();
    expect(
      resolveBarWeightKg("trap_bar_deadlift", { trapBarKg: undefined }),
    ).toBeNull();
  });
});

describe("resolveBarWeightKg — safety squat bar", () => {
  it("uses the SAFETY-bar mass, not the straight-bar mass", () => {
    // `ssb-squat` is a real catalog movement (`equipment: "barbell-ssb"`).
    // It used to fall through to `barbellKg`, so every warm-up load and plate
    // count for the lift was computed against a 20 kg bar instead of the
    // 25 kg SSB the lifter actually owns.
    expect(resolveBarKind("ssb-squat")).toBe("safety_bar");
    expect(COMMERCIAL_GYM_PRESET.bars.safetyBarKg).toBe(25);
    expect(resolveBarWeightKg("ssb-squat", COMMERCIAL_GYM_PRESET.bars)).toBe(25);
    // The straight-bar mass differs, so a regression is observable.
    expect(COMMERCIAL_GYM_PRESET.bars.barbellKg).toBe(20);
  });

  it("matches the same tokens the equipment-requirement heuristic uses", () => {
    for (const slug of [
      "ssb-squat",
      "ssb_squat",
      "safety-squat-bar-squat",
      "safety_squat_bar_good_morning",
      "front-ssb-squat",
    ]) {
      expect(resolveBarKind(slug)).toBe("safety_bar");
    }
  });

  it("does not misread an unrelated slug that merely contains those letters", () => {
    // Anchored on a separator, so no bare-substring false positives.
    expect(resolveBarKind("barbell_back_squat")).toBe("barbell");
    expect(resolveBarKind("kossberg-press")).toBe("barbell");
  });

  it("returns null when the user owns no safety bar", () => {
    for (const preset of [
      HOME_GYM_PRESET,
      FUNCTIONAL_GYM_PRESET,
      CUSTOM_EMPTY_PRESET,
    ]) {
      expect(preset.bars.safetyBarKg).toBeNull();
      expect(resolveBarWeightKg("ssb-squat", preset.bars)).toBeNull();
    }
    expect(resolveBarWeightKg("ssb-squat", { safetyBarKg: undefined })).toBeNull();
  });
});
