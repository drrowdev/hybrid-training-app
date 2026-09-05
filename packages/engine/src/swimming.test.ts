import { describe, expect, it } from "vitest";
import {
  countsTowardProgression,
  estimateCriticalSwimSpeed,
  poolCourse,
  summarizeSwimWeek,
  validateSwimWorkout,
  type SwimCalibration,
  type SwimSettledResult,
  type SwimSetup,
  type SwimWorkout,
} from "@hta/domain";
import {
  SWIM_GENERATOR_VERSION,
  SWIM_PROGRESSION_RULES,
  applyAcceptedBenchmark,
  applySwimProposal,
  generateSwimPlan,
  initialSwimDose,
  proposeSwimAdjustment,
  recordSwimDecision,
  swimWeeksFromWeekdays,
  swimPlanWeekLengths,
  type SwimDecisionEntry,
  type SwimDose,
  type SwimPlan,
  type SwimSlotIntent,
  type SwimWeekRequest,
} from "./swimming";

const METRES_25 = poolCourse(25, 1, "m");
const YARDS_25 = poolCourse(25, 1, "yd");
const THIRDS_POOL = poolCourse(100, 3, "m");

const SETUP: SwimSetup = {
  goal: "endurance",
  experience: "recreational",
  course: METRES_25,
  knownStrokes: ["freestyle"],
  equipment: ["kickboard", "pull_buoy"],
  recentComfortableLengths: 8,
  sessionBudgetMinutes: 45,
};

function slot(
  slotId: string,
  dateISO: string,
  intent: SwimSlotIntent["intent"] = "moderate",
  overrides: Partial<SwimSlotIntent> = {},
): SwimSlotIntent {
  return { slotId, dateISO, intent, source: "swim_date", ...overrides };
}

function week(weekIndex: number, startDateISO: string, slots: SwimSlotIntent[]): SwimWeekRequest {
  return { weekIndex, startDateISO, slots };
}

function planOf(
  overrides: {
    setup?: Partial<SwimSetup>;
    weeks?: readonly SwimWeekRequest[];
    calibration?: SwimCalibration | null;
    dose?: SwimDose;
    eventPrep?: { enabled: true; windowWeeks: number };
  } = {},
): SwimPlan {
  const result = generateSwimPlan({
    setup: { ...SETUP, ...overrides.setup },
    calibration: overrides.calibration ?? null,
    weeks: overrides.weeks ?? [week(0, "2026-09-07", [slot("a", "2026-09-09")])],
    ...(overrides.dose ? { dose: overrides.dose } : {}),
    ...(overrides.eventPrep ? { eventPrep: overrides.eventPrep } : {}),
  });
  if (!result.ok) throw new Error(`${result.error.code}: ${result.error.message}`);
  return result.value;
}

function issuedWorkouts(plan: SwimPlan): SwimWorkout[] {
  return plan.weeks.flatMap((planWeek) =>
    planWeek.slots.flatMap((planSlot) => (planSlot.kind === "workout" ? [planSlot.issued] : [])),
  );
}

function settled(overrides: Partial<SwimSettledResult> = {}): SwimSettledResult {
  return {
    workoutId: "w1",
    dateISO: "2026-09-09",
    course: METRES_25,
    stroke: "freestyle",
    equipment: [],
    plannedLengths: 25,
    actualLengths: 25,
    actualMs: 1_500_000,
    completion: "completed",
    rpe: 6,
    lifecycle: { planPaused: false, trashed: false, archivedLate: false },
    ...overrides,
  };
}

const CALIBRATION: SwimCalibration = (() => {
  const estimate = estimateCriticalSwimSpeed({
    protocol: "css_200_400",
    course: METRES_25,
    stroke: "freestyle",
    equipment: [],
    trials: [
      { distance: 200, lengths: 8, timeMs: 200_000 },
      { distance: 400, lengths: 16, timeMs: 420_000 },
    ],
    observedOn: "2026-09-01",
    version: "swim-css-1",
    verified: true,
  });
  if (!estimate.ok) throw new Error("fixture calibration failed");
  return estimate.value;
})();

