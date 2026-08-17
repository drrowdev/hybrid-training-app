import { describe, it, expect } from "vitest";
import { zonesFromHistogram, type HrHistogram } from "../hr-histogram";
import type { ZoneBands } from "@/lib/stats/hr-zones";

const BANDS: ZoneBands = { z1Max: 121, z2Max: 142, z3Max: 163, z4Max: 183 };

describe("zonesFromHistogram", () => {
  it("returns null without bands or histogram", () => {
    expect(zonesFromHistogram({ "150": 60 }, null)).toBeNull();
    expect(zonesFromHistogram(null, BANDS)).toBeNull();
    expect(zonesFromHistogram({}, BANDS)).toBeNull();
  });

  it("re-buckets a histogram into zones by the supplied bands", () => {
    const h: HrHistogram = {
      "115": 60, // Z1 (≤121)
      "135": 120, // Z2 (≤142)
      "150": 90, // Z3 (≤163)
      "175": 30, // Z4 (≤183)
      "190": 10, // Z5 (>183)
    };
    expect(zonesFromHistogram(h, BANDS)).toEqual({
      z1: 60,
      z2: 120,
      z3: 90,
      z4: 30,
      z5: 10,
    });
  });

  it("re-bucketing shifts time when bands move (the zone-edit use case)", () => {
    const h: HrHistogram = { "150": 600 };
    // 150 is Z3 under these bands…
    expect(zonesFromHistogram(h, BANDS)).toEqual({ z1: 0, z2: 0, z3: 600, z4: 0, z5: 0 });
    // …but Z2 if the user lowers the Z2 ceiling above 150.
    const wider: ZoneBands = { z1Max: 121, z2Max: 155, z3Max: 170, z4Max: 185 };
    expect(zonesFromHistogram(h, wider)).toEqual({ z1: 0, z2: 600, z3: 0, z4: 0, z5: 0 });
  });

  it("ignores garbage keys/values", () => {
    const h = { abc: 50, "150": 60, "-5": 10, "170": -3 } as unknown as HrHistogram;
    expect(zonesFromHistogram(h, BANDS)).toEqual({ z1: 0, z2: 0, z3: 60, z4: 0, z5: 0 });
  });
});
