import { describe, expect, it } from "vitest";
import { resolvePrescriptionSetWork } from "./prescription-set-work";

describe("resolvePrescriptionSetWork", () => {
  it("materializes rep-based rehab without inventing external load", () => {
    expect(resolvePrescriptionSetWork({ reps: 15 })).toEqual({
      reps: 15,
      durationSec: null,
      distanceM: null,
    });
  });

  it("materializes hold and distance prescriptions at the logger midpoint", () => {
    expect(
      resolvePrescriptionSetWork({
        holdSec: { min: 30, max: 40 },
      }),
    ).toEqual({ reps: null, durationSec: 35, distanceM: null });
    expect(
      resolvePrescriptionSetWork({
        distanceM: { min: 20, max: 30 },
      }),
    ).toEqual({ reps: null, durationSec: null, distanceM: 25 });
  });

  it("supports bodyweight isometric prescriptions without a top-level hold", () => {
    expect(
      resolvePrescriptionSetWork({
        bw: {
          prescriptionType: "isometric_hold",
          holdSeconds: 30,
        },
      }),
    ).toEqual({ reps: null, durationSec: 30, distanceM: null });
  });
});