describe("DC-SW3 · generation against explicit dated slots", () => {
  it("builds exactly the slots it is given, including a week with none", () => {
    const plan = planOf({
      weeks: [
        week(0, "2026-09-07", [slot("a", "2026-09-09"), slot("b", "2026-09-11", "easy")]),
        week(1, "2026-09-14", []),
        week(2, "2026-09-21", [slot("c", "2026-09-22", "hard")]),
      ],
    });
    expect(plan.weeks.map((planWeek) => planWeek.slots.length)).toEqual([2, 0, 1]);
    expect(plan.weeks[1]?.provisional).toBe(true);
    expect(plan.weeks[0]?.provisional).toBe(false);
    expect(plan.weeks[0]?.slots.map((planSlot) => planSlot.slotId)).toEqual(["a", "b"]);
  });

  it("keeps each slot's date, intent and source on its outcome", () => {
    const plan = planOf({
      weeks: [
        week(0, "2026-09-07", [
          slot("bound", "2026-09-09", "hard", { source: "cardio_slot" }),
          slot("added", "2026-09-11", "easy"),
        ]),
      ],
    });
    expect(
      plan.weeks[0]?.slots.map((planSlot) => [planSlot.slotId, planSlot.dateISO, planSlot.intent, planSlot.source]),
    ).toEqual([
      ["bound", "2026-09-09", "hard", "cardio_slot"],
      ["added", "2026-09-11", "easy", "swim_date"],
    ]);
  });

  it("does not move an empty week's work anywhere else", () => {
    const withGap = planOf({
      weeks: [
        week(0, "2026-09-07", [slot("a", "2026-09-09")]),
        week(1, "2026-09-14", []),
        week(2, "2026-09-21", [slot("c", "2026-09-23")]),
      ],
    });
    const withoutGap = planOf({
      weeks: [
        week(0, "2026-09-07", [slot("a", "2026-09-09")]),
        week(1, "2026-09-14", [slot("b", "2026-09-16")]),
        week(2, "2026-09-21", [slot("c", "2026-09-23")]),
      ],
    });
    expect(swimPlanWeekLengths(withGap.weeks[1]!)).toBe(0);
    expect(swimPlanWeekLengths(withGap.weeks[2]!)).toBe(
      swimPlanWeekLengths(withoutGap.weeks[2]!),
    );
  });

  it("is deterministic for identical input", () => {
    expect(planOf()).toEqual(planOf());
  });

  it("produces valid whole-length workouts in metres, yards and a custom course", () => {
    for (const course of [METRES_25, YARDS_25, poolCourse(50, 1, "m"), THIRDS_POOL, poolCourse(20, 1, "yd")]) {
      const plan = planOf({ setup: { course } });
      const workouts = issuedWorkouts(plan);
      expect(workouts).toHaveLength(1);
      for (const workout of workouts) {
        expect(validateSwimWorkout(workout)).toEqual([]);
        expect(workout.snapshot.course).toEqual(course);
        for (const section of workout.sections) {
          for (const item of section.items) {
            expect(Number.isInteger(item.lengths)).toBe(true);
            expect(item.lengths).toBeGreaterThan(0);
            expect(Number.isInteger(item.repeats)).toBe(true);
          }
        }
      }
    }
  });

  it("keeps the easy start, the main set and the easy finish", () => {
    const workout = issuedWorkouts(planOf())[0];
    expect(workout?.sections.map((section) => section.kind)).toEqual([
      "warmup",
      "preparation",
      "main",
      "recovery",
      "cooldown",
    ]);
  });

  it("shapes volume by slot intent", () => {
    const plan = planOf({
      weeks: [
        week(0, "2026-09-07", [
          slot("hard", "2026-09-08", "hard"),
          slot("moderate", "2026-09-09", "moderate"),
          slot("easy", "2026-09-10", "easy"),
          slot("recovery", "2026-09-11", "recovery"),
        ]),
      ],
    });
    const totals = plan.weeks[0]!.slots.map((planSlot) =>
      planSlot.kind === "workout" ? planSlot.issued.totalLengths : 0,
    );
    const mainEfforts = plan.weeks[0]!.slots.map((planSlot) =>
      planSlot.kind === "workout"
        ? planSlot.issued.sections.find((section) => section.kind === "main")?.items[0]?.effort
        : null,
    );
    const [hard = 0, moderate = 0, easy = 0, recovery = 0] = totals;
    expect(moderate).toBeGreaterThanOrEqual(hard);
    expect(hard).toBeGreaterThan(easy);
    expect(easy).toBeGreaterThan(recovery);
    expect(mainEfforts).toEqual(["brisk", "steady", "easy", "easy"]);
  });

  it("only uses equipment the swimmer has", () => {
    const withKit = issuedWorkouts(planOf())[0];
    expect(withKit?.snapshot.equipment).toContain("kickboard");
    const withoutKit = issuedWorkouts(planOf({ setup: { equipment: [] } }))[0];
    expect(withoutKit?.snapshot.equipment).toEqual([]);
    for (const section of withoutKit?.sections ?? []) {
      for (const item of section.items) expect(item.equipment).toEqual([]);
    }
  });

  it("stamps course, strokes, equipment, protocol and versions on every workout", () => {
    const workout = issuedWorkouts(planOf({ calibration: CALIBRATION }))[0];
    expect(workout?.snapshot.versions.generator).toBe(SWIM_GENERATOR_VERSION);
    expect(workout?.snapshot.versions.model).toBe("swim-model-1");
    expect(workout?.snapshot.versions.assessment).toBe("swim-css-1");
    expect(workout?.snapshot.protocol).toBe("css_200_400");
    expect(workout?.snapshot.calibration?.msPer100).toBe(110_000);
    expect(workout?.snapshot.strokes.length).toBeGreaterThan(0);
  });
});

