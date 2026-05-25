/**
 * WizardSidebar — bodyweight-aware session meta mapping.
 *
 * Verifies `generalizeMetaForEquipment`:
 *   1. All 9 strength-descriptor inputs swap to the BW variant when
 *      `isBw` is true.
 *   2. Cardio / aerobic descriptors fall through unchanged regardless
 *      of `isBw`.
 *   3. The non-BW default path is untouched (i.e. PR #98's existing
 *      behaviour for barbell / commercial-gym users).
 */
import { describe, it, expect } from "vitest";
import { generalizeMetaForEquipment } from "../WizardSidebar";

describe("generalizeMetaForEquipment — bodyweight overrides", () => {
  const BW_CASES: Array<[string, string]> = [
    ["≥ 95% TM · 1×3-5", "low-RIR top sets · slow eccentrics"],
    ["≥ 90% TM · 2×3", "low-RIR top sets · slow eccentrics"],
    ["≥ 85% TM · 3×5", "moderate-RIR top sets"],
    ["≤ 95% TM · 2×3", "low-RIR top sets"],
    ["≤ 85% TM · 3×5", "moderate-RIR sets · cardio-safe"],
    ["≤ 80% TM · 4×5", "capped intensity · RIR 2+"],
    ["accessory · 3×8-12", "variant pool · moderate RIR"],
    ["HSR · 3×6 @ 6010", "isometric holds + slow eccentrics"],
    ["65–70% TM · 5×5", "sub-maximal sets · long holds"],
    ["60–75% TM · 4×8", "moderate intensity · longer TUT"],
  ];

  it.each(BW_CASES)("maps %j → %j (BW)", (input, expected) => {
    expect(generalizeMetaForEquipment(input, true)).toBe(expected);
  });

  const CARDIO_CASES: string[] = [
    "aerobic base · 60-90 min",
    "recovery between hard sessions · 30-45 min",
    "aerobic floor · 30 min",
    "maintenance dose · 20 min",
    "90–95% HRmax · 5×3'",
    "near-max effort · short finishers",
  ];

  it.each(CARDIO_CASES)("passes cardio descriptor through unchanged (BW): %j", (input) => {
    // BW path falls back to the standard mapping for cardio.
    expect(generalizeMetaForEquipment(input, true)).toBe(
      generalizeMetaForEquipment(input, false),
    );
  });

  it("default (non-BW) path is unchanged: heavy top set wording preserved", () => {
    expect(generalizeMetaForEquipment("≥ 95% TM · 1×3", false)).toBe(
      "heavy top set · few working sets",
    );
    expect(generalizeMetaForEquipment("accessory · 3×10", false)).toBe(
      "moderate weight + accessories",
    );
    expect(generalizeMetaForEquipment("HSR · 3×6 @ 6010", false)).toBe(
      "heavy-slow-resistance + isometric holds",
    );
  });

  it("unknown meta is returned verbatim (both paths)", () => {
    expect(generalizeMetaForEquipment("something custom", true)).toBe("something custom");
    expect(generalizeMetaForEquipment("something custom", false)).toBe("something custom");
  });
});
