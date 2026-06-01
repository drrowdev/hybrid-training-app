import { describe, it, expect } from "vitest";
import type { PrescriptionItem } from "@hta/db";
import {
  WORK_SEC_PER_SET,
  estimateSessionSeconds,
  estimateSessionMinutes,
} from "../estimate-duration";

const item = (over: Partial<PrescriptionItem>): PrescriptionItem =>
  ({
    movementId: over.movementId ?? "m",
    kind: over.kind ?? "main",
    ...over,
  }) as PrescriptionItem;

describe("estimate-duration", () => {
  it("returns null for empty / nullish input", () => {
    expect(estimateSessionMinutes([])).toBeNull();
    expect(estimateSessionMinutes(null)).toBeNull();
    expect(estimateSessionMinutes(undefined)).toBeNull();
    expect(estimateSessionSeconds([])).toBe(0);
  });

  it("prices a strength working set as work + kind rest", () => {
    // one main set: WORK_SEC_PER_SET (40) + main rest (180) = 220s
    expect(estimateSessionSeconds([item({ kind: "main", sets: 1 })])).toBe(
      WORK_SEC_PER_SET + 180,
    );
    // accessory item carrying 3 sets: 3 * (40 + 90) = 390s
    expect(
      estimateSessionSeconds([item({ kind: "accessory", sets: 3 })]),
    ).toBe(3 * (WORK_SEC_PER_SET + 90));
  });

  it("is set-count-aware and monotonic (the governor invariant)", () => {
    const base = estimateSessionSeconds([item({ kind: "accessory", sets: 3 })]);
    const more = estimateSessionSeconds([item({ kind: "accessory", sets: 4 })]);
    const moreItems = estimateSessionSeconds([
      item({ kind: "accessory", sets: 3 }),
      item({ kind: "accessory", sets: 3, movementId: "m2" }),
    ]);
    expect(more).toBeGreaterThan(base); // +1 set raises the estimate
    expect(moreItems).toBeGreaterThan(base); // +1 item raises the estimate
  });

  it("defaults missing sets to 1", () => {
    expect(estimateSessionSeconds([item({ kind: "main" })])).toBe(
      WORK_SEC_PER_SET + 180,
    );
  });

  it("sums cardio durationMin and ignores rest for cardio", () => {
    expect(
      estimateSessionMinutes([
        item({ kind: "cardio_z2", durationMin: 45 }),
      ]),
    ).toBe(45);
    // external cardio carries no duration → unknown → null
    expect(
      estimateSessionMinutes([item({ kind: "cardio_external" })]),
    ).toBeNull();
  });

  it("prices isometric holds by hold midpoint, not the per-set default", () => {
    // hold 30–60s midpoint 45 + tendon rest 120 = 165s
    expect(
      estimateSessionSeconds([
        item({ kind: "tendon", sets: 1, holdSec: { min: 30, max: 60 } }),
      ]),
    ).toBe(45 + 120);
  });

  it("charges power-potentiation primers (no rest entry) a non-zero cost", () => {
    expect(
      estimateSessionSeconds([item({ kind: "power_potentiation", sets: 2 })]),
    ).toBe(2 * (WORK_SEC_PER_SET + 90));
  });

  it("estimates a realistic strength+accessory session in a sane band", () => {
    // 3 warmups + 2 mains (3 sets each, as separate items) + 4 accessories×3
    const items: PrescriptionItem[] = [
      ...Array.from({ length: 3 }, (_, i) =>
        item({ kind: "warmup", movementId: `w${i}` }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        item({ kind: "main", sets: 1, movementId: `m${i}` }),
      ),
      ...Array.from({ length: 4 }, (_, i) =>
        item({ kind: "accessory", sets: 3, movementId: `a${i}` }),
      ),
    ];
    const min = estimateSessionMinutes(items);
    expect(min).not.toBeNull();
    expect(min!).toBeGreaterThan(40);
    expect(min!).toBeLessThan(75);
  });
});
