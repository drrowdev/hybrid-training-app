/**
 * Targeted tests for `formatPrescriptionItem` — the per-set / per-item
 * line renderer used by the plan page and the session log. The
 * accessory branch in particular has multiple sub-paths (rep-based,
 * carry-distance, isometric-hold) that all share the same `sets`
 * field; this file documents each.
 */
import { describe, it, expect } from "vitest";
import { formatPrescriptionItem } from "../archetypes";
import type { PrescriptionItem } from "@hta/db";

function accessory(over: Partial<PrescriptionItem> = {}): PrescriptionItem {
  return {
    movementId: "m",
    movementSlug: "movement",
    movementName: "Movement",
    kind: "accessory",
    sets: 3,
    ...over,
  } as PrescriptionItem;
}

describe("formatPrescriptionItem · accessory branch", () => {
  it("renders rep-based accessory as N × reps", () => {
    expect(formatPrescriptionItem(accessory({ sets: 3, reps: 12 }))).toBe("3 × 12");
  });

  describe("formatPrescriptionItem · tendon/rehab branch", () => {
    it("renders rehab sets and reps without leaking the internal tendon kind", () => {
      expect(
        formatPrescriptionItem({
          movementId: "rehab",
          movementName: "Standing Banded Hip Adduction",
          kind: "tendon",
          sets: 5,
          reps: 15,
        }),
      ).toBe("5 × 15");
    });

    it("renders rehab hold dosage with its set count", () => {
      expect(
        formatPrescriptionItem({
          movementId: "rehab",
          movementName: "Isometric Adduction",
          kind: "tendon",
          sets: 3,
          holdSec: { min: 30, max: 30 },
        }),
      ).toBe("3 × 30s hold");
    });
  });

  it("renders structured set and rep ranges without collapsing to their maxima", () => {
    expect(
      formatPrescriptionItem(
        accessory({
          sets: 5,
          reps: 8,
          setRange: { min: 3, max: 5 },
          repRange: { min: 8, max: 10 },
        }),
      ),
    ).toBe("3–5 × 8–10");
  });

  it("renders a loaded supplemental rep range", () => {
    expect(
      formatPrescriptionItem({
        movementId: "m",
        kind: "back_off",
        sets: 1,
        reps: 8,
        repRange: { min: 8, max: 10 },
        percentTm: 65,
        intensityLabel: "65% 1RM",
      }),
    ).toBe("65% 1RM × 8–10");
  });

  it("renders carry accessory as N × distance, ignoring any tentative reps", () => {
    // The accessory-intensity matrix strips `reps` for carries and
    // writes `distanceM` — but defensively we should still pick
    // distance over reps when both are present (so an upstream bug
    // doesn't bleed reps into the rendered line).
    expect(
      formatPrescriptionItem(
        accessory({
          sets: 2,
          reps: undefined,
          distanceM: { min: 30, max: 30 },
        }),
      ),
    ).toBe("2 × 30 m");
  });

  it("renders carry accessory with a distance range as N × min–max m", () => {
    expect(
      formatPrescriptionItem(
        accessory({
          sets: 3,
          distanceM: { min: 20, max: 30 },
        }),
      ),
    ).toBe("3 × 20–30 m");
  });

  it("renders isometric accessory as N × Xs hold", () => {
    expect(
      formatPrescriptionItem(
        accessory({
          sets: 3,
          reps: undefined,
          holdSec: { min: 30, max: 30 },
        }),
      ),
    ).toBe("3 × 30s hold");
  });

  it("isometric range renders as min–max s hold", () => {
    expect(
      formatPrescriptionItem(
        accessory({
          sets: 2,
          holdSec: { min: 20, max: 30 },
        }),
      ),
    ).toBe("2 × 20–30s hold");
  });

  it("defaults sets to 3 / reps to 10 when missing on a rep-based item", () => {
    expect(formatPrescriptionItem(accessory({ sets: undefined, reps: undefined }))).toBe(
      "3 × 10",
    );
  });

  it("prefers distanceM over reps in the carry case (defensive)", () => {
    // Upstream should never set both; this proves the carry branch
    // wins if it does — so a stray reps field doesn't push a carry
    // into the rep-based renderer.
    expect(
      formatPrescriptionItem(
        accessory({
          sets: 2,
          reps: 10,
          distanceM: { min: 30, max: 30 },
        }),
      ),
    ).toBe("2 × 30 m");
  });
});
