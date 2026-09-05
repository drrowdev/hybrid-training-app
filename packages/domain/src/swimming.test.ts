import { describe, expect, it } from "vitest";
import {
  GENERIC_SWIM_EXPOSURE,
  MAX_AGGREGATE_POOL_LENGTHS,
  MAX_POOL_LENGTHS,
  SWIM_PRIMARY_REGION_WEIGHT,
  SWIM_SECONDARY_REGION_WEIGHT,
  aggregateNativeDistance,
  calibrationSnapshot,
  checkedMul,
  compatibilityProjection,
  countsTowardAdherence,
  countsTowardHistory,
  countsTowardProgression,
  distanceToNumber,
  estimateCriticalSwimSpeed,
  formatPoolCourse,
  formatSwimDistance,
  isCalibrationCompatible,
  isISODate,
  isValidPoolCourse,
  lengthsForNativeDistance,
  nativeDistance,
  normalizePoolCourse,
  paceTargetMs,
  parsePoolCourse,
  poolCourse,
  poolCourseEquals,
  poolCourseFromDecimal,
  poolCourseKey,
  settledFromStoredActual,
  summarizeSwimWeek,
  swimBenchmarkTrend,
  swimDistanceLabel,
  swimExposureUnion,
  swimMuscleExposure,
  swimRegionExposure,
  swimResultExposure,
  swimSnapshotExposure,
  swimWorkoutExposure,
  parseSwimActualResult,
  validateSwimActualResult,
  validateSwimSetup,
  validateSwimWorkout,
  type PoolCourse,
  type SwimObservation,
  type SwimActualResult,
  type SwimSettledResult,
  type SwimSetup,
  type SwimWorkout,
} from "./swimming";

const SHORT_COURSE_METRES = poolCourse(25, 1, "m");
const SHORT_COURSE_YARDS = poolCourse(25, 1, "yd");
const THIRDS_POOL = poolCourse(100, 3, "m");
const DECIMAL_POOL = poolCourse(3333, 100, "m");

function observation(overrides: Partial<SwimObservation> = {}): SwimObservation {
  return {
    protocol: "css_200_400",
    course: SHORT_COURSE_METRES,
    stroke: "freestyle",
    equipment: [],
    trials: [
      { distance: 200, lengths: 8, timeMs: 200_000 },
      { distance: 400, lengths: 16, timeMs: 420_000 },
    ],
    observedOn: "2026-09-01",
    version: "swim-css-1",
    ...overrides,
  };
}

function settled(overrides: Partial<SwimSettledResult> = {}): SwimSettledResult {
  return {
    workoutId: "w1",
    dateISO: "2026-09-08",
    course: SHORT_COURSE_METRES,
    stroke: "freestyle",
    equipment: [],
    plannedLengths: 20,
    actualLengths: 20,
    actualMs: 1_200_000,
    completion: "completed",
    rpe: 6,
    lifecycle: { planPaused: false, trashed: false, archivedLate: false },
    ...overrides,
  };
}

function workout(overrides: Partial<SwimWorkout> = {}): SwimWorkout {
  const base: SwimWorkout = {
    kind: "swim_workout",
    focus: "endurance",
    sections: [
      {
        kind: "warmup",
        label: "Warm-up",
        rounds: 1,
        items: [
          { repeats: 1, lengths: 4, stroke: "freestyle", effort: "easy", equipment: [], optional: false },
        ],
      },
      {
        kind: "main",
        label: "Main set",
        rounds: 1,
        items: [
          {
            repeats: 4,
            lengths: 4,
            stroke: "freestyle",
            effort: "steady",
            equipment: ["paddles"],
            restSeconds: 25,
            optional: false,
          },
        ],
      },
      {
        kind: "cooldown",
        label: "Cool-down",
        rounds: 1,
        items: [
          { repeats: 1, lengths: 2, stroke: "choice", effort: "easy", equipment: [], optional: false },
        ],
      },
    ],
    totalLengths: 22,
    snapshot: {
      course: SHORT_COURSE_METRES,
      strokes: ["freestyle", "choice"],
      equipment: ["paddles"],
      protocol: null,
      calibration: null,
      versions: { model: "swim-model-1", generator: "swim-gen-1", assessment: null },
    },
    estimatedMs: null,
    budget: { minutes: 45, accountedMs: 240_000 },
  };
  return { ...base, ...overrides };
}

