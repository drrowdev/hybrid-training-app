import { describe, it, expect } from "vitest";
import { buildSyncRow, deriveRpe } from "../sync-row";
import { zoneBandsFromMaxHr } from "@/lib/stats/hr-zones";
import type { StravaActivity } from "../client";

function activity(overrides: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 12345,
    name: "Morning Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-05-21T06:30:00Z",
    start_date_local: "2026-05-21T09:30:00",
    elapsed_time: 1850,
    moving_time: 1800,
    distance: 6500,
    average_heartrate: 152,
    max_heartrate: 168,
    perceived_exertion: null,
    suffer_score: null,
    description: null,
    trainer: false,
    ...overrides,
  };
}

describe("deriveRpe", () => {
  it("uses perceived_exertion when set", () => {
    expect(deriveRpe(activity({ perceived_exertion: 7 }))).toBe(7);
  });

  it("clamps perceived_exertion to [0,10]", () => {
    expect(deriveRpe(activity({ perceived_exertion: 12 }))).toBe(10);
    expect(deriveRpe(activity({ perceived_exertion: -2 }))).toBe(0);
  });

  it("falls back to suffer_score scaled by 20", () => {
    expect(deriveRpe(activity({ suffer_score: 100 }))).toBe(5);
    expect(deriveRpe(activity({ suffer_score: 300 }))).toBe(10);
  });

  it("returns null when both fields are missing", () => {
    expect(deriveRpe(activity())).toBeNull();
  });
});

describe("buildSyncRow", () => {
  it("builds a row for a normal Run", () => {
    const row = buildSyncRow(activity(), "user-1");
    expect(row).not.toBeNull();
    expect(row?.session.strava_activity_id).toBe(12345);
    expect(row?.session.duration_min).toBe(30);
    expect(row?.session.title).toBe("Morning Run (Strava)");
    expect(row?.cardio.modality).toBe("run");
    expect(row?.cardio.distance_km).toBe(6.5);
    expect(row?.cardio.avg_hr_bpm).toBe(152);
    expect(row?.mapping.primaryRegion).toBe("knee");
  });

  it("returns null for unsupported sport types (WeightTraining etc.)", () => {
    expect(buildSyncRow(activity({ sport_type: "WeightTraining", type: "WeightTraining" }), "u")).toBeNull();
    expect(buildSyncRow(activity({ sport_type: "Yoga", type: "Yoga" }), "u")).toBeNull();
  });

  it("returns null for zero-duration activities", () => {
    expect(buildSyncRow(activity({ moving_time: 0, elapsed_time: 0 }), "u")).toBeNull();
  });

  it("falls back to elapsed_time when moving_time is zero", () => {
    const row = buildSyncRow(activity({ moving_time: 0, elapsed_time: 3000 }), "u");
    expect(row?.session.duration_min).toBe(50);
  });

  it("falls back to a generic title when name is missing", () => {
    const row = buildSyncRow(activity({ name: null }), "u");
    expect(row?.session.title).toBe("run session (Strava)");
  });

  it("emits null distance when activity has no distance", () => {
    const row = buildSyncRow(activity({ distance: 0 }), "u");
    expect(row?.cardio.distance_km).toBeNull();
  });

  it("stamps the external_source and stringifies the activity id on cardio_logs", () => {
    const row = buildSyncRow(activity({ id: 999 }), "u");
    expect(row?.cardio.external_source).toBe("strava");
    expect(row?.cardio.strava_activity_id).toBe("999");
  });

  it("marks completed_at = performed_at (Strava activities are historical)", () => {
    const row = buildSyncRow(activity(), "u");
    expect(row?.session.completed_at).toBe(row?.session.performed_at);
  });

  it("maps Ride to bike + knee", () => {
    const row = buildSyncRow(activity({ sport_type: "Ride", type: "Ride" }), "u");
    expect(row?.cardio.modality).toBe("bike");
    expect(row?.mapping.primaryRegion).toBe("knee");
  });

  it("populates hr_zones when bands are supplied and avg HR is set", () => {
    const bands = zoneBandsFromMaxHr(200);
    const row = buildSyncRow(activity(), "u", { bands });
    expect(row?.cardio.hr_zones).not.toBeNull();
    const z = row!.cardio.hr_zones!;
    const total = z.z1 + z.z2 + z.z3 + z.z4 + z.z5;
    expect(total).toBe(row!.cardio.duration_sec);
  });

  it("hr_zones is null when bands are not supplied (no zone config)", () => {
    const row = buildSyncRow(activity(), "u");
    expect(row?.cardio.hr_zones).toBeNull();
  });

  it("hr_zones is null when avg HR is missing even with bands", () => {
    const bands = zoneBandsFromMaxHr(200);
    const row = buildSyncRow(
      activity({ average_heartrate: null, max_heartrate: null }),
      "u",
      { bands },
    );
    expect(row?.cardio.hr_zones).toBeNull();
  });
});
