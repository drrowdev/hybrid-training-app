import { describe, expect, it } from "vitest";
import { catalogMovementLoadKind } from "../custom-movement-kind";

describe("catalogMovementLoadKind", () => {
  it("uses system-load maths for a bodyweight-loadable movement with a max", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: true, isLoadable: true }),
    ).toBe("weighted-bw");
  });

  it("uses ordinary percentage maths for a non-loadable movement with a max", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: true, isLoadable: false }),
    ).toBe("barbell");
  });

  it("leaves a catalog movement without a max unanchored", () => {
    expect(
      catalogMovementLoadKind({ hasOneRm: false, isLoadable: true }),
    ).toBe("unanchored");
  });
});