describe("DC-SW1 · exact pool course", () => {
  it("reduces a course to its canonical rational", () => {
    const parsed = parsePoolCourse({ lengthNumerator: 50, lengthDenominator: 2, unit: "m" });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({ numerator: 25, denominator: 1, unit: "m" });
    expect(poolCourseKey(parsed.value)).toBe("25/1:m");
  });

  it("treats 100/3 m and 33.33 m as different pools", () => {
    expect(poolCourseEquals(THIRDS_POOL, DECIMAL_POOL)).toBe(false);
    expect(poolCourseKey(THIRDS_POOL)).not.toBe(poolCourseKey(DECIMAL_POOL));
  });

  it("treats the same number in metres and yards as different pools", () => {
    expect(poolCourseEquals(SHORT_COURSE_METRES, SHORT_COURSE_YARDS)).toBe(false);
  });

  it("reads a typed decimal as the exact rational it names", () => {
    const parsed = poolCourseFromDecimal(33.33, "m");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value).toEqual({ numerator: 3333, denominator: 100, unit: "m" });
    expect(poolCourseEquals(parsed.value, THIRDS_POOL)).toBe(false);
  });

  it("rejects courses outside the bounded range", () => {
    const tooLong = parsePoolCourse({ lengthNumerator: 500, unit: "m" });
    const tooShort = parsePoolCourse({ lengthNumerator: 1, unit: "m" });
    const negative = parsePoolCourse({ lengthNumerator: -25, unit: "m" });
    expect(tooLong.ok).toBe(false);
    expect(tooShort.ok).toBe(false);
    expect(negative.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("course_out_of_range");
    if (!negative.ok) expect(negative.error.code).toBe("course_invalid");
  });

  it("formats exactly: terminating decimals stay decimal, others stay fractions", () => {
    expect(formatPoolCourse(SHORT_COURSE_METRES)).toBe("25 m");
    expect(formatPoolCourse(DECIMAL_POOL)).toBe("33.33 m");
    expect(formatPoolCourse(THIRDS_POOL)).toBe("100/3 m");
    expect(formatPoolCourse(SHORT_COURSE_YARDS)).toBe("25 yd");
  });

  it("keeps native distance exact in a non-terminating pool", () => {
    const distance = nativeDistance(7, THIRDS_POOL);
    expect(distance.ok).toBe(true);
    if (!distance.ok) return;
    expect(distance.value).toEqual({ numerator: 700, denominator: 3, unit: "m" });
    expect(formatSwimDistance(7, THIRDS_POOL)).toBe("700/3 m");
    expect(distanceToNumber(distance.value)).toBeCloseTo(233.3333, 4);
  });

  it("only accepts distances that are whole lengths of the pool", () => {
    expect(lengthsForNativeDistance(200, THIRDS_POOL)).toEqual({ ok: true, value: 6 });
    const impossible = lengthsForNativeDistance(200, DECIMAL_POOL);
    expect(impossible.ok).toBe(false);
    if (!impossible.ok) expect(impossible.error.code).toBe("distance_not_whole_lengths");
  });

  it("projects to generic distance fields as a rounded one-way value", () => {
    const projected = compatibilityProjection(20, SHORT_COURSE_YARDS);
    expect(projected.ok).toBe(true);
    if (!projected.ok) return;
    expect(projected.value.distanceMeters).toBe(457.2);
    expect(projected.value.distanceKm).toBe(0.457);
    expect(projected.value.rounded).toBe(true);
    expect(projected.value.source).toEqual({ lengths: 20, course: SHORT_COURSE_YARDS });
    // The projection is not the swim: the native record is still 20 lengths.
    expect(formatSwimDistance(20, SHORT_COURSE_YARDS)).toBe("500 yd");
  });

  it("refuses to project unvalidated input instead of writing a plausible number", () => {
    const unreduced = compatibilityProjection(20, { numerator: 50, denominator: 2, unit: "m" });
    expect(unreduced.ok).toBe(false);
    if (!unreduced.ok) expect(unreduced.error.code).toBe("course_invalid");
    const malformed = compatibilityProjection(20, { numerator: 25, denominator: 0, unit: "m" });
    expect(malformed.ok).toBe(false);
    const tooLong = compatibilityProjection(MAX_POOL_LENGTHS + 1, SHORT_COURSE_METRES);
    expect(tooLong.ok).toBe(false);
    if (!tooLong.ok) expect(tooLong.error.code).toBe("lengths_out_of_range");
    const fractional = compatibilityProjection(2.5, SHORT_COURSE_METRES);
    expect(fractional.ok).toBe(false);
  });

  it("treats an unreduced course as the same pool for identity, and flags it for storage", () => {
    const unreduced = { numerator: 50, denominator: 2, unit: "m" } as const;
    expect(poolCourseKey(unreduced)).toBe(poolCourseKey(SHORT_COURSE_METRES));
    expect(poolCourseEquals(unreduced, SHORT_COURSE_METRES)).toBe(true);
    expect(isValidPoolCourse(unreduced)).toBe(false);
    const normalized = normalizePoolCourse(unreduced);
    expect(normalized.ok).toBe(true);
    if (normalized.ok) expect(normalized.value).toEqual(SHORT_COURSE_METRES);
    expect(isValidPoolCourse({ numerator: 25, denominator: 0, unit: "m" })).toBe(false);
    expect(normalizePoolCourse({ numerator: 0, denominator: 1, unit: "m" }).ok).toBe(false);
  });

  it("refuses arithmetic that would leave the safe integer range", () => {
    const overflow = checkedMul(Number.MAX_SAFE_INTEGER, 2);
    expect(overflow.ok).toBe(false);
    if (!overflow.ok) expect(overflow.error.code).toBe("arithmetic_overflow");
    const tooManyLengths = nativeDistance(MAX_POOL_LENGTHS + 1, SHORT_COURSE_METRES);
    expect(tooManyLengths.ok).toBe(false);
  });
});

