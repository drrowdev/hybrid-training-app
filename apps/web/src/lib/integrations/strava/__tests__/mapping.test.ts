import { describe, it, expect } from "vitest";
import { mapStravaActivity } from "../mapping";

describe("mapStravaActivity", () => {
  it("maps Run -> run + knee primary", () => {
    const m = mapStravaActivity("Run", "Run");
    expect(m?.modality).toBe("run");
    expect(m?.primaryRegion).toBe("knee");
    expect(m?.secondaryRegions).toContain("foot_ankle_calf");
  });

  it("maps Ride -> bike + knee primary", () => {
    const m = mapStravaActivity("Ride", "Ride");
    expect(m?.modality).toBe("bike");
    expect(m?.primaryRegion).toBe("knee");
  });

  it("maps Swim -> swim + shoulder primary", () => {
    const m = mapStravaActivity("Swim", "Swim");
    expect(m?.modality).toBe("swim");
    expect(m?.primaryRegion).toBe("shoulder_scapular");
  });

  it("maps Rowing -> row + lumbar primary", () => {
    expect(mapStravaActivity("Rowing", "Rowing")?.primaryRegion).toBe("lumbar_trunk");
  });

  it("prefers sport_type over legacy type when both supplied", () => {
    expect(mapStravaActivity("TrailRun", "Run")?.modality).toBe("run");
  });

  it("falls back to type when sport_type missing", () => {
    expect(mapStravaActivity(null, "Ride")?.modality).toBe("bike");
  });

  it("returns null for strength-like activities (avoid double-count)", () => {
    expect(mapStravaActivity("WeightTraining", "WeightTraining")).toBeNull();
    expect(mapStravaActivity("Crossfit", "Crossfit")).toBeNull();
    expect(mapStravaActivity("Workout", "Workout")).toBeNull();
  });

  it("returns null for ambiguous / hard-to-attribute sports", () => {
    expect(mapStravaActivity("Yoga", "Yoga")).toBeNull();
    expect(mapStravaActivity("Soccer", "Soccer")).toBeNull();
    expect(mapStravaActivity("Tennis", "Tennis")).toBeNull();
  });

  it("returns null for unknown sport types (conservative — don't guess regions)", () => {
    expect(mapStravaActivity("InventedSport", null)).toBeNull();
  });

  it("returns null when both arguments are missing", () => {
    expect(mapStravaActivity(null, null)).toBeNull();
    expect(mapStravaActivity("", "")).toBeNull();
  });
});
