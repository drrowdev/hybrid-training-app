import { describe, it, expect } from "vitest";
import {
  ENGINE_KEY_TO_ROLE,
  ROLE_TO_ENGINE_KEY,
  roleForSlug,
  engineKeyForSlug,
  engineKeysForSlug,
  BODYWEIGHT_ENGINE_KEY_BY_SLUG,
  STATIC_ENGINE_MOVEMENTS,
  STRENGTH_KIND_MAP,
  TM_BASIS_PERCENT_BY_FAMILY,
} from "../movement-keys";

describe("movement-key mapping", () => {
  it("maps engine keys to strength roles and back", () => {
    expect(ENGINE_KEY_TO_ROLE.bench).toBe("horizontal_press");
    expect(ENGINE_KEY_TO_ROLE.press).toBe("vertical_press");
    expect(ROLE_TO_ENGINE_KEY.horizontal_press).toBe("bench");
    expect(ROLE_TO_ENGINE_KEY.vertical_press).toBe("press");
  });

  it("resolves a movement slug to its role and engine key", () => {
    expect(roleForSlug("bench-press-flat")).toBe("horizontal_press");
    expect(roleForSlug("trap-bar-deadlift")).toBe("deadlift");
    expect(roleForSlug("ohp-standing")).toBe("vertical_press");
    expect(engineKeyForSlug("bench-press-flat")).toBe("bench");
    expect(engineKeyForSlug("front-squat")).toBe("squat");
    expect(engineKeyForSlug("not-a-lift")).toBeUndefined();
  });

  it("maps the optional bodyweight pull-up slug to the engine pullup key", () => {
    // The pull-up rides outside the StrengthRole system (it's prescribed off max
    // reps, not a barbell 1RM) and must NOT appear in ENGINE_KEY_TO_ROLE — that
    // keeps it out of the 5/3/1 main-lift set and computeTmAlignment.
    expect(BODYWEIGHT_ENGINE_KEY_BY_SLUG["pull-up-overhand"]).toBe("pullup");
    expect(engineKeyForSlug("pull-up-overhand")).toBe("pullup");
    expect(roleForSlug("pull-up-overhand")).toBeUndefined();
    expect(Object.values(ENGINE_KEY_TO_ROLE)).not.toContain("pullup");
  });

  it("maps Activation catalog movements without losing shared strength roles", () => {
    expect(engineKeyForSlug("bb-row-overhand")).toBe("barbell-row");
    expect(engineKeyForSlug("power-clean")).toBe("power-clean");
    expect(STATIC_ENGINE_MOVEMENTS["ab-triad"]?.slug).toBe("hanging-knee-raise");
    expect(STATIC_ENGINE_MOVEMENTS["hanging-leg-raise"]?.slug).toBe("hanging-leg-raise");
    expect(STATIC_ENGINE_MOVEMENTS["hanging-knee-raise"]?.slug).toBe("hanging-knee-raise");
    expect(STATIC_ENGINE_MOVEMENTS["toes-to-bar"]?.slug).toBe("toes-to-bar");
    expect(STATIC_ENGINE_MOVEMENTS.pullup?.slug).toBe("pull-up-overhand");
    expect(STATIC_ENGINE_MOVEMENTS["reverse-hyper"]?.slug).toBe("reverse-hyper");
    expect(engineKeysForSlug("push-press")).toEqual(["push-press"]);
    expect(engineKeysForSlug("rack-pull")).toEqual(["rack-pull"]);
    // Rack pull and block pull are separate catalog movements (migration 0132).
    // Block Pull Deadlift owns no engine key of its own, so it falls back to the
    // broad deadlift role — a rack-pull 1RM can no longer re-anchor the lifter's
    // Deadlift, and a genuine block-pull 1RM is no longer read as a rack pull.
    expect(engineKeysForSlug("block-pull-deadlift")).toEqual(["deadlift"]);
    expect(roleForSlug("block-pull-deadlift")).toBe("deadlift");
    expect(roleForSlug("rack-pull")).toBeUndefined();
    expect(engineKeysForSlug("push-up")).toEqual(
      expect.arrayContaining(["pushup", "plyo-pushup"]),
    );
  });

  it("maps the strength item kinds the platform materialises", () => {
    expect(STRENGTH_KIND_MAP.main).toBe("main");
    expect(STRENGTH_KIND_MAP.amrap).toBe("main");
    expect(STRENGTH_KIND_MAP.supplemental).toBe("back_off");
    expect(STRENGTH_KIND_MAP.assistance).toBe("accessory");
    expect(STRENGTH_KIND_MAP.cardio).toBeUndefined();
  });

  it("records the Option-A TM basis per program family", () => {
    expect(TM_BASIS_PERCENT_BY_FAMILY["531"]).toBe(85);
    expect(TM_BASIS_PERCENT_BY_FAMILY["tactical-barbell"]).toBe(100);
  });
});