describe("DC-SW3 · unknown pace and time budget", () => {
  function knownMsOf(workout: SwimWorkout): number {
    let ms = 0;
    for (const section of workout.sections) {
      for (const item of section.items) {
        ms += ((item.restSeconds ?? 0) * Math.max(0, item.repeats - 1) + 20) * 1000 * section.rounds;
      }
    }
    return ms;
  }

  it("claims no duration and no pace target without a calibration", () => {
    const workout = issuedWorkouts(planOf())[0];
    expect(workout?.estimatedMs).toBeNull();
    expect(workout?.budget.accountedMs).toBe(knownMsOf(workout!));
    for (const section of workout?.sections ?? []) {
      for (const item of section.items) expect(item.targetMsPerRepeat).toBeUndefined();
    }
  });

  it("bounds an uncalibrated session by what is known and invents nothing else", () => {
    const generous = issuedWorkouts(planOf({ setup: { sessionBudgetMinutes: 60 } }))[0]!;
    const tight = issuedWorkouts(planOf({ setup: { sessionBudgetMinutes: 20 } }))[0]!;
    // Pace is unknown, so a smaller budget cannot shrink the swimming: doing so
    // would require a guess about how long the swimming takes.
    expect(tight.totalLengths).toBe(generous.totalLengths);
    expect(tight.estimatedMs).toBeNull();
    expect(tight.budget.accountedMs).toBeLessThanOrEqual(20 * 60_000);
  });

  it("shortens an uncalibrated session when the rest it asks for does not fit", () => {
    const dose = { mainRepeats: 20, mainRepLengths: 1, mainRestSeconds: 45 } as const;
    const generous = issuedWorkouts(planOf({ dose, setup: { sessionBudgetMinutes: 60 } }))[0]!;
    const tight = issuedWorkouts(planOf({ dose, setup: { sessionBudgetMinutes: 10 } }))[0]!;
    expect(tight.totalLengths).toBeLessThan(generous.totalLengths);
    expect(tight.budget.accountedMs).toBeLessThanOrEqual(10 * 60_000);
    expect(tight.estimatedMs).toBeNull();
  });

  it("gives pace targets only where the calibration matches exactly", () => {
    const workout = issuedWorkouts(
      planOf({ setup: { equipment: [] }, calibration: CALIBRATION }),
    )[0]!;
    const main = workout.sections.find((section) => section.kind === "main")?.items[0];
    expect(main?.targetMsPerRepeat).toBe(121_000);
    expect(workout.estimatedMs).toBe(workout.budget.accountedMs);
    expect(workout.estimatedMs).toBeGreaterThan(knownMsOf(workout));

    // A kickboard set is a different activity: no target, and the session as a
    // whole no longer claims a duration.
    const withKick = issuedWorkouts(
      planOf({ setup: { equipment: ["kickboard"] }, calibration: CALIBRATION }),
    )[0]!;
    const prep = withKick.sections.find((section) => section.kind === "preparation")?.items[0];
    expect(prep?.equipment).toEqual(["kickboard"]);
    expect(prep?.targetMsPerRepeat).toBeUndefined();
    expect(withKick.estimatedMs).toBeNull();

    // A different pool is a different course: the calibration does not carry.
    const otherPool = issuedWorkouts(
      planOf({ setup: { course: YARDS_25, equipment: [] }, calibration: CALIBRATION }),
    )[0];
    expect(otherPool?.estimatedMs).toBeNull();
    expect(otherPool?.snapshot.calibration).toBeNull();

    // Nor does a freestyle threshold say anything about breaststroke.
    const otherStroke = issuedWorkouts(
      planOf({
        setup: { equipment: [], knownStrokes: ["breaststroke"] },
        calibration: CALIBRATION,
      }),
    )[0]!;
    expect(otherStroke.estimatedMs).toBeNull();
    for (const section of otherStroke.sections) {
      for (const item of section.items) expect(item.targetMsPerRepeat).toBeUndefined();
    }
  });

  it("returns an actionable conflict when even the known time cannot fit", () => {
    const plan = planOf({
      setup: { goal: "technique_base" },
      weeks: [
        week(0, "2026-09-07", [
          slot("a", "2026-09-09", "moderate", { budgetMinutes: 1 }),
          slot("b", "2026-09-11", "moderate", { budgetMinutes: 1 }),
        ]),
      ],
    });
    const outcomes = plan.weeks[0]!.slots;
    expect(outcomes.every((outcome) => outcome.kind === "conflict")).toBe(true);
    const conflict = outcomes[0];
    if (conflict?.kind !== "conflict") throw new Error("expected a conflict");
    expect(conflict.conflict.code).toBe("budget_impossible");
    expect(conflict.conflict.message).toContain("before any swimming");
    expect(conflict.conflict.details?.accounts).toBe("known_time_only");
    expect(Array.isArray(conflict.conflict.details?.options)).toBe(true);
    expect(conflict.conflict.details?.minimumMinutes).toBeGreaterThan(1);
  });

  it("says the whole session does not fit when every part of it is timed", () => {
    const plan = planOf({
      setup: { equipment: [] },
      calibration: CALIBRATION,
      weeks: [week(0, "2026-09-07", [slot("a", "2026-09-09", "moderate", { budgetMinutes: 1 })])],
    });
    const conflict = plan.weeks[0]!.slots[0];
    if (conflict?.kind !== "conflict") throw new Error("expected a conflict");
    expect(conflict.conflict.code).toBe("budget_impossible");
    expect(conflict.conflict.details?.accounts).toBe("whole_session");
    expect(conflict.conflict.message).toContain("easy start");
  });

  it("keeps other slots usable when one slot cannot fit", () => {
    const plan = planOf({
      setup: { goal: "technique_base" },
      weeks: [
        week(0, "2026-09-07", [
          slot("tight", "2026-09-09", "moderate", { budgetMinutes: 1 }),
          slot("roomy", "2026-09-11", "moderate", { budgetMinutes: 60 }),
        ]),
      ],
    });
    expect(plan.weeks[0]?.slots[0]?.kind).toBe("conflict");
    expect(plan.weeks[0]?.slots[1]?.kind).toBe("workout");
  });
});

