/**
 * Pool swimming — the generator (ADR 0079).
 *
 * Three things make this different from the strength engines:
 *
 *   1. It generates against EXPLICIT dated slots. A week is a list of the
 *      calendar slots that actually exist (a replaced cardio day, an added swim
 *      date), so a week can hold zero slots or five. There is no frequency
 *      constant, no "weeks × sessions" grid, and nothing to catch up on: a week
 *      with fewer slots is less swimming, not a backlog (DC-E3, DC-SW3).
 *   2. Adaptation is derived, never incremented. `proposeSwimAdjustment` is a
 *      pure function of settled results; there is no mutable fitness counter to
 *      drift out of sync with history (DC-SW4).
 *   3. Unknown pace stays unknown. Without a compatible calibration the swimmer
 *      gets effort and rest, the session is BOUNDED by the time budget, and no
 *      duration or pace target is claimed (ADR 0079 "Assessment and progression").
 *
 * Every dose, ramp and rest number below is a versioned heuristic documented in
 * `docs/knowledge/pool-swimming.md`. None of them is claimed to be calibrated.
 */

import {
  MAX_POOL_LENGTHS,
  SWIM_HEURISTIC_DOC,
  SWIM_MODEL_VERSION,
  calibrationSnapshot,
  countsTowardProgression,
  daysBetweenISO,
  formatPoolCourse,
  isISODate,
  isUsableSwimCalibration,
  addDaysISO,
  weekdayOfISO,
  type SwimDose,
  type SwimEventPrep,
  type SwimDecisionAction,
  type SwimDecisionEntry,
  type SwimDecisionKind,
  type SwimDecisionLedger,
  type SwimLever,
  type SwimProposal,
  type SwimProposalReason,
  type SwimProposalSnapshot,
  type SwimEvidenceExclusion,
  type SwimProgressionRules,
  lengthsForNativeDistance,
  paceTargetMs,
  poolCourseEquals,
  poolCourseKey,
  swimErr,
  swimOk,
  swimWorkoutLengths,
  validateSwimSetup,
  type PoolCourse,
  type SwimCalibration,
  type SwimEffort,
  type SwimEquipment,
  type SwimError,
  type SwimExperience,
  type SwimFocus,
  type SwimIssue,
  type SwimItem,
  type SwimLearningGuidance,
  type SwimResult,
  type SwimSection,
  type SwimSettledResult,
  type SwimSetup,
  type SwimStroke,
  type SwimWorkout,
} from "@hta/domain";

/** Generator rule version stamped into every issued prescription (DC-SW5). */
export const SWIM_GENERATOR_VERSION = "swim-gen-1" as const;

// ---------------------------------------------------------------------------
// Versioned heuristics. See SWIM_HEURISTIC_DOC.
// ---------------------------------------------------------------------------

/** Seconds spent at the wall between items, on top of prescribed rest. */
export const SWIM_TRANSITION_SECONDS = 20;

/** Native units of easy swimming a full warm-up and cool-down aim for. */
export const SWIM_WARMUP_NATIVE_UNITS = 100;
export const SWIM_COOLDOWN_NATIVE_UNITS = 50;

/** The main set is never cut below this. */
export const SWIM_MIN_MAIN_REPEATS = 1;
export const SWIM_MIN_MAIN_REP_LENGTHS = 1;
export const SWIM_MIN_EDGE_LENGTHS = 1;

/**
 * A progression step adds at most 20% of a prescribed session — DC-K5's
 * week-to-week bound — and never more than 8 lengths, and the produced dose is
 * re-checked against that cap before it is returned: the cap is a runtime
 * bound, not a test convention.
 *
 * A dose whose smallest available step exceeds the cap holds instead of
 * jumping — see `proposeSwimAdjustment`.
 */
export const SWIM_PROGRESSION_CAP_FRACTION = 0.2;
export const SWIM_PROGRESSION_MAX_LENGTHS = 8;

/** Effort/completion thresholds that decide progress vs hold vs reduce. */
export const SWIM_HIGH_RPE = 7.5;
export const SWIM_EASY_RPE = 6.5;
export const SWIM_STRONG_COMPLETION = 0.95;

/** Version of the progression rule set, stamped into every proposal. */
export const SWIM_PROGRESSION_RULES_VERSION = "swim-prog-1" as const;

/**
 * The rule constants above, frozen into each proposal so a decision stays
 * readable under a later rule set (DC-SW5).
 */
export const SWIM_PROGRESSION_RULES: SwimProgressionRules = {
  version: SWIM_PROGRESSION_RULES_VERSION,
  strongCompletion: SWIM_STRONG_COMPLETION,
  highRpe: SWIM_HIGH_RPE,
  easyRpe: SWIM_EASY_RPE,
  capFraction: SWIM_PROGRESSION_CAP_FRACTION,
  maxStepLengths: SWIM_PROGRESSION_MAX_LENGTHS,
  minMainRepeats: SWIM_MIN_MAIN_REPEATS,
  minMainRepLengths: SWIM_MIN_MAIN_REP_LENGTHS,
};

/** Longest event-preparation window; threshold work exists nowhere else. */
export const SWIM_MAX_EVENT_PREP_WEEKS = 4;
/** Days before the event where volume eases. */
export const SWIM_TAPER_DAYS = 7;
export const SWIM_TAPER_VOLUME_FACTOR = 0.6;

/** Volume and effort per slot intent. */
const INTENT_SHAPE: Readonly<
  Record<SwimSlotIntent["intent"], { volume: number; effort: SwimEffort; extraRestSeconds: number }>
> = {
  recovery: { volume: 0.6, effort: "easy", extraRestSeconds: 10 },
  easy: { volume: 0.8, effort: "easy", extraRestSeconds: 5 },
  moderate: { volume: 1, effort: "steady", extraRestSeconds: 0 },
  hard: { volume: 0.9, effort: "brisk", extraRestSeconds: 0 },
};

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface SwimSlotIntent {
  readonly slotId: string;
  readonly dateISO: string;
  readonly intent: "easy" | "moderate" | "hard" | "recovery";
  /** Slot-specific budget; falls back to the setup's session budget. */
  readonly budgetMinutes?: number | undefined;
  readonly source: "swim_date" | "cardio_slot";
}

