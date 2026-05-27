import { describe, it, expect } from "vitest";
import {
  planBackfill,
  estimateZones,
  readZoneConfig,
  type CardioRow,
  type ProfileRow,
} from "../backfill-hr-zones";

describe("backfill-hr-zones", () => {
  it("plans updates only for rows whose user has a zone config", () => {
    const rows: CardioRow[] = [
      { id: "c1", user_id: "u1", avg_hr_bpm: 140, max_hr_bpm: 160, duration_sec: 1800 },
      { id: "c2", user_id: "u2", avg_hr_bpm: 150, max_hr_bpm: 170, duration_sec: 1200 },
      // u3 has no profile → skipped.
      { id: "c3", user_id: "u3", avg_hr_bpm: 130, max_hr_bpm: 140, duration_sec: 900 },
    ];
    const profiles = new Map<string, ProfileRow>([
      ["u1", { id: "u1", intake: { hrMax: 200 } }],
      ["u2", { id: "u2", intake: { hrZones: { z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 } } }],
      // u3 has no intake at all.
      ["u3", { id: "u3", intake: null }],
    ]);
    const updates = planBackfill(rows, profiles);
    expect(updates.map((u) => u.id).sort()).toEqual(["c1", "c2"]);
    for (const u of updates) {
      const row = rows.find((r) => r.id === u.id)!;
      const total =
        u.hr_zones.z1 +
        u.hr_zones.z2 +
        u.hr_zones.z3 +
        u.hr_zones.z4 +
        u.hr_zones.z5;
      expect(total).toBe(row.duration_sec);
    }
  });

  it("skips rows without avg_hr_bpm even if user has bands", () => {
    const rows: CardioRow[] = [
      { id: "c1", user_id: "u1", avg_hr_bpm: null, max_hr_bpm: 160, duration_sec: 1800 },
    ];
    const profiles = new Map<string, ProfileRow>([
      ["u1", { id: "u1", intake: { hrMax: 200 } }],
    ]);
    expect(planBackfill(rows, profiles)).toEqual([]);
  });

  it("readZoneConfig falls back to hrMax-derived bands", () => {
    expect(readZoneConfig({ hrMax: 200 })).toEqual({
      z1Max: 120,
      z2Max: 140,
      z3Max: 160,
      z4Max: 180,
    });
    expect(readZoneConfig(null)).toBeNull();
    expect(readZoneConfig({})).toBeNull();
  });

  it("estimateZones matches the web helper's contract (sum == duration)", () => {
    const z = estimateZones({
      avgHrBpm: 137,
      maxHrBpm: 178,
      durationSec: 1777,
      bands: { z1Max: 120, z2Max: 140, z3Max: 160, z4Max: 180 },
    });
    expect(z).not.toBeNull();
    expect(z!.z1 + z!.z2 + z!.z3 + z!.z4 + z!.z5).toBe(1777);
  });
});
