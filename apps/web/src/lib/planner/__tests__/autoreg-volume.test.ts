import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  applyAutoregVolumeScale,
  autoregScaleForBand,
  hasDiscretionaryVolume,
  AUTOREG_VOLUME_SCALE_OVER,
  AUTOREG_VOLUME_SCALE_WAYOVER,
} from "../autoreg-volume";

function item(over: Partial<PrescriptionItem> & { movementId: string }): PrescriptionItem {
  return { kind: "accessory", sets: 3, reps: 10, ...over };
}

function rx(items: PrescriptionItem[], autoregVolumeScale?: number): Prescription {
  return autoregVolumeScale == null
    ? { items }
    : { items, autoregVolumeScale };
}

describe("autoregScaleForBand", () => {
  it("maps over / way-over to their scales and everything else to null", () => {
    expect(autoregScaleForBand("over")).toBe(AUTOREG_VOLUME_SCALE_OVER);
    expect(autoregScaleForBand("way-over")).toBe(AUTOREG_VOLUME_SCALE_WAYOVER);
    expect(autoregScaleForBand("under")).toBeNull();
    expect(autoregScaleForBand("on-budget")).toBeNull();
    expect(autoregScaleForBand("at-line")).toBeNull();
  });
});

describe("applyAutoregVolumeScale — parity (regression invariant)", () => {
  it("returns the prescription unchanged when no scale is set", () => {
    const p = rx([
      item({ movementId: "main", kind: "main" }),
      item({ movementId: "acc1" }),
      item({ movementId: "acc2" }),
    ]);
    expect(applyAutoregVolumeScale(p)).toBe(p);
  });

  it("is a no-op when scale >= 1", () => {
    const p = rx([item({ movementId: "acc1" })], 1);
    expect(applyAutoregVolumeScale(p)).toBe(p);
  });

  it("is a no-op when there are no discretionary items", () => {
    const p = rx(
      [
        item({ movementId: "main", kind: "main" }),
        item({ movementId: "warm", kind: "warmup" }),
      ],
      0.5,
    );
    expect(applyAutoregVolumeScale(p)).toBe(p);
  });
});

describe("applyAutoregVolumeScale — trim behaviour", () => {
  it("trims discretionary items from the end and never touches mains", () => {
    const p = rx(
      [
        item({ movementId: "main", kind: "main" }),
        item({ movementId: "back", kind: "back_off" }),
        item({ movementId: "acc1" }),
        item({ movementId: "acc2" }),
        item({ movementId: "acc3" }),
        item({ movementId: "acc4" }),
      ],
      0.8, // keep round(4 * 0.8) = 3 discretionary
    );
    const out = applyAutoregVolumeScale(p);
    const ids = out.items.map((i) => i.movementId);
    expect(ids).toEqual(["main", "back", "acc1", "acc2", "acc3"]);
    // mains/back-off always survive
    expect(out.items.filter((i) => i.kind === "main")).toHaveLength(1);
    expect(out.items.filter((i) => i.kind === "back_off")).toHaveLength(1);
  });

  it("trims tendon and power_potentiation too, preserving relative order", () => {
    const p = rx(
      [
        item({ movementId: "main", kind: "main" }),
        item({ movementId: "pp", kind: "power_potentiation" }),
        item({ movementId: "acc1", kind: "accessory" }),
        item({ movementId: "ten", kind: "tendon" }),
      ],
      0.66, // keep round(3 * 0.66) = 2 discretionary
    );
    const out = applyAutoregVolumeScale(p);
    expect(out.items.map((i) => i.movementId)).toEqual(["main", "pp", "acc1"]);
  });

  it("keeps cardio items untouched", () => {
    const p = rx(
      [
        item({ movementId: "z2", kind: "cardio_z2" }),
        item({ movementId: "acc1" }),
        item({ movementId: "acc2" }),
      ],
      0.5, // keep round(2 * 0.5) = 1
    );
    const out = applyAutoregVolumeScale(p);
    expect(out.items.map((i) => i.movementId)).toEqual(["z2", "acc1"]);
  });
});

describe("hasDiscretionaryVolume", () => {
  it("is true only when a trimmable kind is present", () => {
    expect(hasDiscretionaryVolume(rx([item({ movementId: "acc1" })]))).toBe(true);
    expect(
      hasDiscretionaryVolume(rx([item({ movementId: "m", kind: "main" })])),
    ).toBe(false);
    expect(
      hasDiscretionaryVolume(rx([item({ movementId: "z2", kind: "cardio_z2" })])),
    ).toBe(false);
  });
});