export interface SwimWeekRequest {
  readonly weekIndex: number;
  readonly startDateISO: string;
  readonly slots: readonly SwimSlotIntent[];
}

export type {
  SwimDecisionAction,
  SwimDecisionEntry,
  SwimDecisionKind,
  SwimDecisionLedger,
  SwimDose,
  SwimEventPrep,
  SwimLever,
  SwimProposal,
  SwimProposalReason,
  SwimProposalSnapshot,
} from "@hta/domain";

export interface SwimPlanInput {
  readonly setup: SwimSetup;
  readonly calibration: SwimCalibration | null;
  readonly weeks: readonly SwimWeekRequest[];
  readonly dose?: SwimDose | undefined;
  readonly eventPrep?: SwimEventPrep | undefined;
}

interface SwimSlotOutcomeBase {
  readonly slotId: string;
  readonly dateISO: string;
  readonly intent: SwimSlotIntent["intent"];
  /** Where the date came from: an added swim day or a bound cardio slot. */
  readonly source: SwimSlotIntent["source"];
}

export type SwimSlotOutcome =
  | (SwimSlotOutcomeBase & {
      readonly kind: "workout";
      /** As first generated. Never rewritten. */
      readonly original: SwimWorkout;
      /** Authoritative for the swimmer. Accepted benchmarks reissue this. */
      readonly issued: SwimWorkout;
    })
  | (SwimSlotOutcomeBase & { readonly kind: "conflict"; readonly conflict: SwimError })
  | (SwimSlotOutcomeBase & {
      readonly kind: "guidance";
      readonly guidance: SwimLearningGuidance;
    });

export interface SwimPlanWeek {
  readonly weekIndex: number;
  readonly startDateISO: string;
  /** Future baseline weeks are provisional until their week is reached. */
  readonly provisional: boolean;
  readonly slots: readonly SwimSlotOutcome[];
}

export interface SwimPlan {
  readonly setup: SwimSetup;
  readonly calibration: SwimCalibration | null;
  readonly dose: SwimDose;
  readonly eventPrep: SwimEventPrep | null;
  readonly weeks: readonly SwimPlanWeek[];
  readonly versions: {
    readonly model: string;
    readonly generator: string;
    readonly assessment: string | null;
  };
}

// ---------------------------------------------------------------------------
// Starting dose
// ---------------------------------------------------------------------------

/**
 * The first main set, from what the swimmer can already do comfortably.
 * Deliberately conservative: an unverified swimmer gets less than they can
 * probably manage, and `proposeSwimAdjustment` moves it from real results.
 */
export function initialSwimDose(setup: SwimSetup): SwimDose {
  const comfortable = Math.max(0, Math.min(setup.recentComfortableLengths, MAX_POOL_LENGTHS));
  if (comfortable === 0) return { mainRepeats: 0, mainRepLengths: 0, mainRestSeconds: 0 };
  const repLengths =
    setup.goal === "endurance"
      ? clampInt(Math.floor(comfortable / 2), 1, 4)
      : Math.min(2, comfortable);
  const targetMainLengths = comfortable * 2;
  const repeats = clampInt(Math.floor(targetMainLengths / repLengths), 2, 20);
  const rest =
    setup.experience === "trained" ? 20 : setup.experience === "recreational" ? 25 : 40;
  return { mainRepeats: repeats, mainRepLengths: repLengths, mainRestSeconds: rest };
}

function clampInt(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(value)));
}

// ---------------------------------------------------------------------------
// Timing model
//
// There is no planning pace. Without a calibration for the exact course,
// stroke and equipment of an item, how long that item takes is UNKNOWN, and
// nothing here invents it — not from experience, not from a stroke factor, not
// from an equipment factor. What is known is the rest the prescription asks
// for and the turnaround between items; that is what the time budget bounds.
// ---------------------------------------------------------------------------

interface SessionTiming {
  /** Rest and turnarounds. Always known, because the prescription states them. */
  readonly knownMs: number;
  /** Time in the water for the items the calibration actually covers. */
  readonly pricedSwimMs: number;
  /** True when every item was priced, so the total is the whole session. */
  readonly allPriced: boolean;
}

/** Rest between repeats plus one turnaround. Never an estimate of swimming. */
function itemKnownMs(item: SwimItem): number {
  const restMs = (item.restSeconds ?? 0) * 1000 * Math.max(0, item.repeats - 1);
  return restMs + SWIM_TRANSITION_SECONDS * 1000;
}

/**
 * Time in the water for one item, or `null` when it is not known. It is known
 * only when the calibration covers the item's exact conditions — `paceTargetMs`
 * enforces that match, so a different stroke or a pull buoy makes the pace
 * unknown rather than adjusted — and only for straight swimming: a drill is a
 * different activity and its pace is not the swimmer's swimming pace.
 */
function itemSwimMs(
  item: SwimItem,
  course: PoolCourse,
  calibration: SwimCalibration | null,
): number | null {
  if (item.drill !== undefined) return null;
  const perRepeat = paceTargetMs(
    calibration,
    item.effort,
    item.lengths,
    course,
    item.stroke,
    item.equipment,
  );
  return perRepeat === null ? null : perRepeat * item.repeats;
}

function sectionsTiming(
  sections: readonly SwimSection[],
  course: PoolCourse,
  calibration: SwimCalibration | null,
): SessionTiming {
  let knownMs = 0;
  let pricedSwimMs = 0;
  let allPriced = true;
  for (const section of sections) {
    for (const item of section.items) {
      knownMs += itemKnownMs(item) * section.rounds;
      const itemMs = itemSwimMs(item, course, calibration);
      if (itemMs === null) allPriced = false;
      else pricedSwimMs += itemMs * section.rounds;
    }
  }
  return { knownMs: Math.round(knownMs), pricedSwimMs: Math.round(pricedSwimMs), allPriced };
}

