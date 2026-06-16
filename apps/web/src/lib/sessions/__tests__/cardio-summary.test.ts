import { describe, expect, it } from "vitest";
import {
  cardioKindLabel,
  modalitySupportsPace,
  summariseCardioLogs,
  type CardioLogRow,
} from "../cardio-summary";

function row(overrides: Partial<CardioLogRow> = {}): CardioLogRow {
  return {
    duration_sec: 1680,
    distance_km: 5.298,
    avg_hr_bpm: 152,
    max_hr_bpm: 164,
    avg_pace_sec_per_km: 317,
    hr_zones: null,
    modality: "run",
    inferred_kind: "cardio_z2",
    ...overrides,
  };
}

describe("summariseCardioLogs", () => {
  it("returns null for empty input", () => {
    expect(summariseCardioLogs([])).toBeNull();
    expect(summariseCardioLogs(null)).toBeNull();
  });

  it("passes a single run through with its stored fields", () => {
    const s = summariseCardioLogs([row()])!;
    expect(s.durationSec).toBe(1680);
    expect(s.distanceKm).toBe(5.298);
    expect(s.avgHrBpm).toBe(152);
    expect(s.maxHrBpm).toBe(164);
    expect(s.paceSecPerKm).toBe(317);
    expect(s.modality).toBe("run");
    expect(s.inferredKind).toBe("cardio_z2");
    expect(s.zones).toBeNull();
  });

  it("aggregates multiple blocks: sums, max-HR, duration-weighted avg-HR", () => {
    const s = summariseCardioLogs([
      row({ duration_sec: 600, distance_km: 2, avg_hr_bpm: 120, max_hr_bpm: 140 }),
      row({ duration_sec: 1200, distance_km: 4, avg_hr_bpm: 150, max_hr_bpm: 175 }),
    ])!;
    expect(s.durationSec).toBe(1800);
    expect(s.distanceKm).toBe(6);
    expect(s.maxHrBpm).toBe(175);
    // (120*600 + 150*1200) / 1800 = 140
    expect(s.avgHrBpm).toBe(140);
  });

  it("derives pace from totals when stored paces don't cover full distance", () => {
    const s = summariseCardioLogs([
      row({ duration_sec: 600, distance_km: 2, avg_pace_sec_per_km: null }),
      row({ duration_sec: 1200, distance_km: 4, avg_pace_sec_per_km: null }),
    ])!;
    // 1800s / 6km = 300 s/km
    expect(s.paceSecPerKm).toBe(300);
  });

  it("sums HR zones across blocks and reports null when none present", () => {
    const withZones = summariseCardioLogs([
      row({ hr_zones: { z1: 300, z2: 900, z3: 120 } }),
      row({ hr_zones: { z2: 300, z5: 60 } }),
    ])!;
    expect(withZones.zones).toEqual({ Z1: 300, Z2: 1200, Z3: 120, Z4: 0, Z5: 60 });

    const noZones = summariseCardioLogs([row({ hr_zones: null })])!;
    expect(noZones.zones).toBeNull();
  });

  it("marks modality 'mixed' and kind null when blocks disagree", () => {
    const s = summariseCardioLogs([
      row({ modality: "run", inferred_kind: "cardio_z2" }),
      row({ modality: "bike", inferred_kind: "cardio_threshold" }),
    ])!;
    expect(s.modality).toBe("mixed");
    expect(s.inferredKind).toBeNull();
  });

  it("reports null distance/HR when no block carries them", () => {
    const s = summariseCardioLogs([
      row({ distance_km: null, avg_hr_bpm: null, max_hr_bpm: null, avg_pace_sec_per_km: null }),
    ])!;
    expect(s.distanceKm).toBeNull();
    expect(s.avgHrBpm).toBeNull();
    expect(s.maxHrBpm).toBeNull();
    expect(s.paceSecPerKm).toBeNull();
  });
});

describe("modalitySupportsPace", () => {
  it("is true for foot-based modalities only", () => {
    expect(modalitySupportsPace("run")).toBe(true);
    expect(modalitySupportsPace("walk")).toBe(true);
    expect(modalitySupportsPace("bike")).toBe(false);
    expect(modalitySupportsPace("swim")).toBe(false);
    expect(modalitySupportsPace("mixed")).toBe(false);
  });
});

describe("cardioKindLabel", () => {
  it("maps known kinds and returns null otherwise", () => {
    expect(cardioKindLabel("cardio_z2")).toBe("Easy Z2");
    expect(cardioKindLabel("cardio_vo2")).toBe("VO2 intervals");
    expect(cardioKindLabel(null)).toBeNull();
    expect(cardioKindLabel("cardio_external")).toBeNull();
  });
});
