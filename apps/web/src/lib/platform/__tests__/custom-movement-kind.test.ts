import { describe, expect, it } from "vitest";
import { catalogMovementLoadKind } from "../custom-movement-kind";

describe("catalogMovementLoadKind", () => {
  it("DC-K4: uses system-load maths only for a movement whose max includes bodyweight", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: true, slug: "weighted-pull-up" }),
    ).toBe("weighted-bw");
  });

  it("DC-K4: a bodyweight-capable movement with a kg max is an ordinary percentage", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: true, slug: "forward-lunge" }),
    ).toBe("barbell");
  });

  it("DC-K4: a movement whose max is a rep count is not loaded from a percentage", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: true, slug: "pull-up-overhand" }),
    ).toBe("bodyweight");
  });

  it("leaves a catalog movement without a max unanchored", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: false, slug: "weighted-pull-up" }),
    ).toBe("unanchored");
  });
});