describe("DC-SW3 · learning path", () => {
  it("gives guidance rather than an invented workout with no comfortable length", () => {
    const plan = planOf({
      setup: { recentComfortableLengths: 0, experience: "learning" },
      weeks: [week(0, "2026-09-07", [slot("a", "2026-09-09"), slot("b", "2026-09-11")])],
    });
    for (const outcome of plan.weeks[0]!.slots) {
      expect(outcome.kind).toBe("guidance");
      if (outcome.kind !== "guidance") continue;
      expect(outcome.guidance.reason).toBe("no_comfortable_length");
      expect(outcome.guidance.steps.length).toBeGreaterThan(0);
      expect(outcome.guidance.course).toEqual(METRES_25);
    }
    expect(swimPlanWeekLengths(plan.weeks[0]!)).toBe(0);
  });

  it("builds a real workout as soon as one length is comfortable", () => {
    const plan = planOf({ setup: { recentComfortableLengths: 1, experience: "learning" } });
    expect(plan.weeks[0]?.slots[0]?.kind).toBe("workout");
  });

  it("reaches guidance without a stroke selected (DC-SW3)", () => {
    const plan = planOf({
      setup: { recentComfortableLengths: 0, experience: "learning", knownStrokes: [] },
    });
    expect(plan.weeks[0]?.slots[0]?.kind).toBe("guidance");
  });
});

describe("DC-D7 / DC-N2 · threshold is never seeded by default", () => {
  it("keeps every default plan free of threshold work", () => {
    const plan = planOf({
      weeks: [
        week(0, "2026-09-07", [
          slot("a", "2026-09-08", "hard"),
          slot("b", "2026-09-10", "moderate"),
          slot("c", "2026-09-12", "easy"),
        ]),
        week(1, "2026-09-14", [slot("d", "2026-09-15", "hard")]),
      ],
    });
    const efforts = issuedWorkouts(plan).flatMap((workout) =>
      workout.sections.flatMap((section) => section.items.map((item) => item.effort)),
    );
    expect(efforts).not.toContain("threshold");
  });

  it("keeps threshold out even when an event exists without opt-in event prep", () => {
    const plan = planOf({
      setup: { event: { dateISO: "2026-09-26", distance: 400, unit: "m" } },
      weeks: [week(0, "2026-09-07", [slot("a", "2026-09-16", "hard")])],
    });
    const efforts = issuedWorkouts(plan).flatMap((workout) =>
      workout.sections.flatMap((section) => section.items.map((item) => item.effort)),
    );
    expect(efforts).not.toContain("threshold");
  });

  it("allows threshold only on hard slots inside an opted-in event window", () => {
    const plan = planOf({
      setup: { event: { dateISO: "2026-09-26", distance: 400, unit: "m" } },
      eventPrep: { enabled: true, windowWeeks: 2 },
      weeks: [
        week(0, "2026-09-07", [slot("far", "2026-09-09", "hard")]),
        week(1, "2026-09-14", [slot("near", "2026-09-16", "hard"), slot("easy", "2026-09-17", "easy")]),
      ],
    });
    const efforts = (slotId: string): string[] =>
      plan.weeks
        .flatMap((planWeek) => planWeek.slots)
        .filter((planSlot) => planSlot.slotId === slotId)
        .flatMap((planSlot) =>
          planSlot.kind === "workout"
            ? planSlot.issued.sections.flatMap((section) => section.items.map((item) => item.effort))
            : [],
        );
    expect(efforts("far")).not.toContain("threshold");
    expect(efforts("near")).toContain("threshold");
    expect(efforts("easy")).not.toContain("threshold");
  });

  it("surfaces a choice instead of compressing an impossible event", () => {
    const tooSoon = generateSwimPlan({
      setup: { ...SETUP, event: { dateISO: "2026-09-10", distance: 400, unit: "m" } },
      calibration: null,
      weeks: [week(0, "2026-09-07", [slot("a", "2026-09-09")])],
    });
    expect(tooSoon.ok).toBe(false);
    if (!tooSoon.ok) {
      expect(tooSoon.error.code).toBe("event_infeasible");
      expect(Array.isArray(tooSoon.error.details?.options)).toBe(true);
    }
    const inThePast = generateSwimPlan({
      setup: { ...SETUP, event: { dateISO: "2026-09-01", distance: 400, unit: "m" } },
      calibration: null,
      weeks: [week(0, "2026-09-07", [slot("a", "2026-09-09")])],
    });
    expect(inThePast.ok).toBe(false);
  });

  it("eases volume in the week before the event", () => {
    const plan = planOf({
      setup: { event: { dateISO: "2026-09-26", distance: 400, unit: "m" } },
      weeks: [
        week(0, "2026-09-07", [slot("early", "2026-09-09")]),
        week(2, "2026-09-21", [slot("taper", "2026-09-23")]),
      ],
    });
    expect(swimPlanWeekLengths(plan.weeks[1]!)).toBeLessThan(swimPlanWeekLengths(plan.weeks[0]!));
  });
});

