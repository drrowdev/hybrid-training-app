import { describe, it, expect } from "vitest";
import type { Prescription, PrescriptionItem } from "@hta/db";
import {
  applyAutoregVolumeScale,
  autoregScaleForBand,
  hasDiscretionaryVolume,
  previewAutoregTrim,
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

describe("previewAutoregTrim", () => {
  it("reports per-movement before -> after for the accessories that lose sets", () => {
    const p = rx([
      item({ movementId: "main", kind: "main", movementName: "Bench" }),
      item({ movementId: "pd1", movementName: "Pushdown" }),
      item({ movementId: "pd2", movementName: "Pushdown" }),
      item({ movementId: "pd3", movementName: "Pushdown" }),
      item({ movementId: "lr1", movementName: "Lateral raise" }),
      item({ movementId: "lr2", movementName: "Lateral raise" }),
    ]);
    // 5 discretionary, scale 0.8 -> keep round(5*0.8)=4 -> drop 1 from the end.
    const changes = previewAutoregTrim(p, 0.8);
    expect(changes).toEqual([{ name: "Lateral raise", before: 2, after: 1 }]);
  });

  it("omits movements that don't change and the protected mains", () => {
    const p = rx([
      item({ movementId: "main", kind: "main", movementName: "Squat" }),
      item({ movementId: "a1", movementName: "Curl" }),
      item({ movementId: "a2", movementName: "Curl" }),
    ]);
    // 2 discretionary, scale 0.5 -> keep 1 -> Curl 2 -> 1.
    expect(previewAutoregTrim(p, 0.5)).toEqual([
      { name: "Curl", before: 2, after: 1 },
    ]);
  });

  it("returns [] when nothing is trimmed (scale >= 1 or no discretionary)", () => {
    expect(previewAutoregTrim(rx([item({ movementId: "a1", movementName: "Curl" })]), 1)).toEqual([]);
    expect(
      previewAutoregTrim(rx([item({ movementId: "m", kind: "main", movementName: "Bench" })]), 0.5),
    ).toEqual([]);
  });
});
