import { describe, it, expect } from "vitest";
import { restSecondsForKind, restSecondsForSet } from "../rest";

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

describe("restSecondsForSet — the lifter's opt-out", () => {
  it("keeps the per-kind default when the timer is on", () => {
    expect(restSecondsForSet("main", { restTimerEnabled: true })).toBe(180);
    expect(restSecondsForSet("accessory", { restTimerEnabled: true })).toBe(90);
  });

  it("returns 0 for every kind when the timer is off", () => {
    // 0 is the state the callers already handle: RestTimer documents
    // `seconds=0` as "render nothing", and each logger guards on `secs > 0`
    // before arming a deadline. Same state a superset produces mid-round.
    for (const kind of ["warmup", "main", "back_off", "accessory", "tendon"] as const) {
      expect(restSecondsForSet(kind, { restTimerEnabled: false })).toBe(0);
    }
  });

  it("still returns 0 for cardio when enabled, so the flag adds no timer", () => {
    expect(restSecondsForSet("cardio_z2", { restTimerEnabled: true })).toBe(0);
  });

  it("leaves restSecondsForKind pure — the flag lives only in the wrapper", () => {
    expect(restSecondsForKind("main")).toBe(180);
  });
});
