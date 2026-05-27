import { describe, expect, it } from "vitest";
import {
  computeAdherence,
  toneForPct,
  type ActualCardio,
  type PlannedCardio,
} from "./run-plan-adherence";

// Anchor: Saturday 2026-05-23 → Monday of week is 2026-05-18.
const TODAY = "2026-05-23";

describe("computeAdherence", () => {
  it("returns N zero-rows when no data is provided", () => {
    const rows = computeAdherence(4, [], [], TODAY);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.plannedSessions === 0 && r.actualSessions === 0)).toBe(true);
    expect(rows[3].weekStart).toBe("2026-05-18");
    expect(rows[0].weekStart).toBe("2026-04-27");
  });

  it("sums multiple planned sessions into the same ISO week", () => {
    const planned: PlannedCardio[] = [
      { date: "2026-05-19", durationMin: 30 },
      { date: "2026-05-21", durationMin: 45 },
    ];
    const rows = computeAdherence(2, planned, [], TODAY);
    const lastWeek = rows[rows.length - 1];
    expect(lastWeek.plannedSessions).toBe(2);
    expect(lastWeek.plannedMin).toBe(75);
    // No actual logged → ratio is 0 (not null) because plan exists.
    expect(lastWeek.sessionsPct).toBe(0);
    expect(lastWeek.volumePct).toBe(0);
  });

  it("returns null ratios when nothing was planned", () => {
    const rows = computeAdherence(
      1,
      [],
      [{ date: "2026-05-19", durationMin: 30 }],
      TODAY,
    );
    expect(rows[0].sessionsPct).toBeNull();
    expect(rows[0].volumePct).toBeNull();
  });

  it("collapses multiple cardio_logs on the same day into one session", () => {
    const actual: ActualCardio[] = [
      { date: "2026-05-19", durationMin: 20 }, // warm-up
      { date: "2026-05-19", durationMin: 25 }, // intervals
    ];
    const rows = computeAdherence(1, [], actual, TODAY);
    expect(rows[0].actualSessions).toBe(1);
    expect(rows[0].actualMin).toBe(45);
  });

  it("computes ratios when both planned and actual are present", () => {
    const planned: PlannedCardio[] = [
      { date: "2026-05-18", durationMin: 40 },
      { date: "2026-05-20", durationMin: 60 },
    ];
    const actual: ActualCardio[] = [
      { date: "2026-05-18", durationMin: 40 },
      { date: "2026-05-20", durationMin: 50 },
    ];
    const rows = computeAdherence(1, planned, actual, TODAY);
    expect(rows[0].sessionsPct).toBe(1);
    expect(rows[0].volumePct).toBeCloseTo(90 / 100, 5);
  });

  it("buckets dates into the correct ISO week", () => {
    // 2026-05-17 is Sunday → previous Monday is 2026-05-11.
    const planned: PlannedCardio[] = [{ date: "2026-05-17", durationMin: 30 }];
    const rows = computeAdherence(3, planned, [], TODAY);
    const target = rows.find((r) => r.weekStart === "2026-05-11");
    expect(target?.plannedSessions).toBe(1);
  });

  it("ignores rows outside the window", () => {
    const planned: PlannedCardio[] = [
      { date: "2024-01-01", durationMin: 90 }, // way before window
    ];
    const rows = computeAdherence(4, planned, [], TODAY);
    expect(rows.every((r) => r.plannedSessions === 0)).toBe(true);
  });

  // ── Phase 1 "external cardio" — adherence semantics ──────────────
  //
  // External cardio days carry `durationMin: 0` because the user logs
  // the actual run via Runna / Garmin Coach / etc. — we can't predict
  // the duration. Adherence rules:
  //   - The planned day still counts as `plannedSessions += 1` so the
  //     calendar bucket matches what the user sees.
  //   - ANY cardio_log on the same date flips the day to adherent
  //     (sessionsPct = 1.0) — we don't try to match modality.
  //   - `volumePct` is null because `plannedMin = 0`; the card hides
  //     the volume bar via the existing null branch.
  it("counts any-log-on-external-day as adherent (Phase 1 external cardio)", () => {
    const planned: PlannedCardio[] = [
      { date: "2026-05-19", durationMin: 0 }, // external cardio reservation
    ];
    const actual: ActualCardio[] = [
      { date: "2026-05-19", durationMin: 42 },
    ];
    const rows = computeAdherence(1, planned, actual, TODAY);
    expect(rows[0].plannedSessions).toBe(1);
    expect(rows[0].actualSessions).toBe(1);
    expect(rows[0].sessionsPct).toBe(1);
    // Volume ratio is null (planned minutes is zero for external days).
    expect(rows[0].volumePct).toBeNull();
  });
});

describe("toneForPct", () => {
  it("returns success ≥ 90%", () => {
    expect(toneForPct(0.95)).toBe("success");
    expect(toneForPct(1.2)).toBe("success");
  });

  it("returns warning between 70% and 89%", () => {
    expect(toneForPct(0.7)).toBe("warning");
    expect(toneForPct(0.89)).toBe("warning");
  });

  it("returns danger below 70%", () => {
    expect(toneForPct(0.5)).toBe("danger");
    expect(toneForPct(0)).toBe("danger");
  });

  it("returns neutral when null", () => {
    expect(toneForPct(null)).toBe("neutral");
  });
});
