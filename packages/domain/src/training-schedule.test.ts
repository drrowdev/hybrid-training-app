import { describe, expect, it } from "vitest";
import { isPlannedRest } from "./training-schedule";

describe("DC-K3: planned rest identity", () => {
  it("recognizes both stored rest representations without inferring from names", () => {
    expect(isPlannedRest({ role: "rest" })).toBe(true);
    expect(isPlannedRest({ prescription: { kind: "rest" } })).toBe(true);
    expect(isPlannedRest({ role: "primary", prescription: { kind: "strength", title: "Rest day lifting" } })).toBe(false);
    expect(isPlannedRest({ role: null, prescription: null })).toBe(false);
    expect(isPlannedRest({})).toBe(false);
  });
});
