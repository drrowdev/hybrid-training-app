import { describe, it, expect } from "vitest";
import { restSecondsForKind } from "../rest";
import { summariseSessionSets } from "../queries";

describe("restSecondsForKind — auto rest defaults (Phase 1 B4)", () => {
  it("strength main / back_off → 180s", () => {
    expect(restSecondsForKind("main")).toBe(180);
    expect(restSecondsForKind("back_off")).toBe(180);
  });
  it("accessory → 90s", () => {
    expect(restSecondsForKind("accessory")).toBe(90);
  });
  it("warmup → 60s", () => {
    expect(restSecondsForKind("warmup")).toBe(60);
  });
  it("tendon → 120s", () => {
    expect(restSecondsForKind("tendon")).toBe(120);
  });
  it("cardio kinds → 0 (no timer)", () => {
    expect(restSecondsForKind("cardio_z2")).toBe(0);
    expect(restSecondsForKind("cardio_alactic")).toBe(0);
    expect(restSecondsForKind("cardio_vo2")).toBe(0);
    expect(restSecondsForKind("cardio_threshold")).toBe(0);
  });
});

describe("summariseSessionSets — post-session summary computation (Phase 1 C1)", () => {
  const baseSession = {
    performed_at: "2026-05-23T10:00:00.000Z",
    completed_at: "2026-05-23T11:05:00.000Z",
    duration_min: null as number | null,
  };

  it("sums tonnage across working sets and excludes warmups", () => {
    const summary = summariseSessionSets(
      [
        { set_kind: "warmup", weight_kg: 40, reps: 5 },
        { set_kind: "main", weight_kg: 100, reps: 5 },
        { set_kind: "main", weight_kg: 100, reps: 5 },
        { set_kind: "accessory", weight_kg: 60, reps: 10 },
      ],
      baseSession,
      0,
    );
    // 100*5 + 100*5 + 60*10 = 1600, warmup excluded
    expect(summary.totalTonnageKg).toBe(1600);
    expect(summary.workingSetCount).toBe(3);
    expect(summary.setCount).toBe(4);
  });

  it("derives duration from completed_at - performed_at when duration_min is null", () => {
    const summary = summariseSessionSets([], baseSession, 0);
    // 11:05 - 10:00 = 65 min
    expect(summary.durationMin).toBe(65);
  });

  it("prefers explicit duration_min over derived value", () => {
    const summary = summariseSessionSets(
      [],
      { ...baseSession, duration_min: 50 },
      0,
    );
    expect(summary.durationMin).toBe(50);
  });

  it("caps derived duration at 180 minutes", () => {
    const summary = summariseSessionSets(
      [],
      {
        performed_at: "2026-05-23T10:00:00.000Z",
        completed_at: "2026-05-23T20:00:00.000Z",
        duration_min: null,
      },
      0,
    );
    expect(summary.durationMin).toBe(180);
  });

  it("ignores sets without weight or reps", () => {
    const summary = summariseSessionSets(
      [
        { set_kind: "main", weight_kg: null, reps: 5 },
        { set_kind: "main", weight_kg: 100, reps: null },
        { set_kind: "main", weight_kg: 0, reps: 5 },
        { set_kind: "main", weight_kg: 100, reps: 0 },
      ],
      baseSession,
      0,
    );
    expect(summary.totalTonnageKg).toBe(0);
    expect(summary.workingSetCount).toBe(0);
  });

  it("passes prCount through unchanged", () => {
    const summary = summariseSessionSets([], baseSession, 3);
    expect(summary.prCount).toBe(3);
  });
});
