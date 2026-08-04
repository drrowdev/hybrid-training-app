import { describe, expect, it } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import { renderTargetLine } from "../MovementFocusView";

function item(over: Partial<PrescriptionItem>): PrescriptionItem {
  return {
    movementId: "movement",
    kind: "back_off",
    sets: 1,
    reps: 8,
    ...over,
  };
}

describe("MovementFocusView target line", () => {
  it("renders a structured supplemental rep range", () => {
    expect(
      renderTargetLine(
        item({ repRange: { min: 8, max: 10 } }),
        8,
        false,
      ),
    ).toBe("× 8–10 reps");
  });

  it("surfaces the bodyweight max-reps allowance", () => {
    expect(
      renderTargetLine(
        item({
          repRange: { min: 8, max: 10 },
          notes:
            "8–10 · Supplemental — 3–5 sets of 8–10; max reps may be used for bodyweight work.",
        }),
        8,
        false,
      ),
    ).toBe("× 8–10 reps · max reps allowed");
  });
});