/**
 * What the budget is measured against: everything actually known about this
 * session. When an item has no matching calibration this is a lower bound —
 * the session takes at LEAST this long — never a predicted finish time.
 */
function boundedMs(timing: SessionTiming): number {
  return timing.knownMs + timing.pricedSwimMs;
}

// ---------------------------------------------------------------------------
// Template
// ---------------------------------------------------------------------------

function edgeLengths(course: PoolCourse, nativeUnits: number, comfortable: number): number {
  const perLength = course.numerator / course.denominator;
  const target = Math.max(SWIM_MIN_EDGE_LENGTHS, Math.round(nativeUnits / perLength));
  return Math.max(SWIM_MIN_EDGE_LENGTHS, Math.min(target, Math.max(1, comfortable)));
}

function primaryStroke(setup: SwimSetup): SwimStroke {
  if (setup.knownStrokes.includes("freestyle")) return "freestyle";
  return setup.knownStrokes[0] ?? "freestyle";
}

/**
 * Easy swimming is the swimmer's choice — unless they know exactly one stroke,
 * in which case naming "choice" would be a fiction and it is simply that
 * stroke. This is not a substitution: it is the only stroke they have.
 */
function easyStroke(setup: SwimSetup): SwimStroke {
  return setup.knownStrokes.length === 1 ? primaryStroke(setup) : "choice";
}

interface BuildContext {
  readonly setup: SwimSetup;
  readonly calibration: SwimCalibration | null;
  readonly dose: SwimDose;
  readonly intent: SwimSlotIntent["intent"];
  readonly effort: SwimEffort;
  readonly volumeFactor: number;
  readonly budgetMinutes: number;
  readonly focus: SwimFocus;
}

/**
 * The template. Deliberately small and original: an easy start, a short
 * preparation block, one main set that carries the session's purpose, an
 * optional loosen-off and an easy finish. Scaling removes the optional work
 * first and never removes the easy start, the easy finish or the main set
 * (DC-E1, DC-SW3).
 */
function buildSections(context: BuildContext): SwimSection[] {
  const { setup, dose } = context;
  const course = setup.course;
  const stroke = primaryStroke(setup);
  const easy = easyStroke(setup);
  const comfortable = setup.recentComfortableLengths;
  const warmup = edgeLengths(course, SWIM_WARMUP_NATIVE_UNITS, comfortable);
  const cooldown = edgeLengths(course, SWIM_COOLDOWN_NATIVE_UNITS, comfortable);
  const repeats = Math.max(
    SWIM_MIN_MAIN_REPEATS,
    Math.round(dose.mainRepeats * context.volumeFactor),
  );
  const rest = dose.mainRestSeconds + INTENT_SHAPE[context.intent].extraRestSeconds;
  const hasKickboard = setup.equipment.includes("kickboard");
  const hasPullBuoy = setup.equipment.includes("pull_buoy");

  const sections: SwimSection[] = [
    {
      kind: "warmup",
      label: "Warm-up",
      rounds: 1,
      items: [
        {
          repeats: 1,
          lengths: warmup,
          stroke,
          effort: "easy",
          equipment: [],
          optional: false,
          note: "Build into it.",
          ...withPaceTarget(context, warmup, "easy", stroke, []),
        },
      ],
    },
  ];

  // Drills belong to the technique focus. Elsewhere the preparation block is
  // short easy swimming, unless a kickboard is available to vary it.
  const prepIsDrill = context.focus === "technique_base" || hasKickboard;
  const prepItems: SwimItem[] = [
    prepIsDrill
      ? {
          repeats: context.focus === "technique_base" ? 4 : 2,
          lengths: 1,
          stroke: hasKickboard ? "kick" : stroke,
          effort: "easy",
          equipment: hasKickboard ? ["kickboard"] : [],
          drill: hasKickboard ? "kick_with_board" : "single_arm",
          restSeconds: 20,
          optional: context.focus !== "technique_base",
        }
      : {
          repeats: 2,
          lengths: 1,
          stroke,
          effort: "easy",
          equipment: [],
          restSeconds: 20,
          optional: true,
          note: "Find the rhythm before the main set.",
          ...withPaceTarget(context, 1, "easy", stroke, []),
        },
  ];
  if (context.focus === "technique_base" && hasPullBuoy) {
    prepItems.push({
      repeats: 2,
      lengths: 1,
      stroke,
      effort: "easy",
      equipment: ["pull_buoy"],
      drill: "pull_count_strokes",
      restSeconds: 20,
      optional: true,
    });
  }
  sections.push({ kind: "preparation", label: "Preparation", rounds: 1, items: prepItems });

  sections.push({
    kind: "main",
    label: "Main set",
    rounds: 1,
    items: [
      {
        repeats,
        lengths: dose.mainRepLengths,
        stroke,
        effort: context.effort,
        equipment: [],
        restSeconds: rest,
        optional: false,
        ...withPaceTarget(context, dose.mainRepLengths, context.effort, stroke, []),
      },
    ],
  });

  sections.push({
    kind: "recovery",
    label: "Loosen off",
    rounds: 1,
    items: [
      {
        repeats: 1,
        lengths: 1,
        stroke: easy,
        effort: "easy",
        equipment: [],
        optional: true,
        ...withPaceTarget(context, 1, "easy", easy, []),
      },
    ],
  });

  sections.push({
    kind: "cooldown",
    label: "Cool-down",
    rounds: 1,
    items: [
      {
        repeats: 1,
        lengths: cooldown,
        stroke: easy,
        effort: "easy",
        equipment: [],
        optional: false,
        ...withPaceTarget(context, cooldown, "easy", easy, []),
      },
    ],
  });

  return sections;
}

function withPaceTarget(
  context: BuildContext,
  lengths: number,
  effort: SwimEffort,
  stroke: SwimStroke,
  equipment: readonly SwimEquipment[],
): { targetMsPerRepeat?: number } {
  const target = paceTargetMs(
    context.calibration,
    effort,
    lengths,
    context.setup.course,
    stroke,
    equipment,
  );
  return target === null ? {} : { targetMsPerRepeat: target };
}