describe("DC-SW2 · 200/400 assessment", () => {
  it("computes (t400 − t200) / 2 per 100 native units", () => {
    const estimate = estimateCriticalSwimSpeed(observation());
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    expect(estimate.value.msPer100).toBe(110_000);
    expect(estimate.value.unit).toBe("m");
    expect(estimate.value.heuristic).toBe(true);
    expect(estimate.value.notes).toContain("field_estimate_not_lab_threshold");
    expect(estimate.value.observation).toEqual(observation());
  });

  it("marks a recalled pair as unverified and a timed pair as clean (DC-SW2)", () => {
    const recalled = estimateCriticalSwimSpeed(observation());
    const timed = estimateCriticalSwimSpeed(observation({ verified: true }));
    expect(recalled.ok && recalled.value.notes).toContain("unverified_self_report");
    expect(timed.ok && timed.value.notes).not.toContain("unverified_self_report");
    expect(timed.ok && timed.value.msPer100).toBe(recalled.ok ? recalled.value.msPer100 : -1);
  });

  it("is deterministic", () => {
    const first = estimateCriticalSwimSpeed(observation());
    const second = estimateCriticalSwimSpeed(observation());
    expect(first).toEqual(second);
  });

  it("keeps a half-millisecond result exact", () => {
    const estimate = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 8, timeMs: 200_000 },
          { distance: 400, lengths: 16, timeMs: 420_001 },
        ],
      }),
    );
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    expect(estimate.value.msPer100).toBe(110_000.5);
  });

  it("reads its own half-millisecond estimate back out of storage (DC-SW2)", () => {
    const estimate = estimateCriticalSwimSpeed(
      observation({
        verified: true,
        trials: [
          { distance: 200, lengths: 8, timeMs: 200_000 },
          { distance: 400, lengths: 16, timeMs: 420_001 },
        ],
      }),
    );
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    const snapshot = calibrationSnapshot(estimate.value);
    expect(snapshot.msPer100).toBe(110_000.5);
    expect(snapshot.observation).toEqual(estimate.value.observation);
    const stored = parseSwimActualResult({
      version: 1,
      snapshot: { ...workout().snapshot, calibration: snapshot },
      lengths: 8,
      timeMs: 400_000,
      rpe: null,
      completion: "completed",
      provenance: { source: "manual", recordedAt: "2026-09-09T18:30:00.000Z" },
    });
    expect(stored.ok).toBe(true);
    if (!stored.ok) return;
    expect(stored.value.snapshot.calibration?.msPer100).toBe(110_000.5);
  });

  it("refuses a rate outside the plausible band or off the half-millisecond grid", () => {
    const base = calibrationSnapshot(
      (() => {
        const estimate = estimateCriticalSwimSpeed(observation({ verified: true }));
        if (!estimate.ok) throw new Error(estimate.error.message);
        return estimate.value;
      })(),
    );
    for (const msPer100 of [110_000.25, 0, -110_000, 1_000, 5_000_000, Number.NaN]) {
      const stored = parseSwimActualResult({
        version: 1,
        snapshot: { ...workout().snapshot, calibration: { ...base, msPer100 } },
        lengths: 8,
        timeMs: 400_000,
        rpe: null,
        completion: "completed",
        provenance: { source: "manual", recordedAt: "2026-09-09T18:30:00.000Z" },
      });
      expect(stored.ok).toBe(false);
    }
  });

  it("refuses a pace measured in a different unit from the pool (SQL parity)", () => {
    const estimate = estimateCriticalSwimSpeed(observation({ verified: true }));
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    const base = workout().snapshot;
    const mismatched = parseSwimActualResult({
      version: 1,
      snapshot: {
        ...base,
        course: SHORT_COURSE_YARDS,
        protocol: "css_200_400",
        calibration: calibrationSnapshot(estimate.value),
        versions: { ...base.versions, assessment: "swim-css-1" },
      },
      lengths: 8,
      timeMs: 400_000,
      rpe: null,
      completion: "completed",
      provenance: { source: "manual", recordedAt: "2026-09-09T18:30:00.000Z" },
    });
    expect(mismatched.ok).toBe(false);
  });

  it("labels a native-yard estimate as a separate heuristic", () => {
    const estimate = estimateCriticalSwimSpeed(
      observation({
        course: SHORT_COURSE_YARDS,
        trials: [
          { distance: 200, lengths: 8, timeMs: 200_000 },
          { distance: 400, lengths: 16, timeMs: 420_000 },
        ],
      }),
    );
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    expect(estimate.value.notes).toContain("native_yard_field_estimate");
    expect(estimate.value.unit).toBe("yd");
  });

  it("requires exact whole lengths of the assessed pool", () => {
    const wrongLengths = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 7, timeMs: 200_000 },
          { distance: 400, lengths: 16, timeMs: 420_000 },
        ],
      }),
    );
    expect(wrongLengths.ok).toBe(false);
    if (!wrongLengths.ok) {
      expect(wrongLengths.error.code).toBe("protocol_distance_not_whole_lengths");
    }
    const impossiblePool = estimateCriticalSwimSpeed(observation({ course: DECIMAL_POOL }));
    expect(impossiblePool.ok).toBe(false);
  });

  it("never extrapolates from an arbitrary short swim", () => {
    const short = estimateCriticalSwimSpeed(
      observation({ trials: [{ distance: 100, lengths: 4, timeMs: 95_000 }] }),
    );
    expect(short.ok).toBe(false);
    if (!short.ok) expect(short.error.code).toBe("protocol_distances_missing");
  });

  it("rejects implausible orderings and paces", () => {
    const backwards = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 8, timeMs: 420_000 },
          { distance: 400, lengths: 16, timeMs: 200_000 },
        ],
      }),
    );
    expect(backwards.ok).toBe(false);
    if (!backwards.ok) expect(backwards.error.code).toBe("protocol_times_implausible");

    const notSlowerThanTwice = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 8, timeMs: 200_000 },
          { distance: 400, lengths: 16, timeMs: 400_000 },
        ],
      }),
    );
    expect(notSlowerThanTwice.ok).toBe(false);
    if (!notSlowerThanTwice.ok) {
      expect(notSlowerThanTwice.error.code).toBe("protocol_times_implausible");
    }

    const fasterSecondHalf = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 8, timeMs: 120_000 },
          { distance: 400, lengths: 16, timeMs: 160_000 },
        ],
      }),
    );
    expect(fasterSecondHalf.ok).toBe(false);
    if (!fasterSecondHalf.ok) expect(fasterSecondHalf.error.code).toBe("protocol_times_implausible");

    const tooFast = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 8, timeMs: 50_000 },
          { distance: 400, lengths: 16, timeMs: 105_000 },
        ],
      }),
    );
    expect(tooFast.ok).toBe(false);
    if (!tooFast.ok) expect(tooFast.error.code).toBe("protocol_pace_implausible");

    const nonInteger = estimateCriticalSwimSpeed(
      observation({
        trials: [
          { distance: 200, lengths: 8, timeMs: 200_000.5 },
          { distance: 400, lengths: 16, timeMs: 420_000 },
        ],
      }),
    );
    expect(nonInteger.ok).toBe(false);
    if (!nonInteger.ok) expect(nonInteger.error.code).toBe("duration_invalid");
  });

  it("compares pace only inside a compatible category", () => {
    const estimate = estimateCriticalSwimSpeed(observation({ verified: true }));
    expect(estimate.ok).toBe(true);
    if (!estimate.ok) return;
    const calibration = estimate.value;
    expect(isCalibrationCompatible(calibration, SHORT_COURSE_METRES, "freestyle", [])).toBe(true);
    expect(isCalibrationCompatible(calibration, SHORT_COURSE_YARDS, "freestyle", [])).toBe(false);
    expect(isCalibrationCompatible(calibration, SHORT_COURSE_METRES, "breaststroke", [])).toBe(false);
    expect(isCalibrationCompatible(calibration, SHORT_COURSE_METRES, "freestyle", ["fins"])).toBe(
      false,
    );

    expect(paceTargetMs(calibration, "steady", 4, SHORT_COURSE_METRES, "freestyle", [])).toBe(
      121_000,
    );
    expect(paceTargetMs(calibration, "steady", 4, SHORT_COURSE_METRES, "freestyle", ["fins"])).toBe(
      null,
    );
    expect(paceTargetMs(null, "steady", 4, SHORT_COURSE_METRES, "freestyle", [])).toBe(null);
  });

  it.each([false, undefined])("DC-SW2 retains unverified observations without issuing pace: %s", (verified) => {
    const source = observation(verified === undefined ? {} : { verified });
    const estimate = estimateCriticalSwimSpeed(source);
    if (!estimate.ok) throw new Error(estimate.error.message);
    expect(estimate.value.observation).toEqual(source);
    expect(paceTargetMs(estimate.value, "steady", 4, SHORT_COURSE_METRES, "freestyle", [])).toBeNull();
  });
});