describe("DC-SW4 · progression from settled results", () => {
  const dose = initialSwimDose(SETUP);

  it("starts from what the swimmer can already do", () => {
    expect(dose).toEqual({ mainRepeats: 4, mainRepLengths: 4, mainRestSeconds: 25 });
  });

  it("progresses one bounded lever when the work was completed and comfortable", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "w1", rpe: 6 }),
        settled({ workoutId: "w2", dateISO: "2026-09-11", rpe: 6 }),
      ],
    });
    expect(proposal.decision).toBe("progress");
    expect(proposal.lever).toBe("main_rep_lengths");
    expect(proposal.to).toEqual({ mainRepeats: 4, mainRepLengths: 5, mainRestSeconds: 25 });
    expect(proposal.reasons).toContain("effort_comfortable");
    const changed =
      proposal.to.mainRepeats * proposal.to.mainRepLengths -
      proposal.from.mainRepeats * proposal.from.mainRepLengths;
    expect(changed).toBeLessThanOrEqual(proposal.snapshot.capLengths);
    // Only one lever moved.
    expect(proposal.to.mainRepeats).toBe(proposal.from.mainRepeats);
    expect(proposal.to.mainRestSeconds).toBe(proposal.from.mainRestSeconds);
  });

  it("holds on a plateau", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "w1", actualLengths: 20, completion: "partial", rpe: 7 }),
        settled({ workoutId: "w2", dateISO: "2026-09-11", actualLengths: 22, completion: "partial", rpe: 7 }),
      ],
    });
    expect(proposal.decision).toBe("hold");
    expect(proposal.lever).toBe("none");
    expect(proposal.to).toEqual(proposal.from);
  });

  it("reduces after missed sessions with high reported effort", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "w1", completion: "missed", actualLengths: null, actualMs: null, rpe: null }),
        settled({ workoutId: "w2", dateISO: "2026-09-11", actualLengths: 18, completion: "partial", rpe: 9 }),
      ],
    });
    expect(proposal.decision).toBe("reduce");
    expect(proposal.to).toEqual({ mainRepeats: 3, mainRepLengths: 4, mainRestSeconds: 25 });
    expect(proposal.reasons).toContain("missed_sessions");
  });

  it("gives three different futures for the three histories", () => {
    const histories = {
      improving: [settled({ workoutId: "w1", rpe: 6 }), settled({ workoutId: "w2", rpe: 6 })],
      plateau: [
        settled({ workoutId: "w1", actualLengths: 20, completion: "partial", rpe: 7 }),
        settled({ workoutId: "w2", actualLengths: 21, completion: "partial", rpe: 7 }),
      ],
      struggling: [
        settled({ workoutId: "w1", completion: "missed", actualLengths: null, actualMs: null, rpe: null }),
        settled({ workoutId: "w2", actualLengths: 18, completion: "partial", rpe: 9 }),
      ],
    } as const;
    const futures = Object.fromEntries(
      Object.entries(histories).map(([label, history]) => {
        const proposal = proposeSwimAdjustment({
          setup: SETUP,
          dose,
          asOfISO: "2026-09-14",
          history: [...history],
        });
        const future = planOf({
          dose: proposal.to,
          weeks: [week(3, "2026-09-28", [slot("next", "2026-09-30")])],
        });
        return [label, swimPlanWeekLengths(future.weeks[0]!)];
      }),
    );
    expect(futures.improving).toBeGreaterThan(futures.plateau!);
    expect(futures.plateau).toBeGreaterThan(futures.struggling!);
  });

  it("keeps a progressed session inside the DC-K5 week-to-week bound", () => {
    const before = swimPlanWeekLengths(
      planOf({ dose, weeks: [week(0, "2026-09-07", [slot("a", "2026-09-09")])] }).weeks[0]!,
    );
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [settled({ workoutId: "w1", rpe: 6 }), settled({ workoutId: "w2", rpe: 6 })],
    });
    const after = swimPlanWeekLengths(
      planOf({
        dose: proposal.to,
        weeks: [week(1, "2026-09-14", [slot("a", "2026-09-16")])],
      }).weeks[0]!,
    );
    expect(after).toBeGreaterThan(before);
    expect((after - before) / before).toBeLessThanOrEqual(0.2);
  });

  it("never adds missed volume back", () => {
    const missedEverything = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "w1", completion: "missed", actualLengths: null, actualMs: null, rpe: null }),
        settled({
          workoutId: "w2",
          dateISO: "2026-09-11",
          completion: "missed",
          actualLengths: null,
          actualMs: null,
          rpe: null,
        }),
      ],
    });
    expect(missedEverything.decision).toBe("reduce");
    expect(missedEverything.to.mainRepeats * missedEverything.to.mainRepLengths).toBeLessThan(
      dose.mainRepeats * dose.mainRepLengths,
    );
    const future = planOf({
      dose: missedEverything.to,
      weeks: [week(1, "2026-09-14", [slot("a", "2026-09-16")])],
    });
    const baseline = planOf({
      dose,
      weeks: [week(1, "2026-09-14", [slot("a", "2026-09-16")])],
    });
    expect(swimPlanWeekLengths(future.weeks[0]!)).toBeLessThan(
      swimPlanWeekLengths(baseline.weeks[0]!),
    );
  });

  it("holds when effort was never reported", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "w1", rpe: null }),
        settled({ workoutId: "w2", dateISO: "2026-09-11", rpe: null }),
      ],
    });
    expect(proposal.decision).toBe("hold");
    expect(proposal.reasons).toContain("effort_not_reported");
  });

  it("holds when the smallest available step is bigger than the cap", () => {
    const tiny: SwimDose = { mainRepeats: 2, mainRepLengths: 2, mainRestSeconds: 30 };
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose: tiny,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "w1", plannedLengths: 6, actualLengths: 6, rpe: 5 }),
        settled({ workoutId: "w2", plannedLengths: 6, actualLengths: 6, rpe: 5 }),
      ],
    });
    expect(proposal.decision).toBe("hold");
    expect(proposal.reasons).toContain("minimum_increment_exceeds_cap");
    expect(proposal.to).toEqual(tiny);
  });

  it("never returns a dose outside the cap, whatever it is asked", () => {
    const doses: SwimDose[] = [];
    for (const mainRepeats of [1, 2, 3, 5, 8, 13, 21]) {
      for (const mainRepLengths of [1, 2, 4, 7, 12]) {
        doses.push({ mainRepeats, mainRepLengths, mainRestSeconds: 25 });
      }
    }
    const histories: SwimSettledResult[][] = [
      [settled({ workoutId: "w1", rpe: 4 }), settled({ workoutId: "w2", rpe: 4 })],
      [settled({ workoutId: "w1", plannedLengths: 4, actualLengths: 4, rpe: 3 })],
      [
        settled({ workoutId: "w1", completion: "missed", actualLengths: null, actualMs: null, rpe: null }),
        settled({ workoutId: "w2", actualLengths: 10, completion: "partial", rpe: 9 }),
      ],
      [settled({ workoutId: "w1", plannedLengths: 400, actualLengths: 400, rpe: 4 })],
    ];
    for (const candidate of doses) {
      for (const history of histories) {
        const proposal = proposeSwimAdjustment({
          setup: SETUP,
          dose: candidate,
          asOfISO: "2026-09-14",
          history,
        });
        const delta =
          proposal.to.mainRepeats * proposal.to.mainRepLengths -
          proposal.from.mainRepeats * proposal.from.mainRepLengths;
        expect(Math.abs(delta)).toBeLessThanOrEqual(proposal.snapshot.capLengths);
        expect(proposal.to.mainRestSeconds).toBe(candidate.mainRestSeconds);
        const levers =
          (proposal.to.mainRepeats === candidate.mainRepeats ? 0 : 1) +
          (proposal.to.mainRepLengths === candidate.mainRepLengths ? 0 : 1);
        expect(levers).toBeLessThanOrEqual(1);
      }
    }
  });

  it("holds while the primary program is in a recovery week", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [settled({ workoutId: "w1", rpe: 5 }), settled({ workoutId: "w2", rpe: 5 })],
      recovery: { hardStrengthDaysNext7: 0, primaryRecoveryWeek: true },
    });
    expect(proposal.decision).toBe("hold");
    expect(proposal.reasons).toContain("recovery_context");
  });

  it("holds with no settled work at all", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [],
    });
    expect(proposal.decision).toBe("hold");
    expect(proposal.reasons).toEqual(["no_settled_work"]);
  });

  it("only reads same-course, progression-eligible results", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [
        settled({ workoutId: "same", rpe: 6 }),
        settled({ workoutId: "otherPool", course: YARDS_25, rpe: 9 }),
        settled({
          workoutId: "paused",
          rpe: 9,
          lifecycle: { planPaused: true, trashed: false, archivedLate: false },
        }),
        settled({
          workoutId: "late",
          rpe: 9,
          lifecycle: { planPaused: false, trashed: false, archivedLate: true },
        }),
        settled({
          workoutId: "trashed",
          rpe: 9,
          lifecycle: { planPaused: false, trashed: true, archivedLate: false },
        }),
      ],
    });
    expect(proposal.snapshot.consideredResults.map((result) => result.workoutId)).toEqual(["same"]);
    expect(
      proposal.snapshot.excludedResults.map((entry) => [entry.result.workoutId, entry.reason]),
    ).toEqual([
      ["otherPool", "different_course"],
      ["paused", "lifecycle"],
      ["late", "lifecycle"],
      ["trashed", "lifecycle"],
    ]);
    expect(proposal.snapshot.meanRpe).toBe(6);
    expect(proposal.decision).toBe("progress");
  });

  it("freezes the evidence itself, so a later edit cannot rewrite the decision", () => {
    const w1 = settled({ workoutId: "w1", rpe: 6 });
    const history = [w1, settled({ workoutId: "w2", rpe: 6 })];
    const proposal = proposeSwimAdjustment({ setup: SETUP, dose, asOfISO: "2026-09-14", history });
    expect(proposal.snapshot.consideredResults).toEqual(history);
    expect(proposal.snapshot.setup).toEqual(SETUP);
    expect(proposal.snapshot.rules).toEqual(SWIM_PROGRESSION_RULES);
    expect(proposal.snapshot.rules.version).toBe("swim-prog-1");

    const edited = [{ ...w1, actualLengths: 4, completion: "partial" as const }, history[1]!];
    const afterEdit = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: edited,
    });
    expect(afterEdit.decision).toBe("hold");
    // The first proposal still reads the work it was actually made from.
    expect(proposal.snapshot.consideredResults[0]?.actualLengths).toBe(w1.actualLengths);
    expect(proposal.decision).toBe("progress");
  });

  it("holds when any completed session has no effort reported", () => {
    const proposal = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [settled({ workoutId: "w1", rpe: 6 }), settled({ workoutId: "w2", rpe: null })],
    });
    expect(proposal.decision).toBe("hold");
    expect(proposal.reasons).toEqual(["completed_as_prescribed", "effort_not_reported"]);
    expect(proposal.snapshot.meanRpe).toBe(6);
    expect(proposal.snapshot.rpeReported).toBe(1);
    expect(proposal.snapshot.rpeMissing).toBe(1);
  });

  it("persists the exact input snapshot and versions with the proposal", () => {
    const history = [settled({ workoutId: "w1", rpe: 6 }), settled({ workoutId: "w2", rpe: 6 })];
    const first = proposeSwimAdjustment({ setup: SETUP, dose, asOfISO: "2026-09-14", history });
    const second = proposeSwimAdjustment({ setup: SETUP, dose, asOfISO: "2026-09-14", history });
    expect(first).toEqual(second);
    expect(first.proposalId).toBe(second.proposalId);
    expect(first.snapshot.plannedLengths).toBe(50);
    expect(first.snapshot.actualLengths).toBe(50);
    expect(first.snapshot.completionRatio).toBe(1);
    expect(first.snapshot.courseKey).toBe("25/1:m");
    expect(first.versions).toEqual({ model: "swim-model-1", generator: SWIM_GENERATOR_VERSION });

    const differentHistory = proposeSwimAdjustment({
      setup: SETUP,
      dose,
      asOfISO: "2026-09-14",
      history: [settled({ workoutId: "w1", rpe: 9, completion: "partial", actualLengths: 10 })],
    });
    expect(differentHistory.proposalId).not.toBe(first.proposalId);
  });

  it("agrees with the domain lifecycle filter about what is eligible", () => {
    const late = settled({
      workoutId: "late",
      lifecycle: { planPaused: false, trashed: false, archivedLate: true },
    });
    expect(countsTowardProgression(late)).toBe(false);
  });
});

