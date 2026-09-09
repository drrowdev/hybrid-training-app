import { describe, expect, it } from "vitest";
import { movementUsesTimedHold } from "./movement-work-identity";

describe("movement work identity", () => {
  it("prescribes a dead hang by elapsed hold time", () => {
    expect(movementUsesTimedHold("dead-hang")).toBe(true);
  });

  it("leaves ordinary accessory movements rep based", () => {
    expect(movementUsesTimedHold("bb-curl")).toBe(false);
    expect(movementUsesTimedHold(undefined)).toBe(false);
  });
});
