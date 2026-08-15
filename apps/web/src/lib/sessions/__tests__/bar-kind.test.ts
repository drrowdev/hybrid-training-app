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
