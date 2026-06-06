/**
 * Deload-cadence invariants (ADR 0030).
 *
 * Phase 1 replaced the uniform week-4 deload with two loading waves before a
 * single volume-led deload (~6 weeks of accumulation). These tests pin the
 * structural guarantees so the cadence can't silently regress:
 *   - every non-maintenance archetype ends in exactly ONE deload week;
 *   - the block is two identical loading waves + that deload;
 *   - maintenance (no deload) is untouched;
 *   - the expansion is a no-op for deload-free profiles and idempotent in shape.
 */
import { describe, it, expect } from "vitest";
import {
  ARCHETYPES,
  STRENGTH_ANCHOR,
  MAINTENANCE,
  expandToTwoWaves,
  type WeekProfile,
} from "../archetypes";

const NON_MAINTENANCE = Object.values(ARCHETYPES).filter((a) => a.id !== "maintenance");

describe("deload cadence — per-archetype structure", () => {
  it("every non-maintenance archetype ends in exactly one deload week", () => {
    for (const a of NON_MAINTENANCE) {
      const deloads = a.weekProfiles.filter((w) => w.intensityLabel === "Deload");
      expect(deloads.length, `${a.id} deload count`).toBe(1);
      // Deload is the final week.
      expect(deloads[0]!.weekIndex, `${a.id} deload position`).toBe(a.weeks - 1);
      expect(a.weekProfiles[a.weekProfiles.length - 1]!.intensityLabel, `${a.id} last week`).toBe(
        "Deload",
      );
    }
  });

  it("block = two identical loading waves + deload (~6 wk accumulation)", () => {
    for (const a of NON_MAINTENANCE) {
      const build = a.weekProfiles.filter((w) => w.intensityLabel !== "Deload");
      // Even number of build weeks (two waves), deload makes it odd total.
      expect(build.length % 2, `${a.id} build is two equal waves`).toBe(0);
      const half = build.length / 2;
      // The two waves are identical in shape (intensity wave repeats).
      for (let i = 0; i < half; i++) {
        const w1 = build[i]!;
        const w2 = build[i + half]!;
        expect(w2.intensityLabel, `${a.id} wave2 label @${i}`).toBe(w1.intensityLabel);
        expect(w2.setIntensities, `${a.id} wave2 intensities @${i}`).toEqual(w1.setIntensities);
        expect(w2.setReps, `${a.id} wave2 reps @${i}`).toEqual(w1.setReps);
      }
    }
  });

  it("weekIndex is contiguous 0..weeks-1", () => {
    for (const a of Object.values(ARCHETYPES)) {
      a.weekProfiles.forEach((w, i) => {
        expect(w.weekIndex, `${a.id} week ${i}`).toBe(i);
      });
      expect(a.weeks, `${a.id} weeks === profile length`).toBe(a.weekProfiles.length);
    }
  });

  it("standard archetypes now run 6 build weeks + 1 deload = 7 weeks", () => {
    // strength_anchor is the canonical 3-week wave → two waves + deload.
    expect(STRENGTH_ANCHOR.weeks).toBe(7);
    expect(
      STRENGTH_ANCHOR.weekProfiles.filter((w) => w.intensityLabel !== "Deload").length,
    ).toBe(6);
  });

  it("maintenance is unchanged (no deload, two flat weeks)", () => {
    expect(MAINTENANCE.weeks).toBe(2);
    expect(MAINTENANCE.weekProfiles.every((w) => w.intensityLabel !== "Deload")).toBe(true);
  });
});

describe("expandToTwoWaves — pure helper", () => {
  const deloadProfile: WeekProfile = {
    weekIndex: 3,
    setIntensities: [0.4, 0.5, 0.6],
    setReps: 5,
    intensityLabel: "Deload",
    strengthVolumeScale: 0.5,
  };
  const wave: WeekProfile[] = [
    { weekIndex: 0, setIntensities: [0.65], setReps: 5, intensityLabel: "5s" },
    { weekIndex: 1, setIntensities: [0.7], setReps: 3, intensityLabel: "3s" },
    { weekIndex: 2, setIntensities: [0.75], setReps: 1, intensityLabel: "Heavy peak" },
  ];

  it("doubles the build phase and re-appends the deload with contiguous indices", () => {
    const out = expandToTwoWaves([...wave, deloadProfile]);
    expect(out.map((w) => w.intensityLabel)).toEqual([
      "5s",
      "3s",
      "Heavy peak",
      "5s",
      "3s",
      "Heavy peak",
      "Deload",
    ]);
    expect(out.map((w) => w.weekIndex)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(out[6]!.strengthVolumeScale).toBe(0.5);
  });

  it("is a no-op for profiles without a deload week", () => {
    const flat: WeekProfile[] = [
      { weekIndex: 0, setIntensities: [0.6], setReps: 5, intensityLabel: "Maintenance" },
      { weekIndex: 1, setIntensities: [0.6], setReps: 5, intensityLabel: "Maintenance" },
    ];
    expect(expandToTwoWaves(flat)).toEqual(flat);
  });
});
