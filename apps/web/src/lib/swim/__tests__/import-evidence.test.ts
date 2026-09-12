import { describe, expect, it } from "vitest";
import { projectDashboardSwim, swimImportEvidenceSchema } from "../import-evidence";

const activity = {
  activity_id: "12345", date: "2026-09-12", type: "lap_swimming",
  distance_m: 900, duration_s: 1200.123, workout_id: "54321",
};
const split = {
  distance_m: 25, duration_s: 40.001, active_s: 35.125, paused_s: 4.876,
  stroke: "freestyle", active_lengths: 1, step_idx: 2,
};
const detail = {
  splits: [split], fetched_at: "2026-09-12T12:00:00",
  fetch_status: { splits: "ok" },
};

describe("DC-SW1/DC-SW4 swimming-only dashboard evidence", () => {
  it("projects only approved fields and makes no completion or calibration claim", () => {
    const result = projectDashboardSwim({
      ...activity, name: "PRIVATE_NAME", notes: "PRIVATE_NOTE", avg_hr: 160,
      garmin_token: "PRIVATE_CREDENTIAL", sleep: { hours: 8 },
    }, {
      ...detail, coords: [[50, 20]], weather: { desc: "PRIVATE_WEATHER" },
      streams: { heart_rate: [160] }, token: "PRIVATE_CREDENTIAL",
      splits: [{ ...split, avg_hr: 160, swolf: 42, notes: "PRIVATE_NOTE" }],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected synthetic swim evidence");
    expect(result.value).toEqual({
      version: 1, source: "local_dashboard", activityId: "12345", date: "2026-09-12",
      environment: "pool", workoutReference: "54321", distanceMetres: 900, elapsedMs: 1200123,
      nativeCourse: null,
      detail: {
        status: "available", fetchedAt: "2026-09-12T12:00:00",
        splits: [{
          distanceMetres: 25, elapsedMs: 40001, reportedActiveMs: 35125,
          activeTimeVerified: false, reportedPauseMs: 4876, stroke: "freestyle",
          strokeKnown: true, activeLengths: 1, workoutStep: 2,
        }],
      },
    });
    expect(swimImportEvidenceSchema.safeParse(result.value).success).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|heart_rate|avg_hr|sleep|coords|swolf/);
  });

  it.each(["running", "cycling", "strength_training", "swimming"])("does not guess that %s is a supported recorded swim", (type) => {
    expect(projectDashboardSwim({ ...activity, type }, detail)).toEqual({ ok: false, code: "unsupported_activity" });
  });

  it.each([null, undefined])("keeps absent detail distinct from failed or empty detail", (missing) => {
    const result = projectDashboardSwim(activity, missing);
    expect(result).toMatchObject({ ok: true, value: { detail: { status: "missing", fetchedAt: null, splits: [] } } });
  });

  it.each([
    [{ ...detail, fetch_status: { splits: "failed" } }, "partial"],
    [{ splits: [] }, "unverified"],
    [{ splits: [], fetch_status: {} }, "unverified"],
    [{ splits: [], fetch_status: { weather: "ok" } }, "unverified"],
    [{ splits: [], fetch_status: { splits: "empty" } }, "available"],
    [{ ...detail, fetch_status: { splits: "ok", weather: "failed", sets: "skipped" } }, "available"],
  ] as const)("retains retrieval quality separately from athlete performance", (input, status) => {
    expect(projectDashboardSwim(activity, input)).toMatchObject({ ok: true, value: { detail: { status } } });
  });

  it("keeps unfamiliar strokes unknown and never infers a native yard pool from converted metres", () => {
    const result = projectDashboardSwim({ ...activity, distance_m: 914.4 }, {
      ...detail, splits: [{ ...split, distance_m: 22.86, stroke: "new-provider-value" }],
    });
    expect(result).toMatchObject({
      ok: true, value: { nativeCourse: null, detail: { splits: [{ stroke: null, strokeKnown: false }] } },
    });
  });

  it("keeps open-water observations separate from pool swimming", () => {
    expect(projectDashboardSwim({ ...activity, type: "open_water_swimming" }, null)).toMatchObject({
      ok: true, value: { environment: "open_water", nativeCourse: null },
    });
  });

  it.each([
    { date: "2026-02-30" }, { activity_id: "../credentials" },
    { distance_m: Infinity }, { distance_m: -1 }, { duration_s: NaN },
    { workout_id: "unbounded-non-id" },
  ])("rejects invalid activity evidence without returning the supplied values", (fields) => {
    expect(projectDashboardSwim({ ...activity, ...fields }, detail)).toEqual({ ok: false, code: "invalid_activity" });
  });

  it.each([
    { splits: [{ ...split, active_s: -1 }] },
    { splits: [{ ...split, duration_s: 90000 }] },
    { splits: Array.from({ length: 2001 }, () => split) },
    { splits: "PRIVATE_MALFORMED_DATA" },
    { ...detail, fetched_at: "PRIVATE_MALFORMED_DATA" },
  ])("rejects malformed detail rather than silently degrading it to an empty cache", (input) => {
    expect(projectDashboardSwim(activity, input)).toEqual({ ok: false, code: "invalid_detail" });
  });

  it("rejects unapproved fields at every transport level", () => {
    const result = projectDashboardSwim(activity, detail);
    if (!result.ok) throw new Error("Expected synthetic swim evidence");
    for (const input of [
      { ...result.value, credentials: "PRIVATE_CREDENTIAL" },
      { ...result.value, detail: { ...result.value.detail, coords: [[50, 20]] } },
      { ...result.value, detail: { ...result.value.detail, splits: [{ ...result.value.detail.splits[0], heartRate: 160 }] } },
    ]) expect(swimImportEvidenceSchema.safeParse(input).success).toBe(false);
  });
});