/**
 * Change how far one repeat goes. The pace target is stated per repeat, so it
 * is recomputed rather than carried over from the previous distance.
 */
function withLengths(item: SwimItem, lengths: number, context: BuildContext): SwimItem {
  const { targetMsPerRepeat: _drop, ...rest } = item;
  return {
    ...rest,
    lengths,
    ...(item.drill === undefined
      ? withPaceTarget(context, lengths, item.effort, item.stroke, item.equipment)
      : {}),
  };
}

// ---------------------------------------------------------------------------
// Budget scaling
// ---------------------------------------------------------------------------

function scaleToBudget(
  sections: readonly SwimSection[],
  context: BuildContext,
): SwimResult<readonly SwimSection[]> {
  const course = context.setup.course;
  const budgetMs = context.budgetMinutes * 60_000;
  let current: SwimSection[] = sections.map((section) => ({ ...section, items: [...section.items] }));

  const fits = (candidate: readonly SwimSection[]): boolean =>
    boundedMs(sectionsTiming(candidate, course, context.calibration)) <= budgetMs;

  if (fits(current)) return swimOk(current);

  // 1. Drop optional work.
  current = current
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.optional) }))
    .filter((section) => section.items.length > 0);
  if (fits(current)) return swimOk(current);

  // 2. Shorten the main set, one repeat at a time, down to one repeat.
  for (;;) {
    const main = current.find((section) => section.kind === "main");
    const item = main?.items[0];
    if (!main || !item || item.repeats <= SWIM_MIN_MAIN_REPEATS) break;
    current = replaceMain(current, { ...item, repeats: item.repeats - 1 });
    if (fits(current)) return swimOk(current);
  }

  // 3. Shorten each main repeat, down to one length.
  for (;;) {
    const main = current.find((section) => section.kind === "main");
    const item = main?.items[0];
    if (!main || !item || item.lengths <= SWIM_MIN_MAIN_REP_LENGTHS) break;
    current = replaceMain(current, withLengths(item, item.lengths - 1, context));
    if (fits(current)) return swimOk(current);
  }

  // 4. Trim the easy start and finish, never below one length each.
  for (;;) {
    const trimmable = current.find(
      (section) =>
        (section.kind === "warmup" || section.kind === "cooldown") &&
        (section.items[0]?.lengths ?? 0) > SWIM_MIN_EDGE_LENGTHS,
    );
    const item = trimmable?.items[0];
    if (!trimmable || !item) break;
    current = current.map((section) =>
      section === trimmable
        ? { ...section, items: [withLengths(item, item.lengths - 1, context)] }
        : section,
    );
    if (fits(current)) return swimOk(current);
  }

  const minimum = sectionsTiming(current, course, context.calibration);
  const minimumMinutes = Math.ceil(boundedMs(minimum) / 60_000);
  const message = minimum.allPriced
    ? `${context.budgetMinutes} minutes is not enough for an easy start, a main set and an easy finish in a ${formatPoolCourse(
        course,
      )} pool. This session needs about ${minimumMinutes} minutes.`
    : `${context.budgetMinutes} minutes is not enough for this session in a ${formatPoolCourse(
        course,
      )} pool: the rest and turnarounds it asks for already take about ${minimumMinutes} minutes, before any swimming.`;
  return swimErr("budget_impossible", message, {
    budgetMinutes: context.budgetMinutes,
    minimumMinutes,
    accounts: minimum.allPriced ? "whole_session" : "known_time_only",
    options: [
      `Allow ${minimumMinutes} minutes for this session`,
      "Use a shorter pool for this session",
      "Move this session to another day",
    ],
    doc: SWIM_HEURISTIC_DOC,
  });
}

function replaceMain(sections: readonly SwimSection[], item: SwimItem): SwimSection[] {
  return sections.map((section) =>
    section.kind === "main" ? { ...section, items: [item] } : section,
  );
}

// ---------------------------------------------------------------------------
// Workout assembly
// ---------------------------------------------------------------------------

function buildWorkout(context: BuildContext): SwimResult<SwimWorkout> {
  const sections = buildSections(context);
  const scaled = scaleToBudget(sections, context);
  if (!scaled.ok) return scaled;
  const course = context.setup.course;
  const timing = sectionsTiming(scaled.value, course, context.calibration);
  const strokes = [...new Set(scaled.value.flatMap((s) => s.items.map((i) => i.stroke)))];
  const equipment = [
    ...new Set(scaled.value.flatMap((s) => s.items.flatMap((i) => [...i.equipment]))),
  ];
  const workout: SwimWorkout = {
    kind: "swim_workout",
    focus: context.focus,
    sections: scaled.value,
    totalLengths: 0,
    snapshot: {
      course,
      strokes,
      equipment,
      protocol: context.calibration?.protocol ?? null,
      calibration: context.calibration ? calibrationSnapshot(context.calibration) : null,
      versions: {
        model: SWIM_MODEL_VERSION,
        generator: SWIM_GENERATOR_VERSION,
        assessment: context.calibration?.version ?? null,
      },
    },
    estimatedMs: timing.allPriced ? boundedMs(timing) : null,
    budget: {
      minutes: context.budgetMinutes,
      accountedMs: boundedMs(timing),
    },
  };
  return swimOk({ ...workout, totalLengths: swimWorkoutLengths(workout) });
}

function learningGuidance(setup: SwimSetup, minutes: number): SwimLearningGuidance {
  return {
    kind: "swim_learning_guidance",
    reason: "no_comfortable_length",
    course: setup.course,
    minutes,
    steps: [
      "Enter the water in your depth and settle your breathing.",
      "Hold the wall or a float and blow bubbles out, face in the water.",
      "Push off the wall and glide, face down, as far as it carries you.",
      "Add a few kicks to each glide, then stand up.",
      "Repeat in short goes, resting whenever you want to.",
    ],
    versions: { model: SWIM_MODEL_VERSION, generator: SWIM_GENERATOR_VERSION },
  };
}