describe("DC-SW3 · workout invariants", () => {
  it("accepts a well-formed workout", () => {
    expect(validateSwimWorkout(workout())).toEqual([]);
  });

  it("rejects a workout whose total disagrees with its sections", () => {
    const issues = validateSwimWorkout(workout({ totalLengths: 99 }));
    expect(issues.map((issue) => issue.field)).toContain("totalLengths");
  });

  it("rejects a claimed duration without a calibration", () => {
    const issues = validateSwimWorkout(workout({ estimatedMs: 900_000 }));
    expect(issues.map((issue) => issue.field)).toContain("estimatedMs");
  });

  it("rejects a workout missing its easy start or finish", () => {
    const stripped = workout();
    const issues = validateSwimWorkout({
      ...stripped,
      sections: stripped.sections.filter((section) => section.kind !== "cooldown"),
      totalLengths: 20,
    });
    expect(issues.some((issue) => issue.code === "setup_incomplete")).toBe(true);
  });
});

describe("DC-SW2 · setup validation", () => {
  const setup: SwimSetup = {
    goal: "endurance",
    experience: "recreational",
    course: SHORT_COURSE_METRES,
    knownStrokes: ["freestyle"],
    equipment: [],
    recentComfortableLengths: 8,
    sessionBudgetMinutes: 45,
  };

  it("passes a complete setup", () => {
    expect(validateSwimSetup(setup)).toEqual([]);
  });

  it("blocks an unusable session budget and an empty stroke list", () => {
    const issues = validateSwimSetup({ ...setup, sessionBudgetMinutes: 3, knownStrokes: [] });
    expect(issues.filter((issue) => issue.severity === "blocking").length).toBe(2);
  });

  it("does not demand a stroke from someone with no comfortable lengths yet (DC-SW3)", () => {
    const issues = validateSwimSetup({
      ...setup,
      knownStrokes: [],
      recentComfortableLengths: 0,
    });
    expect(issues.filter((issue) => issue.severity === "blocking")).toEqual([]);
  });

  it("warns when an event distance is not whole lengths of the pool", () => {
    const issues = validateSwimSetup({
      ...setup,
      course: DECIMAL_POOL,
      event: { dateISO: "2026-11-01", distance: 200, unit: "m" },
    });
    expect(issues.some((issue) => issue.code === "distance_not_whole_lengths")).toBe(true);
  });
});

describe("DC-SW7 · lifecycle", () => {
  it("excludes trashed work from everything", () => {
    const trashed = settled({
      lifecycle: { planPaused: false, trashed: true, archivedLate: false },
    });
    expect(countsTowardHistory(trashed)).toBe(false);
    expect(countsTowardAdherence(trashed)).toBe(false);
    expect(countsTowardProgression(trashed)).toBe(false);
  });

  it("keeps a swim done during a pause as history but not as adherence", () => {
    const duringPause = settled({
      lifecycle: { planPaused: true, trashed: false, archivedLate: false },
    });
    expect(countsTowardHistory(duringPause)).toBe(true);
    expect(countsTowardAdherence(duringPause)).toBe(false);
    expect(countsTowardProgression(duringPause)).toBe(false);
  });

  it("accepts a late archived completion as history but not as progression", () => {
    const late = settled({
      lifecycle: { planPaused: false, trashed: false, archivedLate: true },
    });
    expect(countsTowardHistory(late)).toBe(true);
    expect(countsTowardProgression(late)).toBe(false);
  });

  it("counts a missed session against adherence and not as history", () => {
    const missed = settled({ completion: "missed", actualLengths: null, actualMs: null, rpe: null });
    expect(countsTowardHistory(missed)).toBe(false);
    expect(countsTowardAdherence(missed)).toBe(true);
  });
});

