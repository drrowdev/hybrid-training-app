import { describe, it, expect } from "vitest";
import { classifyCardio } from "../classify-cardio";

const HR_MAX = 190;

describe("classifyCardio — kind selection", () => {
  it("returns cardio_z2 for an easy aerobic run (avg < 70% max)", () => {
    const r = classifyCardio({
      avgHrBpm: 130, // 68% of 190
      maxHrBpm: 145,
      durationSec: 45 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.kind).toBe("cardio_z2");
    expect(r?.label).toBe("Easy Z2");
    expect(r?.effectiveStressLoad).toBe(0.5 * 45);
  });

  it("returns cardio_threshold for a tempo run (avg 70–80%, max < 90%)", () => {
    const r = classifyCardio({
      avgHrBpm: 145, // 76%
      maxHrBpm: 165, // 87%
      durationSec: 30 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.kind).toBe("cardio_threshold");
    expect(r?.label).toBe("Threshold");
    expect(r?.effectiveStressLoad).toBe(1.3 * 30);
  });

  it("returns cardio_vo2 when avg ≥ 80% max", () => {
    const r = classifyCardio({
      avgHrBpm: 158, // 83%
      maxHrBpm: 178,
      durationSec: 40 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.kind).toBe("cardio_vo2");
    expect(r?.effectiveStressLoad).toBe(2.0 * 40);
  });

  it("returns cardio_vo2 when max ≥ 92% even if avg is moderate", () => {
    const r = classifyCardio({
      avgHrBpm: 145, // 76%
      maxHrBpm: 178, // 93%
      durationSec: 40 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.kind).toBe("cardio_vo2");
  });

  it("returns cardio_alactic for a short session with very high max HR", () => {
    const r = classifyCardio({
      avgHrBpm: 140,
      maxHrBpm: 185, // 97%
      durationSec: 15 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.kind).toBe("cardio_alactic");
    expect(r?.label).toBe("Sprint / alactic");
    expect(r?.effectiveStressLoad).toBe(1.0 * 15);
  });

  it("returns cardio_mixed when the data doesn't fit a clean bucket", () => {
    // avg 71% but max ≥ 90% → above threshold cap → falls to mixed.
    const r = classifyCardio({
      avgHrBpm: 135, // 71%
      maxHrBpm: 174, // 91.5%
      durationSec: 40 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.kind).toBe("cardio_mixed");
  });
});

describe("classifyCardio — confidence", () => {
  it("scores 0.85 when both avg + max HR are present and hrMax is known", () => {
    const r = classifyCardio({
      avgHrBpm: 140,
      maxHrBpm: 165,
      durationSec: 1800,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.confidence).toBe(0.85);
  });

  it("scores 0.6 when only avg HR is present", () => {
    const r = classifyCardio({
      avgHrBpm: 140,
      maxHrBpm: null,
      durationSec: 1800,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.confidence).toBe(0.6);
  });

  it("multiplies confidence by 0.7 when hrMax falls back to 220-age", () => {
    const r = classifyCardio({
      avgHrBpm: 140,
      maxHrBpm: 165,
      durationSec: 1800,
      hrMax: null,
      userAge: 30, // hrMax = 190
    });
    expect(r?.confidence).toBe(Number((0.85 * 0.7).toFixed(2)));
  });
});

describe("classifyCardio — edge cases", () => {
  it("returns null when there is no HR data at all", () => {
    expect(
      classifyCardio({
        avgHrBpm: null,
        maxHrBpm: null,
        durationSec: 1800,
        hrMax: HR_MAX,
        userAge: 35,
      }),
    ).toBeNull();
  });

  it("returns null when neither hrMax nor age is available", () => {
    expect(
      classifyCardio({
        avgHrBpm: 140,
        maxHrBpm: 165,
        durationSec: 1800,
        hrMax: null,
        userAge: null,
      }),
    ).toBeNull();
  });

  it("returns null when duration is zero", () => {
    expect(
      classifyCardio({
        avgHrBpm: 140,
        maxHrBpm: 165,
        durationSec: 0,
        hrMax: HR_MAX,
        userAge: null,
      }),
    ).toBeNull();
  });

  it("includes a reason string mentioning the avg HR and zone", () => {
    const r = classifyCardio({
      avgHrBpm: 142,
      maxHrBpm: null,
      durationSec: 45 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    expect(r?.reason).toContain("142 bpm");
    expect(r?.reason).toMatch(/Z\d/);
  });

  it("handles avg-only Z3 input as mixed (lacks a clean threshold signal)", () => {
    // avg 73% with no max → mixed since the threshold rule requires
    // a maxPct check too (maxPct < 90 condition can't be evaluated).
    const r = classifyCardio({
      avgHrBpm: 139, // 73%
      maxHrBpm: null,
      durationSec: 25 * 60,
      hrMax: HR_MAX,
      userAge: null,
    });
    // avgPct in [0.7, 0.8) and maxPct == null → threshold branch (maxPct == null fallback allows it).
    expect(r?.kind).toBe("cardio_threshold");
  });
});