// ---------------------------------------------------------------------------
// Plan generation
// ---------------------------------------------------------------------------

function eventContext(
  input: SwimPlanInput,
): SwimResult<{ eventDateISO: string | null; prepFromISO: string | null }> {
  const event = input.setup.event;
  if (!event) return swimOk({ eventDateISO: null, prepFromISO: null });
  const firstWeek = input.weeks[0];
  if (!firstWeek) return swimOk({ eventDateISO: event.dateISO, prepFromISO: null });
  const days = daysBetweenISO(firstWeek.startDateISO, event.dateISO);
  if (days < 0) {
    return swimErr(
      "event_infeasible",
      `Your event date (${event.dateISO}) is before this plan starts.`,
      {
        options: ["Choose a later event date", "Start the plan earlier", "Plan without an event"],
      },
    );
  }
  const eventLengths = lengthsForNativeDistance(event.distance, input.setup.course);
  if (!eventLengths.ok && event.unit === input.setup.course.unit) {
    return swimErr(
      "event_infeasible",
      `${event.distance} ${event.unit} is not a whole number of lengths in a ${formatPoolCourse(
        input.setup.course,
      )} pool, so it cannot be prepared for exactly here.`,
      {
        options: [
          "Prepare in the pool the event is held in",
          "Choose an event distance this pool measures exactly",
          "Plan without an event",
        ],
      },
    );
  }
  if (days < SWIM_TAPER_DAYS) {
    return swimErr(
      "event_infeasible",
      `Your event is ${days} days away, which is less than the ${SWIM_TAPER_DAYS}-day ease-off this plan uses.`,
      {
        options: [
          "Keep training as it is and treat the event as a swim",
          "Choose a later event",
          "Plan without an event",
        ],
      },
    );
  }
  return swimOk({ eventDateISO: event.dateISO, prepFromISO: null });
}

function thresholdAllowed(
  input: SwimPlanInput,
  eventDateISO: string | null,
  dateISO: string,
): boolean {
  const prep = input.eventPrep;
  if (!prep?.enabled || !eventDateISO) return false;
  const windowWeeks = Math.min(prep.windowWeeks, SWIM_MAX_EVENT_PREP_WEEKS);
  if (windowWeeks <= 0) return false;
  const daysToEvent = daysBetweenISO(dateISO, eventDateISO);
  return daysToEvent >= 0 && daysToEvent <= windowWeeks * 7;
}

/**
 * Build the multi-week baseline against the slots that exist.
 *
 * Volume does not ramp across the baseline: an unstarted week has produced no
 * results, so there is nothing to progress from. Weeks after the first are
 * marked provisional and `proposeSwimAdjustment` moves them from real history.
 */
export function generateSwimPlan(input: SwimPlanInput): SwimResult<SwimPlan> {
  const blocking = validateSwimSetup(input.setup).filter((issue) => issue.severity === "blocking");
  if (blocking.length > 0) {
    return swimErr("setup_invalid", firstMessage(blocking), { issues: blocking });
  }
  for (const week of input.weeks) {
    if (!isISODate(week.startDateISO)) {
      return swimErr("setup_invalid", `Week ${week.weekIndex} has no valid start date.`, {
        weekIndex: week.weekIndex,
      });
    }
    for (const slot of week.slots) {
      if (!isISODate(slot.dateISO)) {
        return swimErr("setup_invalid", `Slot ${slot.slotId} has no valid date.`, {
          slotId: slot.slotId,
        });
      }
    }
  }
  const events = eventContext(input);
  if (!events.ok) return events;
  const { eventDateISO } = events.value;

  const dose = input.dose ?? initialSwimDose(input.setup);
  const calibration =
    input.calibration && isUsableSwimCalibration(input.calibration) &&
    poolCourseEquals(input.calibration.course, input.setup.course)
      ? input.calibration
      : null;
  const learning = input.setup.recentComfortableLengths < 1;

  const weeks: SwimPlanWeek[] = input.weeks.map((week) => ({
    weekIndex: week.weekIndex,
    startDateISO: week.startDateISO,
    provisional: week.weekIndex > 0,
    slots: week.slots.map((slot): SwimSlotOutcome => {
      const budgetMinutes = slot.budgetMinutes ?? input.setup.sessionBudgetMinutes;
      const identity = {
        slotId: slot.slotId,
        dateISO: slot.dateISO,
        intent: slot.intent,
        source: slot.source,
      };
      if (learning) {
        return {
          ...identity,
          kind: "guidance",
          guidance: learningGuidance(input.setup, budgetMinutes),
        };
      }
      const shape = INTENT_SHAPE[slot.intent];
      const taper =
        eventDateISO !== null &&
        daysBetweenISO(slot.dateISO, eventDateISO) >= 0 &&
        daysBetweenISO(slot.dateISO, eventDateISO) <= SWIM_TAPER_DAYS;
      const effort: SwimEffort =
        slot.intent === "hard" && thresholdAllowed(input, eventDateISO, slot.dateISO)
          ? "threshold"
          : shape.effort;
      const focus: SwimFocus =
        eventDateISO !== null && thresholdAllowed(input, eventDateISO, slot.dateISO)
          ? "event_specific"
          : input.setup.goal;
      const context: BuildContext = {
        setup: input.setup,
        calibration,
        dose,
        intent: slot.intent,
        effort,
        volumeFactor: shape.volume * (taper ? SWIM_TAPER_VOLUME_FACTOR : 1),
        budgetMinutes,
        focus,
      };
      const built = buildWorkout(context);
      if (!built.ok) {
        return { ...identity, kind: "conflict", conflict: built.error };
      }
      return { ...identity, kind: "workout", original: built.value, issued: built.value };
    }),
  }));

  return swimOk({
    setup: input.setup,
    calibration,
    dose,
    eventPrep: input.eventPrep ?? null,
    weeks,
    versions: {
      model: SWIM_MODEL_VERSION,
      generator: SWIM_GENERATOR_VERSION,
      assessment: calibration?.version ?? null,
    },
  });
}