describe("DC-SW5 · decisions, audit and future work", () => {
  const dose = initialSwimDose(SETUP);
  const proposal = proposeSwimAdjustment({
    setup: SETUP,
    dose,
    asOfISO: "2026-09-14",
    history: [settled({ workoutId: "w1", rpe: 6 }), settled({ workoutId: "w2", rpe: 6 })],
  });

  it("records accept, reject and override without losing any of them", () => {
    let ledger = recordSwimDecision(null, {
      proposal,
      action: "accept",
      atISO: "2026-09-14T08:00:00Z",
    });
    expect(ledger.currentDose).toEqual(proposal.to);

    ledger = recordSwimDecision(ledger, {
      proposal,
      action: "reject",
      atISO: "2026-09-21T08:00:00Z",
      note: "Busy week.",
    });
    expect(ledger.currentDose).toEqual(proposal.from);

    ledger = recordSwimDecision(ledger, {
      proposal,
      action: "override",
      atISO: "2026-09-28T08:00:00Z",
      override: { mainRepeats: 8, mainRepLengths: 4, mainRestSeconds: 25 },
    });
    expect(ledger.entries).toHaveLength(3);
    expect(ledger.entries.map((entry) => entry.action)).toEqual(["accept", "reject", "override"]);
    expect(ledger.currentDose).toEqual({ mainRepeats: 8, mainRepLengths: 4, mainRestSeconds: 25 });
  });

  it("applies an override and keeps the warning with it", () => {
    const ledger = recordSwimDecision(null, {
      proposal,
      action: "override",
      atISO: "2026-09-14T08:00:00Z",
      override: { mainRepeats: 10, mainRepLengths: 4, mainRestSeconds: 25 },
    });
    const entry = ledger.entries[0];
    expect(entry?.warning).toContain("lengths");
    expect(entry?.applied).toEqual({ mainRepeats: 10, mainRepLengths: 4, mainRestSeconds: 25 });
    expect(entry?.snapshot).toEqual(proposal.snapshot);
  });

  it("keeps every entry replayable from its own snapshot", () => {
    const ledger = recordSwimDecision(null, {
      proposal,
      action: "accept",
      atISO: "2026-09-14T08:00:00Z",
    });
    const entry = ledger.entries[0];
    expect(entry?.proposalId).toBe(proposal.proposalId);
    expect(entry?.reasons).toEqual(proposal.reasons);
    expect(entry?.versions).toEqual(proposal.versions);
    expect(entry?.snapshot.consideredResults.map((result) => result.workoutId)).toEqual([
      "w1",
      "w2",
    ]);
  });

  it("reissues future unstarted work only", () => {
    const plan = planOf({
      weeks: [
        week(0, "2026-09-07", [slot("past", "2026-09-08"), slot("started", "2026-09-16")]),
        week(1, "2026-09-14", [slot("future", "2026-09-17")]),
      ],
    });
    const applied = applySwimProposal(plan, proposal.to, {
      asOfISO: "2026-09-14",
      startedSlotIds: ["started"],
    });
    expect(applied.ok).toBe(true);
    if (!applied.ok) return;
    const bySlot = new Map(
      applied.value.weeks.flatMap((planWeek) => planWeek.slots.map((s) => [s.slotId, s] as const)),
    );
    const originalBySlot = new Map(
      plan.weeks.flatMap((planWeek) => planWeek.slots.map((s) => [s.slotId, s] as const)),
    );
    for (const slotId of ["past", "started"]) {
      expect(bySlot.get(slotId)).toEqual(originalBySlot.get(slotId));
    }
    const future = bySlot.get("future");
    const futureBefore = originalBySlot.get("future");
    if (future?.kind !== "workout" || futureBefore?.kind !== "workout") {
      throw new Error("expected workouts");
    }
    expect(future.issued.totalLengths).toBeGreaterThan(futureBefore.issued.totalLengths);
    // The first issued version survives beside the new one.
    expect(future.original).toEqual(futureBefore.original);
  });

  it("an accepted benchmark adds targets to future unstarted work only", () => {
    const plan = planOf({
      weeks: [
        week(0, "2026-09-07", [slot("past", "2026-09-08"), slot("started", "2026-09-16")]),
        week(1, "2026-09-14", [slot("future", "2026-09-17")]),
      ],
    });
    const updated = applyAcceptedBenchmark(plan, CALIBRATION, {
      asOfISO: "2026-09-14",
      startedSlotIds: ["started"],
    });
    const bySlot = new Map(
      updated.weeks.flatMap((planWeek) => planWeek.slots.map((s) => [s.slotId, s] as const)),
    );
    const past = bySlot.get("past");
    const started = bySlot.get("started");
    const future = bySlot.get("future");
    if (past?.kind !== "workout" || started?.kind !== "workout" || future?.kind !== "workout") {
      throw new Error("expected workouts");
    }
    expect(past.issued.snapshot.calibration).toBeNull();
    expect(started.issued.snapshot.calibration).toBeNull();
    expect(future.issued.snapshot.calibration?.msPer100).toBe(110_000);
    expect(future.issued.snapshot.versions.assessment).toBe("swim-css-1");
    const futureMain = future.issued.sections.find((section) => section.kind === "main")?.items[0];
    expect(futureMain?.targetMsPerRepeat).toBe(121_000);
    // Volume is untouched: a benchmark is not a dose change.
    expect(future.issued.totalLengths).toBe(future.original.totalLengths);
    expect(future.original.snapshot.calibration).toBeNull();
  });

  it("ignores a benchmark from a different pool", () => {
    const plan = planOf({ setup: { course: YARDS_25 } });
    const updated = applyAcceptedBenchmark(plan, CALIBRATION, {
      asOfISO: "2026-09-07",
      startedSlotIds: [],
    });
    expect(updated).toEqual(plan);
  });

  it.each([false, undefined])("DC-SW2 rejects unverified benchmark acceptance: %s", (verified) => {
    const plan = planOf();
    const observation = { ...CALIBRATION.observation };
    if (verified === undefined) delete observation.verified;
    else observation.verified = verified;
    expect(() => applyAcceptedBenchmark(plan, { ...CALIBRATION, observation }, {
      asOfISO: "2026-09-07", startedSlotIds: [],
    })).toThrow("verified");
    expect(issuedWorkouts(plan).every((workout) => workout.snapshot.calibration === null)).toBe(true);
  });
});