describe("DC-SW6 · native analytics", () => {
  it("never mixes two pools into one total", () => {
    const summary = summarizeSwimWeek({
      weekStartISO: "2026-09-07",
      results: [
        settled({ workoutId: "a", course: SHORT_COURSE_METRES, plannedLengths: 20, actualLengths: 20 }),
        settled({ workoutId: "b", course: SHORT_COURSE_YARDS, plannedLengths: 24, actualLengths: 24 }),
      ],
    });
    expect(summary.byCourse).toHaveLength(2);
    const metres = summary.byCourse.find((entry) => entry.courseKey === "25/1:m");
    const yards = summary.byCourse.find((entry) => entry.courseKey === "25/1:yd");
    expect(metres?.actualDistanceLabel).toBe("500 m");
    expect(yards?.actualDistanceLabel).toBe("600 yd");
    expect(summary.adherence).toBe(1);
  });

  it("keeps paused planned dates out of adherence and trashed work out entirely", () => {
    const summary = summarizeSwimWeek({
      weekStartISO: "2026-09-07",
      results: [
        settled({ workoutId: "a" }),
        settled({
          workoutId: "b",
          completion: "missed",
          actualLengths: null,
          actualMs: null,
          rpe: null,
          lifecycle: { planPaused: true, trashed: false, archivedLate: false },
        }),
        settled({
          workoutId: "c",
          lifecycle: { planPaused: false, trashed: true, archivedLate: false },
        }),
      ],
    });
    const metres = summary.byCourse[0];
    expect(metres?.sessionsPlanned).toBe(1);
    expect(metres?.sessionsCompleted).toBe(1);
    expect(metres?.actualLengths).toBe(20);
    expect(summary.adherence).toBe(1);
  });

  it("reports adherence below one when a planned swim is missed", () => {
    const summary = summarizeSwimWeek({
      weekStartISO: "2026-09-07",
      results: [
        settled({ workoutId: "a" }),
        settled({ workoutId: "b", completion: "missed", actualLengths: null, actualMs: null, rpe: null }),
      ],
    });
    expect(summary.adherence).toBe(0.5);
  });

  it("returns null adherence when nothing was planned", () => {
    const summary = summarizeSwimWeek({ weekStartISO: "2026-09-07", results: [] });
    expect(summary.adherence).toBeNull();
    expect(summary.byCourse).toEqual([]);
  });

  it("ignores results dated outside the week", () => {
    const summary = summarizeSwimWeek({
      weekStartISO: "2026-09-07",
      results: [
        settled({ workoutId: "in", dateISO: "2026-09-13" }),
        settled({ workoutId: "after", dateISO: "2026-09-14" }),
        settled({ workoutId: "before", dateISO: "2026-09-06" }),
      ],
    });
    expect(summary.sessionsPlanned).toBe(1);
    expect(summary.byCourse[0]?.actualLengths).toBe(20);
  });

  it("counts swims that happened separately from adherence-eligible ones", () => {
    const summary = summarizeSwimWeek({
      weekStartISO: "2026-09-07",
      results: [
        settled({
          workoutId: "paused",
          lifecycle: { planPaused: true, trashed: false, archivedLate: false },
        }),
        settled({
          workoutId: "late",
          lifecycle: { planPaused: false, trashed: false, archivedLate: true },
        }),
      ],
    });
    const metres = summary.byCourse[0];
    expect(metres?.sessionsPlanned).toBe(1);
    expect(metres?.sessionsCompleted).toBe(1);
    expect(metres?.actualSessions).toBe(2);
    expect(summary.actualSessions).toBe(2);
    expect(metres?.actualLengths).toBe(40);
  });

  it("totals a week above one swim's length limit exactly", () => {
    const results = Array.from({ length: 60 }, (_, index) =>
      settled({
        workoutId: `w${index}`,
        plannedLengths: 60,
        actualLengths: 60,
        dateISO: "2026-09-07",
      }),
    );
    const summary = summarizeSwimWeek({ weekStartISO: "2026-09-07", results });
    const metres = summary.byCourse[0];
    expect(metres?.actualLengths).toBe(3_600);
    expect(metres?.actualDistanceLabel).toBe("90000 m");
    expect(metres?.actualDistance).toEqual({ numerator: 90_000, denominator: 1, unit: "m" });
    expect(nativeDistance(3_600, SHORT_COURSE_METRES).ok).toBe(false);
    expect(aggregateNativeDistance(3_600, SHORT_COURSE_METRES).ok).toBe(true);
  });

  it("labels a total or refuses — it never drops the unit silently", () => {
    const label = swimDistanceLabel(3_600, { numerator: 100, denominator: 3, unit: "m" });
    expect(label.ok).toBe(true);
    if (label.ok) expect(label.value).toBe("120000 m");
    const tooBig = swimDistanceLabel(MAX_AGGREGATE_POOL_LENGTHS + 1, SHORT_COURSE_METRES);
    expect(tooBig.ok).toBe(false);
    if (!tooBig.ok) expect(tooBig.error.code).toBe("lengths_out_of_range");
    const malformed = swimDistanceLabel(20, { numerator: 0, denominator: 1, unit: "m" });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe("course_invalid");
  });

  it("trends and personal bests stay inside a compatible category", () => {
    const trend = swimBenchmarkTrend(
      [
        observation({ observedOn: "2026-08-01" }),
        observation({
          observedOn: "2026-09-01",
          trials: [
            { distance: 200, lengths: 8, timeMs: 195_000 },
            { distance: 400, lengths: 16, timeMs: 410_000 },
          ],
        }),
        observation({ observedOn: "2026-09-02", course: SHORT_COURSE_YARDS }),
        observation({ observedOn: "2026-09-03", equipment: ["fins"] }),
      ],
      { course: SHORT_COURSE_METRES, stroke: "freestyle", equipment: [] },
    );
    expect(trend.points).toHaveLength(4);
    expect(trend.personalBests.map((point) => point.timeMs)).toEqual([195_000, 410_000]);
    expect(trend.excluded).toEqual([]);
  });

  it("never mixes an unsupported protocol or a future version into a trend", () => {
    const trend = swimBenchmarkTrend(
      [
        observation({ observedOn: "2026-08-01" }),
        observation({
          observedOn: "2026-08-02",
          protocol: "css_100_200" as unknown as SwimObservation["protocol"],
        }),
        observation({ observedOn: "2026-08-03", version: "swim-css-2" }),
        observation({ observedOn: "2026-02-31" }),
      ],
      { course: SHORT_COURSE_METRES, stroke: "freestyle", equipment: [] },
    );
    expect(trend.points.map((point) => point.observedOn)).toEqual(["2026-08-01", "2026-08-01"]);
    expect(trend.excluded.map((entry) => entry.reason)).toEqual([
      "protocol_unsupported",
      "version_unsupported",
      "date_invalid",
    ]);
  });

  it("keeps an untrustworthy time off the personal-best list", () => {
    const trend = swimBenchmarkTrend(
      [
        observation({ observedOn: "2026-08-01" }),
        observation({
          observedOn: "2026-08-05",
          trials: [
            { distance: 200, lengths: 8, timeMs: 400_000 },
            { distance: 400, lengths: 16, timeMs: 300_000 },
          ],
        }),
        observation({
          observedOn: "2026-08-06",
          trials: [
            { distance: 200, lengths: 8, timeMs: 1_000 },
            { distance: 400, lengths: 16, timeMs: 2_000 },
          ],
        }),
        observation({
          observedOn: "2026-08-07",
          trials: [
            { distance: 200, lengths: 8, timeMs: -5 },
            { distance: 400, lengths: 16, timeMs: 410_000 },
          ],
        }),
      ],
      { course: SHORT_COURSE_METRES, stroke: "freestyle", equipment: [] },
    );
    expect(trend.personalBests.map((point) => point.timeMs)).toEqual([200_000, 420_000]);
    expect(trend.excluded.map((entry) => entry.reason)).toEqual([
      "times_implausible",
      "pace_implausible",
      "duration_invalid",
    ]);
  });

  it("reads only the protocol asked for when one is named", () => {
    const trend = swimBenchmarkTrend([observation({ observedOn: "2026-08-01" })], {
      course: SHORT_COURSE_METRES,
      stroke: "freestyle",
      equipment: [],
      protocol: "css_200_400",
    });
    expect(trend.points).toHaveLength(2);
  });
});