function firstMessage(issues: readonly SwimIssue[]): string {
  return issues[0]?.message ?? "This setup is incomplete.";
}

// ---------------------------------------------------------------------------
// Progression (DC-SW4)
// ---------------------------------------------------------------------------

export interface SwimProposalInput {
  readonly setup: SwimSetup;
  readonly dose: SwimDose;
  readonly history: readonly SwimSettledResult[];
  readonly asOfISO: string;
  readonly recovery?:
    | { readonly hardStrengthDaysNext7: number; readonly primaryRecoveryWeek: boolean }
    | undefined;
}

/**
 * The next main set, derived from settled work.
 *
 * Missed volume is never added back — a miss lowers the completion ratio and,
 * with high reported effort or repetition, produces a REDUCE. It never becomes
 * extra lengths next week (DC-E3).
 *
 * A completed block with no reported effort HOLDS. Silence is not evidence the
 * dose was easy.
 */
export function proposeSwimAdjustment(input: SwimProposalInput): SwimProposal {
  const course = input.setup.course;
  const considered: SwimSettledResult[] = [];
  const excluded: { result: SwimSettledResult; reason: SwimEvidenceExclusion }[] = [];
  for (const result of input.history) {
    if (!poolCourseEquals(result.course, course)) {
      excluded.push({ result, reason: "different_course" });
      continue;
    }
    if (!countsTowardProgression(result)) {
      excluded.push({ result, reason: "lifecycle" });
      continue;
    }
    considered.push(result);
  }
  const plannedLengths = considered.reduce((sum, r) => sum + r.plannedLengths, 0);
  const actualLengths = considered.reduce((sum, r) => sum + (r.actualLengths ?? 0), 0);
  const missedSessions = considered.filter((r) => r.completion === "missed").length;
  // Effort is read only from sessions that happened; a missed session has no
  // effort to report. Among the sessions that DID happen, a single unreported
  // effort makes the mean an average of the ones the swimmer chose to log —
  // which is not evidence the block was comfortable, so it holds.
  const swum = considered.filter((r) => r.completion !== "missed");
  const rpes = swum.map((r) => r.rpe).filter((rpe): rpe is number => rpe !== null);
  const rpeMissing = swum.length - rpes.length;
  const meanRpe =
    rpes.length === 0 ? null : Math.round((rpes.reduce((a, b) => a + b, 0) / rpes.length) * 100) / 100;
  const actualMsValues = considered
    .map((r) => r.actualMs)
    .filter((ms): ms is number => ms !== null);
  const completionRatio = plannedLengths === 0 ? null : actualLengths / plannedLengths;
  const mainLengths = input.dose.mainRepeats * input.dose.mainRepLengths;
  // DC-K5 bounds the week-to-week jump in what the swimmer actually does, so
  // the cap is a fraction of a whole prescribed session — warm-up, main set and
  // easy finish — not of the main set alone. With no settled session to measure
  // it falls back to the main set, which is the conservative reading.
  const sessionLengths =
    considered.length === 0 ? mainLengths : Math.round(plannedLengths / considered.length);
  const capLengths = Math.min(
    SWIM_PROGRESSION_MAX_LENGTHS,
    Math.floor(Math.max(sessionLengths, mainLengths) * SWIM_PROGRESSION_CAP_FRACTION),
  );
  const snapshot: SwimProposalSnapshot = {
    asOfISO: input.asOfISO,
    courseKey: poolCourseKey(course),
    setup: input.setup,
    consideredResults: considered,
    excludedResults: excluded,
    rules: SWIM_PROGRESSION_RULES,
    plannedLengths,
    actualLengths,
    completionRatio,
    missedSessions,
    meanRpe,
    rpeReported: rpes.length,
    rpeMissing,
    actualMs: actualMsValues.length === 0 ? null : actualMsValues.reduce((a, b) => a + b, 0),
    recovery: input.recovery ?? null,
    capLengths,
  };

  const hold = (reasons: readonly SwimProposalReason[]): SwimProposal =>
    finish("hold", "none", input.dose, reasons, snapshot);

  if (considered.length === 0) return hold(["no_settled_work"]);

  const reduceTriggered =
    missedSessions >= 2 || (missedSessions >= 1 && meanRpe !== null && meanRpe >= SWIM_HIGH_RPE);
  if (reduceTriggered) {
    const reasons: SwimProposalReason[] = ["missed_sessions"];
    if (meanRpe !== null && meanRpe >= SWIM_HIGH_RPE) reasons.push("effort_high");
    const reduced = reduceDose(input.dose, capLengths);
    if (reduced === null) return hold([...reasons, "already_at_minimum"]);
    return finish("reduce", reduced.lever, reduced.dose, reasons, snapshot);
  }

  if (meanRpe !== null && meanRpe >= SWIM_HIGH_RPE) {
    const reduced = reduceDose(input.dose, capLengths);
    if (reduced === null) return hold(["effort_high", "already_at_minimum"]);
    return finish("reduce", reduced.lever, reduced.dose, ["effort_high"], snapshot);
  }

  const recoveryConstrained =
    input.recovery !== undefined &&
    (input.recovery.primaryRecoveryWeek || input.recovery.hardStrengthDaysNext7 >= 3);

  const completedAsPrescribed =
    completionRatio !== null && completionRatio >= SWIM_STRONG_COMPLETION && missedSessions === 0;

  if (!completedAsPrescribed) return hold(["partial_completion"]);
  if (meanRpe === null || rpeMissing > 0) {
    return hold(["completed_as_prescribed", "effort_not_reported"]);
  }
  if (meanRpe > SWIM_EASY_RPE) return hold(["completed_as_prescribed"]);
  if (recoveryConstrained) return hold(["completed_as_prescribed", "recovery_context"]);

  const progressed = progressDose(input.dose, capLengths, input.setup.goal);
  if (progressed === null) {
    return hold([
      "completed_as_prescribed",
      "effort_comfortable",
      "minimum_increment_exceeds_cap",
    ]);
  }
  return finish(
    "progress",
    progressed.lever,
    progressed.dose,
    ["completed_as_prescribed", "effort_comfortable"],
    snapshot,
  );

  function finish(
    decision: SwimDecisionKind,
    lever: SwimLever,
    to: SwimDose,
    reasons: readonly SwimProposalReason[],
    snap: SwimProposalSnapshot,
  ): SwimProposal {
    const delta = to.mainRepeats * to.mainRepLengths - mainLengths;
    const capped = Math.abs(delta) > snap.capLengths;
    const body = {
      decision: capped ? ("hold" as SwimDecisionKind) : decision,
      lever: capped ? ("none" as SwimLever) : lever,
      from: input.dose,
      to: capped ? input.dose : to,
      reasons: capped ? [...reasons, "minimum_increment_exceeds_cap" as const] : reasons,
      snapshot: snap,
      versions: { model: SWIM_MODEL_VERSION, generator: SWIM_GENERATOR_VERSION },
    };
    return { proposalId: `swim-prop-${fingerprint(body)}`, ...body };
  }
}

