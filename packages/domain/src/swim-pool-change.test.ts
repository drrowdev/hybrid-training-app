import { describe, expect, it } from "vitest";
import { poolCourse } from "./swimming";
import { changeSwimLengths, DEFAULT_SWIM_POOL, swimmingPool } from "./swim-pool-change";

const long = poolCourse(50, 1, "m"), short = poolCourse(25, 1, "m");

describe("DC-SW1/DC-SW2 exact pool changes", () => {
  it("defaults new programmes to 50 m and gives an explicit workout choice precedence", () => {
    expect(DEFAULT_SWIM_POOL).toEqual(long);
    expect(swimmingPool(short)).toEqual(short);
    expect(swimmingPool(short, long)).toEqual(long);
    expect(swimmingPool(short, long, short)).toEqual(short);
  });
  it("preserves distance in either direction", () => {
    expect(changeSwimLengths(4, long, short)).toEqual({ ok: true, value: 8 });
    expect(changeSwimLengths(8, short, long)).toEqual({ ok: true, value: 4 });
  });
  it("does not round an incompatible repeat", () => {
    expect(changeSwimLengths(1, short, long)).toMatchObject({ ok: false, error: { code: "distance_not_whole_lengths" } });
  });
  it("distinguishes exact thirds from decimal approximations", () => {
    expect(changeSwimLengths(3, poolCourse(100, 3, "m"), short)).toEqual({ ok: true, value: 4 });
    expect(changeSwimLengths(3, poolCourse(3333, 100, "m"), short).ok).toBe(false);
  });
  it("retains native-yard distance instead of relabelling yards as metres", () => {
    expect(changeSwimLengths(1, poolCourse(25, 1, "yd"), poolCourse(1143, 50, "m"))).toEqual({ ok: true, value: 1 });
    expect(changeSwimLengths(4, poolCourse(25, 1, "yd"), short).ok).toBe(false);
  });
  it("enforces bounds and canonical course identities", () => {
    for (const lengths of [0, -1, 1.5, NaN, 2001]) expect(changeSwimLengths(lengths, long, short).ok).toBe(false);
    expect(changeSwimLengths(2000, long, short)).toMatchObject({ ok: false, error: { code: "lengths_out_of_range" } });
    expect(changeSwimLengths(1, { numerator: 100, denominator: 2, unit: "m" }, short).ok).toBe(false);
  });
});