describe("DC-SW9 · shared load and safety", () => {
  it("maps a stroke to one primary region and its secondaries", () => {
    expect(swimRegionExposure("freestyle")).toEqual({
      primaryRegion: "shoulder_scapular",
      secondaryRegions: ["elbow_forearm", "lumbar_trunk", "knee", "foot_ankle_calf"],
    });
    expect(swimRegionExposure("breaststroke")).toEqual({
      primaryRegion: "shoulder_scapular",
      secondaryRegions: ["elbow_forearm", "lumbar_trunk", "adductor_groin", "knee"],
    });
    expect(swimRegionExposure("kick").primaryRegion).toBe("knee");
    expect(swimRegionExposure("kick").secondaryRegions).toContain("foot_ankle_calf");
  });

  it("gives every full stroke both an arm and a leg region", () => {
    const fullStrokes = [
      "freestyle",
      "backstroke",
      "butterfly",
      "breaststroke",
      "individual_medley",
      "choice",
    ] as const;
    for (const stroke of fullStrokes) {
      const exposure = swimRegionExposure(stroke);
      expect(exposure.primaryRegion).toBe("shoulder_scapular");
      expect(exposure.secondaryRegions).toContain("elbow_forearm");
      expect(
        exposure.secondaryRegions.some((region) =>
          ["knee", "adductor_groin", "hamstring_posterior", "foot_ankle_calf"].includes(region),
        ),
      ).toBe(true);
    }
  });

  it("names regions only — no swim-specific coefficient anywhere", () => {
    const exposure = swimRegionExposure("butterfly", ["paddles", "fins"]);
    for (const value of Object.values(exposure)) {
      expect(typeof value === "string" || Array.isArray(value)).toBe(true);
    }
    expect(swimExposureUnion([{ stroke: "butterfly", equipment: ["paddles", "fins"] }]).weights)
      .toEqual({
        shoulder_scapular: SWIM_PRIMARY_REGION_WEIGHT,
        elbow_forearm: SWIM_SECONDARY_REGION_WEIGHT,
        lumbar_trunk: SWIM_SECONDARY_REGION_WEIGHT,
        knee: SWIM_SECONDARY_REGION_WEIGHT,
        foot_ankle_calf: SWIM_SECONDARY_REGION_WEIGHT,
      });
  });

  it("keeps the generic swim mapping for unstructured entries", () => {
    expect(GENERIC_SWIM_EXPOSURE).toEqual({
      primaryRegion: "shoulder_scapular",
      secondaryRegions: ["lumbar_trunk"],
    });
  });

  it("adds equipment regions and drops the legs under a pull buoy", () => {
    expect(swimRegionExposure("freestyle", ["fins"]).secondaryRegions).toEqual([
      "elbow_forearm",
      "lumbar_trunk",
      "knee",
      "foot_ankle_calf",
    ]);
    expect(swimRegionExposure("freestyle", ["pull_buoy"]).secondaryRegions).toEqual([
      "elbow_forearm",
      "lumbar_trunk",
    ]);
    expect(swimRegionExposure("breaststroke", ["pull_buoy"]).secondaryRegions).toEqual([
      "elbow_forearm",
      "lumbar_trunk",
    ]);
    expect(swimRegionExposure("kick", ["kickboard"]).secondaryRegions).toContain(
      "shoulder_scapular",
    );
    expect(swimRegionExposure("kick", ["pull_buoy"]).primaryRegion).toBe("knee");
    expect(swimRegionExposure("kick", ["pull_buoy"]).secondaryRegions).toEqual(
      swimRegionExposure("kick").secondaryRegions,
    );
  });

  it("names muscles without inventing a load ratio", () => {
    expect(swimMuscleExposure("freestyle")).toEqual([
      "latissimus_dorsi",
      "deltoid",
      "rotator_cuff",
      "triceps",
      "trunk_stabilisers",
    ]);
    expect(swimMuscleExposure("freestyle", ["paddles"])).toContain("forearm_flexors");
    expect(swimMuscleExposure("kick", ["fins"])).toContain("gastrocnemius");
    expect(swimMuscleExposure("breaststroke", ["pull_buoy"])).not.toContain("hip_adductors");
  });

  it("unions a mixed set into one summary row weighted 1 and 0.5", () => {
    const union = swimExposureUnion([
      { stroke: "freestyle", equipment: [] },
      { stroke: "kick", equipment: ["fins"] },
    ]);
    expect(union.primaryRegions).toEqual(["shoulder_scapular", "knee"]);
    expect(union.secondaryRegions).not.toContain("knee");
    expect(union.weights.shoulder_scapular).toBe(SWIM_PRIMARY_REGION_WEIGHT);
    expect(union.weights.knee).toBe(SWIM_PRIMARY_REGION_WEIGHT);
    expect(union.weights.elbow_forearm).toBe(SWIM_SECONDARY_REGION_WEIGHT);
    expect(union.regions).toEqual([
      "shoulder_scapular",
      "elbow_forearm",
      "lumbar_trunk",
      "knee",
      "hamstring_posterior",
      "foot_ankle_calf",
    ]);
  });

  it("summarises a whole workout from its distinct stroke and kit pairings", () => {
    const union = swimWorkoutExposure(workout());
    expect(union.primaryRegions).toEqual(["shoulder_scapular"]);
    expect(union.regions).toContain("elbow_forearm");
    expect(union.muscles).toContain("forearm_flexors");
  });

  it("uses the performed workout when the actual matches it", () => {
    const performed = workout();
    const exposure = swimResultExposure(
      settled({
        stroke: "freestyle",
        equipment: performed.snapshot.equipment,
        course: performed.snapshot.course,
      }),
      performed,
    );
    expect(exposure.basis).toBe("performed_workout");
    expect(exposure.primaryRegions).toEqual(["shoulder_scapular"]);
  });

  it("falls back to the logged actuals when the swimmer changed the work", () => {
    const performed = workout();
    const exposure = swimResultExposure(
      settled({ stroke: "kick", equipment: ["fins"], course: performed.snapshot.course }),
      performed,
    );
    expect(exposure.basis).toBe("result_actual");
    expect(exposure.primaryRegions).toEqual(["knee"]);
    expect(exposure.regions).not.toContain("elbow_forearm");
  });

  it("falls back to the logged actuals when the pool changed", () => {
    const performed = workout();
    const exposure = swimResultExposure(
      settled({
        stroke: "freestyle",
        equipment: performed.snapshot.equipment,
        course: SHORT_COURSE_YARDS,
      }),
      performed,
    );
    expect(exposure.basis).toBe("result_actual");
  });

  it("works with no performed workout at all", () => {
    const exposure = swimResultExposure(settled({ stroke: "backstroke", equipment: [] }));
    expect(exposure.basis).toBe("result_actual");
    expect(exposure.primaryRegions).toEqual(["shoulder_scapular"]);
  });

  it("summarises a stored actual from its snapshot alone", () => {
    const base = workout().snapshot;
    const union = swimSnapshotExposure({
      ...base,
      strokes: ["freestyle", "kick"],
      equipment: ["fins"],
    });
    expect(union.primaryRegions).toEqual(["shoulder_scapular", "knee"]);
    expect(union.regions).toContain("foot_ankle_calf");
    expect(union.weights["shoulder_scapular"]).toBe(1);
    expect(union.weights["lumbar_trunk"]).toBe(0.5);
    expect(swimSnapshotExposure({ ...base, strokes: [], equipment: [] }).primaryRegions).toEqual([
      "shoulder_scapular",
    ]);
  });
});

