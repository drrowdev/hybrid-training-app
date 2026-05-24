import { describe, it, expect } from "vitest";
import { restSecondsForKind } from "../rest";

describe("restSecondsForKind", () => {
  it("returns the per-kind defaults from the logging UX reference doc", () => {
    expect(restSecondsForKind("warmup")).toBe(60);
    expect(restSecondsForKind("main")).toBe(180);
    expect(restSecondsForKind("back_off")).toBe(120);
    expect(restSecondsForKind("accessory")).toBe(90);
    expect(restSecondsForKind("tendon")).toBe(120);
  });

  it("returns 0 for cardio + unknown kinds so the timer doesn't fire", () => {
    expect(restSecondsForKind("cardio_z2")).toBe(0);
    expect(restSecondsForKind("cardio_vo2")).toBe(0);
    expect(restSecondsForKind("cardio_alactic")).toBe(0);
    expect(restSecondsForKind("cardio_threshold")).toBe(0);
  });
});