/** One lever, bounded by the cap. `null` when no step fits. */
function progressDose(
  dose: SwimDose,
  capLengths: number,
  goal: SwimSetup["goal"],
): { dose: SwimDose; lever: SwimLever } | null {
  const repeatStep = dose.mainRepLengths;
  const lengthStep = dose.mainRepeats;
  const options: { lever: SwimLever; step: number; dose: SwimDose }[] = [];
  if (repeatStep <= capLengths) {
    options.push({
      lever: "main_repeats",
      step: repeatStep,
      dose: { ...dose, mainRepeats: dose.mainRepeats + 1 },
    });
  }
  if (lengthStep <= capLengths) {
    options.push({
      lever: "main_rep_lengths",
      step: lengthStep,
      dose: { ...dose, mainRepLengths: dose.mainRepLengths + 1 },
    });
  }
  if (options.length === 0) return null;
  const preferred = goal === "endurance" ? "main_rep_lengths" : "main_repeats";
  const chosen =
    options.find((option) => option.lever === preferred) ??
    options.reduce((best, option) => (option.step < best.step ? option : best));
  return { dose: chosen.dose, lever: chosen.lever };
}

/** Mirror of `progressDose`: one lever down, bounded, never below the floor. */
function reduceDose(
  dose: SwimDose,
  capLengths: number,
): { dose: SwimDose; lever: SwimLever } | null {
  if (dose.mainRepeats > SWIM_MIN_MAIN_REPEATS && dose.mainRepLengths <= Math.max(capLengths, 1)) {
    return { dose: { ...dose, mainRepeats: dose.mainRepeats - 1 }, lever: "main_repeats" };
  }
  if (dose.mainRepLengths > SWIM_MIN_MAIN_REP_LENGTHS) {
    return { dose: { ...dose, mainRepLengths: dose.mainRepLengths - 1 }, lever: "main_rep_lengths" };
  }
  if (dose.mainRepeats > SWIM_MIN_MAIN_REPEATS) {
    return { dose: { ...dose, mainRepeats: dose.mainRepeats - 1 }, lever: "main_repeats" };
  }
  return null;
}