describe("course-specific formatting used by every surface", () => {
  const cases: readonly { course: PoolCourse; lengths: number; label: string }[] = [
    { course: SHORT_COURSE_METRES, lengths: 24, label: "600 m" },
    { course: SHORT_COURSE_YARDS, lengths: 24, label: "600 yd" },
    { course: poolCourse(50, 1, "m"), lengths: 9, label: "450 m" },
    { course: THIRDS_POOL, lengths: 3, label: "100 m" },
    { course: DECIMAL_POOL, lengths: 3, label: "99.99 m" },
    { course: poolCourse(33, 1, "yd"), lengths: 5, label: "165 yd" },
  ];
  for (const testCase of cases) {
    it(`formats ${testCase.lengths} lengths of ${formatPoolCourse(testCase.course)}`, () => {
      expect(formatSwimDistance(testCase.lengths, testCase.course)).toBe(testCase.label);
    });
  }

  it("accepts only real calendar dates", () => {
    expect(isISODate("2026-09-07")).toBe(true);
    expect(isISODate("2024-02-29")).toBe(true);
    expect(isISODate("2026-02-29")).toBe(false);
    expect(isISODate("2026-02-31")).toBe(false);
    expect(isISODate("2026-04-31")).toBe(false);
    expect(isISODate("2026-13-01")).toBe(false);
    expect(isISODate("2026-00-10")).toBe(false);
    expect(isISODate("7 September 2026")).toBe(false);
  });
});