describe("DC-SW6 · generated work feeds native analytics", () => {
  it("reports the week in its own pool", () => {
    const plan = planOf({
      setup: { course: THIRDS_POOL },
      weeks: [week(0, "2026-09-07", [slot("a", "2026-09-09"), slot("b", "2026-09-11", "easy")])],
    });
    const results = plan.weeks[0]!.slots.flatMap((planSlot) =>
      planSlot.kind === "workout"
        ? [
            settled({
              workoutId: planSlot.slotId,
              course: THIRDS_POOL,
              plannedLengths: planSlot.issued.totalLengths,
              actualLengths: planSlot.issued.totalLengths,
            }),
          ]
        : [],
    );
    const summary = summarizeSwimWeek({ weekStartISO: "2026-09-07", results });
    expect(summary.byCourse).toHaveLength(1);
    expect(summary.byCourse[0]?.courseKey).toBe("100/3:m");
    expect(summary.byCourse[0]?.actualLengths).toBe(swimPlanWeekLengths(plan.weeks[0]!));
    expect(summary.adherence).toBe(1);
  });
});

describe("DC-SW3 · weekday form expands to explicit dated slots", () => {
  it("produces one slot per selected weekday per week", () => {
    const result = swimWeeksFromWeekdays({
      startDateISO: "2026-09-07",
      weeks: 3,
      weekdays: [1, 4],
      defaultIntent: "moderate",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((week) => week.slots.map((slot) => slot.dateISO))).toEqual([
      ["2026-09-07", "2026-09-10"],
      ["2026-09-14", "2026-09-17"],
      ["2026-09-21", "2026-09-24"],
    ]);
    expect(result.value[0]?.slots[0]?.slotId).toBe("swim-2026-09-07");
    expect(result.value[0]?.slots[0]?.source).toBe("swim_date");
    expect(result.value[1]?.startDateISO).toBe("2026-09-14");
  });

  it("allows a plan with no swim days at all", () => {
    const result = swimWeeksFromWeekdays({ startDateISO: "2026-09-07", weeks: 2, weekdays: [] });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.map((week) => week.slots.length)).toEqual([0, 0]);
    const plan = generateSwimPlan({ setup: SETUP, calibration: null, weeks: [...result.value] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.weeks.every((week) => week.slots.length === 0)).toBe(true);
  });

  it("takes per-weekday intents and a shared budget", () => {
    const result = swimWeeksFromWeekdays({
      startDateISO: "2026-09-07",
      weeks: 1,
      weekdays: [1, 6],
      intentByWeekday: { 1: "easy", 6: "hard" },
      budgetMinutes: 40,
      source: "cardio_slot",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value[0]?.slots.map((slot) => [slot.intent, slot.budgetMinutes, slot.source])).toEqual([
      ["easy", 40, "cardio_slot"],
      ["hard", 40, "cardio_slot"],
    ]);
  });

  it("rejects an invalid start date, week count or weekday", () => {
    expect(swimWeeksFromWeekdays({ startDateISO: "not-a-date", weeks: 1, weekdays: [1] }).ok).toBe(false);
    expect(swimWeeksFromWeekdays({ startDateISO: "2026-09-07", weeks: 0, weekdays: [1] }).ok).toBe(false);
    expect(swimWeeksFromWeekdays({ startDateISO: "2026-09-07", weeks: 1, weekdays: [7] }).ok).toBe(false);
  });

  it("is deterministic and feeds the generator unchanged", () => {
    const first = swimWeeksFromWeekdays({ startDateISO: "2026-09-07", weeks: 2, weekdays: [2, 5] });
    const second = swimWeeksFromWeekdays({ startDateISO: "2026-09-07", weeks: 2, weekdays: [5, 2, 5] });
    expect(first).toEqual(second);
    if (!first.ok) return;
    const plan = generateSwimPlan({ setup: SETUP, calibration: null, weeks: [...first.value] });
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    expect(plan.value.weeks.flatMap((week) => week.slots.map((slot) => slot.dateISO))).toEqual([
      "2026-09-08",
      "2026-09-11",
      "2026-09-15",
      "2026-09-18",
    ]);
  });
});