/** Deterministic 32-bit fingerprint (FNV-1a) so a proposal identifies itself. */
function fingerprint(value: unknown): string {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

// ---------------------------------------------------------------------------
// Decisions and future work (DC-SW5)
// ---------------------------------------------------------------------------

/**
 * Append a decision. Accepted, rejected and overridden decisions all stay in
 * the ledger; nothing is rewritten, so the reasoning behind any past week can
 * be replayed from its own snapshot.
 */
export function recordSwimDecision(
  ledger: SwimDecisionLedger | null,
  input: {
    readonly proposal: SwimProposal;
    readonly action: SwimDecisionAction;
    readonly atISO: string;
    readonly override?: SwimDose | undefined;
    readonly note?: string | undefined;
  },
): SwimDecisionLedger {
  const { proposal, action } = input;
  const applied =
    action === "accept" ? proposal.to : action === "reject" ? proposal.from : input.override ?? proposal.from;
  const appliedMain = applied.mainRepeats * applied.mainRepLengths;
  const fromMain = proposal.from.mainRepeats * proposal.from.mainRepLengths;
  const delta = appliedMain - fromMain;
  const warning =
    action === "override" && Math.abs(delta) > Math.max(proposal.snapshot.capLengths, 1)
      ? `This changes the main set by ${delta > 0 ? "+" : ""}${delta} lengths, past the ${
          proposal.snapshot.capLengths
        }-length step this plan uses.`
      : null;
  const entry: SwimDecisionEntry = {
    proposalId: proposal.proposalId,
    action,
    atISO: input.atISO,
    decision: proposal.decision,
    from: proposal.from,
    proposed: proposal.to,
    applied,
    reasons: proposal.reasons,
    snapshot: proposal.snapshot,
    note: input.note,
    warning,
    versions: proposal.versions,
  };
  return {
    entries: [...(ledger?.entries ?? []), entry],
    currentDose: applied,
  };
}

export interface SwimFutureScope {
  readonly asOfISO: string;
  /** Slots with a persisted session row. Started work is never rewritten. */
  readonly startedSlotIds: readonly string[];
}

function isFutureUnstarted(outcome: SwimSlotOutcome, scope: SwimFutureScope): boolean {
  return (
    daysBetweenISO(scope.asOfISO, outcome.dateISO) > 0 &&
    !scope.startedSlotIds.includes(outcome.slotId)
  );
}

/**
 * Reissue future unstarted work with a new dose. Started, past and completed
 * workouts keep the prescription they were issued with, and every reissued slot
 * keeps its `original` alongside the new `issued` version (ADR 0079).
 */
export function applySwimProposal(
  plan: SwimPlan,
  dose: SwimDose,
  scope: SwimFutureScope,
): SwimResult<SwimPlan> {
  const regenerated = generateSwimPlan({
    setup: plan.setup,
    calibration: plan.calibration,
    weeks: plan.weeks.map((week) => ({
      weekIndex: week.weekIndex,
      startDateISO: week.startDateISO,
      slots: week.slots.map((slot) => ({
        slotId: slot.slotId,
        dateISO: slot.dateISO,
        intent: slot.intent,
        source: slot.source,
      })),
    })),
    dose,
    ...(plan.eventPrep ? { eventPrep: plan.eventPrep } : {}),
  });
  if (!regenerated.ok) return regenerated;
  const replacement = new Map<string, SwimSlotOutcome>();
  for (const week of regenerated.value.weeks) {
    for (const slot of week.slots) replacement.set(slot.slotId, slot);
  }
  const weeks: SwimPlanWeek[] = plan.weeks.map((week) => ({
    ...week,
    slots: week.slots.map((slot) => {
      if (!isFutureUnstarted(slot, scope)) return slot;
      const next = replacement.get(slot.slotId);
      if (!next) return slot;
      if (next.kind === "workout" && slot.kind === "workout") {
        return { ...next, original: slot.original };
      }
      return next;
    }),
  }));
  return swimOk({ ...plan, dose, weeks });
}

/**
 * Apply an accepted benchmark. It adds pace targets and the calibration
 * snapshot to future unstarted work only; it does not change the dose, and it
 * leaves every already-issued prescription (and its versions) intact.
 */
export function applyAcceptedBenchmark(
  plan: SwimPlan,
  calibration: SwimCalibration,
  scope: SwimFutureScope,
): SwimPlan {
  if (!isUsableSwimCalibration(calibration)) {
    throw new Error("Use a verified 200/400 assessment for pace targets.");
  }
  if (!poolCourseEquals(calibration.course, plan.setup.course)) return plan;
  const snapshot = calibrationSnapshot(calibration);
  const weeks: SwimPlanWeek[] = plan.weeks.map((week) => ({
    ...week,
    slots: week.slots.map((slot) => {
      if (slot.kind !== "workout" || !isFutureUnstarted(slot, scope)) return slot;
      const issued = slot.issued;
      const sections = issued.sections.map((section) => ({
        ...section,
        items: section.items.map((item) => {
          const target = paceTargetMs(
            calibration,
            item.effort,
            item.lengths,
            issued.snapshot.course,
            item.stroke,
            item.equipment,
          );
          return target === null ? item : { ...item, targetMsPerRepeat: target };
        }),
      }));
      return {
        ...slot,
        issued: {
          ...issued,
          sections,
          snapshot: {
            ...issued.snapshot,
            protocol: calibration.protocol,
            calibration: snapshot,
            versions: { ...issued.snapshot.versions, assessment: calibration.version },
          },
        },
      };
    }),
  }));
  return { ...plan, calibration, weeks };
}

/** Total prescribed lengths in a generated week. Used by analytics and tests. */
export function swimPlanWeekLengths(week: SwimPlanWeek): number {
  return week.slots.reduce(
    (sum, slot) => (slot.kind === "workout" ? sum + slot.issued.totalLengths : sum),
    0,
  );
}

// ---------------------------------------------------------------------------
// Weekday form → explicit dated slots
// ---------------------------------------------------------------------------

export interface SwimWeekdayScheduleInput {
  /** First day of week 0. Weeks run seven days from here. */
  readonly startDateISO: string;
  readonly weeks: number;
  /** 0 = Sunday. Empty means a week with no slots, which is allowed. */
  readonly weekdays: readonly number[];
  readonly intentByWeekday?: Readonly<Record<number, SwimSlotIntent["intent"]>> | undefined;
  readonly defaultIntent?: SwimSlotIntent["intent"] | undefined;
  readonly source?: SwimSlotIntent["source"] | undefined;
  readonly budgetMinutes?: number | undefined;
}

export const MAX_PLAN_WEEKS = 52;

/**
 * Expand a "which weekdays do you swim?" form into the explicit dated slots the
 * generator consumes. The result is an ordinary editable list: the swimmer can
 * add, move or delete dates afterwards, weeks may end up with different slot
 * counts, and a week with none simply has none. The generator still has no
 * frequency concept — this only saves the UI from re-deriving dates.
 */
export function swimWeeksFromWeekdays(
  input: SwimWeekdayScheduleInput,
): SwimResult<readonly SwimWeekRequest[]> {
  if (!isISODate(input.startDateISO)) {
    return swimErr("setup_invalid", "The start date is not a valid date.", {
      startDateISO: input.startDateISO,
    });
  }
  if (!Number.isInteger(input.weeks) || input.weeks < 1 || input.weeks > MAX_PLAN_WEEKS) {
    return swimErr("setup_invalid", `Choose between 1 and ${MAX_PLAN_WEEKS} weeks.`, {
      weeks: input.weeks,
    });
  }
  const weekdays = [...new Set(input.weekdays)].sort((a, b) => a - b);
  for (const weekday of weekdays) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) {
      return swimErr("setup_invalid", "Swim days must be weekdays from 0 (Sunday) to 6.", {
        weekday,
      });
    }
  }
  const source = input.source ?? "swim_date";
  const defaultIntent = input.defaultIntent ?? "moderate";
  const weeks: SwimWeekRequest[] = [];
  for (let weekIndex = 0; weekIndex < input.weeks; weekIndex += 1) {
    const startDateISO = addDaysISO(input.startDateISO, weekIndex * 7);
    const slots: SwimSlotIntent[] = [];
    for (let offset = 0; offset < 7; offset += 1) {
      const dateISO = addDaysISO(startDateISO, offset);
      if (!weekdays.includes(weekdayOfISO(dateISO))) continue;
      const intent = input.intentByWeekday?.[weekdayOfISO(dateISO)] ?? defaultIntent;
      slots.push({
        slotId: `swim-${dateISO}`,
        dateISO,
        intent,
        source,
        ...(input.budgetMinutes === undefined ? {} : { budgetMinutes: input.budgetMinutes }),
      });
    }
    weeks.push({ weekIndex, startDateISO, slots });
  }
  return swimOk(weeks);
}