describe("DC-SW7 · stored actuals mirror the SQL bounds", () => {
  const CALIBRATION_SNAPSHOT = {
    msPer100: 105_000,
    unit: "m" as const,
    protocol: "css_200_400" as const,
    observedOn: "2026-09-01",
    heuristic: true as const,
    version: "swim-css-1",
  };

  function actual(overrides: Partial<SwimActualResult> = {}): SwimActualResult {
    return {
      version: 1,
      snapshot: workout().snapshot,
      lengths: 20,
      timeMs: 1_200_000,
      rpe: 6,
      completion: "completed",
      provenance: { source: "manual", recordedAt: "2026-09-09T18:30:00.000Z" },
      ...overrides,
    };
  }

  it("accepts a well-formed actual with splits", () => {
    const result = actual({
      splits: [
        { lengths: 10, timeMs: 600_000 },
        { lengths: 10, timeMs: 600_000 },
      ],
    });
    expect(validateSwimActualResult(result)).toEqual([]);
    const parsed = parseSwimActualResult(JSON.parse(JSON.stringify(result)));
    expect(parsed.ok).toBe(true);
    if (parsed.ok) expect(parsed.value.lengths).toBe(20);
  });

  it("rejects lengths and durations past the shared bounds", () => {
    const tooManyLengths = validateSwimActualResult(actual({ lengths: MAX_POOL_LENGTHS + 1 }));
    expect(tooManyLengths.map((issue) => issue.code)).toContain("lengths_out_of_range");
    const tooLong = validateSwimActualResult(actual({ timeMs: 86_400_001 }));
    expect(tooLong.map((issue) => issue.code)).toContain("duration_out_of_range");
    const fractional = validateSwimActualResult(actual({ lengths: 12.5 }));
    expect(fractional.map((issue) => issue.code)).toContain("lengths_out_of_range");
    const noWork = validateSwimActualResult(actual({ lengths: 0 }));
    expect(noWork.map((issue) => issue.code)).toContain("lengths_out_of_range");
    const noTime = validateSwimActualResult(actual({ timeMs: null as unknown as number }));
    expect(noTime.map((issue) => issue.code)).toContain("duration_out_of_range");
  });

  it("takes effort in tenths of 0..10 or nothing at all", () => {
    expect(validateSwimActualResult(actual({ rpe: 11 })).map((issue) => issue.code)).toContain(
      "rpe_out_of_range",
    );
    expect(validateSwimActualResult(actual({ rpe: -1 })).map((issue) => issue.code)).toContain(
      "rpe_out_of_range",
    );
    expect(validateSwimActualResult(actual({ rpe: 7.55 })).map((issue) => issue.code)).toContain(
      "rpe_out_of_range",
    );
    expect(validateSwimActualResult(actual({ rpe: 7.5 }))).toEqual([]);
    expect(validateSwimActualResult(actual({ rpe: null }))).toEqual([]);
  });

  it("rejects a pool that is not a supported course", () => {
    const base = workout().snapshot;
    const issues = validateSwimActualResult(
      actual({ snapshot: { ...base, course: { numerator: 50, denominator: 2, unit: "m" } } }),
    );
    expect(issues.map((issue) => issue.code)).toContain("course_invalid");
  });

  it("rejects an unreadable envelope: version, provenance, completion", () => {
    expect(
      validateSwimActualResult(actual({ version: 2 as 1 })).map((issue) => issue.code),
    ).toContain("version_unsupported");
    expect(
      validateSwimActualResult(
        actual({ provenance: { source: "manual", recordedAt: "yesterday" } }),
      ).map((issue) => issue.code),
    ).toContain("provenance_invalid");
    expect(
      validateSwimActualResult(actual({ completion: "missed" as "partial" })).map(
        (issue) => issue.code,
      ),
    ).toContain("completion_invalid");
  });

  it("rejects splits that contradict the totals", () => {
    const overLengths = validateSwimActualResult(
      actual({ lengths: 10, splits: [{ lengths: 11, timeMs: 60_000 }] }),
    );
    expect(overLengths.map((issue) => issue.code)).toContain("splits_exceed_actual");
    const overTime = validateSwimActualResult(
      actual({ timeMs: 60_000, splits: [{ lengths: 2, timeMs: 90_000 }] }),
    );
    expect(overTime.map((issue) => issue.code)).toContain("splits_exceed_duration");
    const fractionalSplit = validateSwimActualResult(
      actual({ splits: [{ lengths: 1.5, timeMs: 60_000 }] }),
    );
    expect(fractionalSplit.map((issue) => issue.code)).toContain("split_lengths_invalid");
  });

  it("is the single runtime door for unknown stored JSON", () => {
    expect(parseSwimActualResult(null).ok).toBe(false);
    expect(parseSwimActualResult("20 lengths").ok).toBe(false);
    expect(parseSwimActualResult({ version: 1, lengths: 20 }).ok).toBe(false);
    const missingSnapshotCourse = parseSwimActualResult({
      ...actual(),
      snapshot: { ...workout().snapshot, course: undefined },
    });
    expect(missingSnapshotCourse.ok).toBe(false);
    const outOfRange = parseSwimActualResult({ ...actual(), lengths: MAX_POOL_LENGTHS + 1 });
    expect(outOfRange.ok).toBe(false);
    if (!outOfRange.ok) {
      expect(outOfRange.error.code).toBe("result_invalid");
      expect(outOfRange.error.details?.field).toBe("lengths");
    }
  });

  it("refuses a snapshot vocabulary the model cannot map", () => {
    const base = actual();
    const cases: readonly Record<string, unknown>[] = [
      { strokes: ["unrecognized"] },
      { equipment: ["unrecognized"] },
      { protocol: "unsupported" },
      { calibration: {} },
      { calibration: { ...CALIBRATION_SNAPSHOT, protocol: "unsupported" } },
      { calibration: { ...CALIBRATION_SNAPSHOT, msPer100: 0 } },
      { calibration: { ...CALIBRATION_SNAPSHOT, observedOn: "2026-02-31" } },
      { versions: { model: "swim-model-1", generator: 7, assessment: null } },
    ];
    for (const fields of cases) {
      const parsed = parseSwimActualResult({
        ...base,
        snapshot: { ...base.snapshot, ...fields },
      });
      expect(parsed.ok).toBe(false);
      if (!parsed.ok) expect(parsed.error.code).toBe("result_invalid");
    }
    const good = parseSwimActualResult({
      ...base,
      snapshot: { ...base.snapshot, protocol: "css_200_400", calibration: CALIBRATION_SNAPSHOT },
    });
    expect(good.ok).toBe(true);
  });
});

describe("DC-SW7 · one conversion from stored rows to the engine view", () => {
  const context = {
    workoutId: "w9",
    dateISO: "2026-09-09",
    plannedLengths: 24,
    plannedCourse: SHORT_COURSE_METRES,
    lifecycle: { planPaused: false, trashed: false, archivedLate: false },
  };

  it("takes the conditions actually swum from the snapshot, not the plan", () => {
    const settledRow = settledFromStoredActual(
      {
        snapshot: {
          course: SHORT_COURSE_YARDS,
          strokes: ["backstroke", "freestyle"],
          equipment: ["fins"],
          protocol: null,
          calibration: null,
          versions: { model: "swim-model-1", generator: "swim-gen-1", assessment: null },
        },
        lengths: 20,
        timeMs: 900_000,
        rpe: 6,
        completion: "partial",
      },
      context,
    );
    expect(settledRow.course).toEqual(SHORT_COURSE_YARDS);
    expect(settledRow.stroke).toBe("backstroke");
    expect(settledRow.equipment).toEqual(["fins"]);
    expect(settledRow.plannedLengths).toBe(24);
    expect(settledRow.actualLengths).toBe(20);
    expect(countsTowardHistory(settledRow)).toBe(true);
  });

  it("settles an unlogged slot as missed in the pool it was planned for", () => {
    const settledRow = settledFromStoredActual(null, context);
    expect(settledRow.completion).toBe("missed");
    expect(settledRow.actualLengths).toBeNull();
    expect(settledRow.actualMs).toBeNull();
    expect(settledRow.rpe).toBeNull();
    expect(settledRow.course).toEqual(SHORT_COURSE_METRES);
    expect(countsTowardHistory(settledRow)).toBe(false);
    expect(countsTowardAdherence(settledRow)).toBe(true);
  });

  it("orders splits by position only, so an unvalidated extra key cannot fail the parse", () => {
    const base = workout();
    const stored = {
      version: 1 as const,
      snapshot: base.snapshot,
      lengths: 8,
      timeMs: 400_000,
      rpe: null,
      completion: "completed" as const,
      provenance: { source: "manual" as const, recordedAt: "2026-09-09T18:30:00.000Z" },
    };
    const byPosition = validateSwimActualResult({
      ...stored,
      splits: [
        { lengths: 4, timeMs: 200_000 },
        { lengths: 4, timeMs: 200_000 },
      ],
    });
    expect(byPosition).toEqual([]);
    const withExtraKey = parseSwimActualResult({
      ...stored,
      splits: [
        { index: 1, lengths: 4, timeMs: 200_000 },
        { index: 0, lengths: 4, timeMs: 200_000 },
      ],
    });
    expect(withExtraKey.ok).toBe(true);
  });
});
