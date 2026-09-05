/**
 * Pool swimming — the pure model (ADR 0079).
 *
 * A pool length is the unit that actually exists. Everything a swimmer does is
 * a whole number of lengths of ONE pool, and every pool has an exact length
 * that is not always an integer number of metres: a 25 yd pool is 22.86 m, a
 * short-course-adapted 100/3 m pool is not the same pool as a 33.33 m pool.
 * Storing swims as rounded kilometres destroys exactly the comparison the
 * swimmer cares about, so the model stores a reduced positive rational length
 * plus its native unit, integer whole-length counts, and integer milliseconds.
 *
 * Rules this file exists to enforce (ADR 0079 "Exact pool data"):
 *
 *   - Normalisation defines course equality (DC-SW1). 100/3 m and 3333/100 m
 *     are different pools and never share a benchmark, a trend or a total.
 *   - Conversion into the generic distance columns is a one-way, documented,
 *     rounded compatibility projection — `compatibilityProjection` is its only
 *     implementation and nothing reads it back as exact swim distance.
 *   - An uncalibrated plan gets effort and rest guidance. It never gets an
 *     invented pace or a claimed duration (`estimatedMs === null` means show
 *     no duration, not "show zero").
 *
 * Everything here is pure: no DB, no I/O, no clock. Numbers that are heuristics
 * are named as heuristics and carry a reference to
 * `docs/knowledge/pool-swimming.md`; none of them are claimed to be calibrated.
 */

import type { Region } from "./types";

/** Model/schema version stamped into every snapshot (DC-SW1, DC-SW5). */
export const SWIM_MODEL_VERSION = "swim-model-1" as const;

/** Assessment (critical-swim-speed) rule version (DC-SW2, DC-SW5). */
export const SWIM_ASSESSMENT_VERSION = "swim-css-1" as const;

/** Documentation home for every heuristic constant in the swim model. */
export const SWIM_HEURISTIC_DOC = "docs/knowledge/pool-swimming.md" as const;

// ---------------------------------------------------------------------------
// Result / error plumbing
// ---------------------------------------------------------------------------

export type SwimErrorCode =
  | "course_invalid"
  | "course_out_of_range"
  | "course_not_representable"
  | "lengths_invalid"
  | "lengths_out_of_range"
  | "duration_invalid"
  | "distance_not_whole_lengths"
  | "arithmetic_overflow"
  | "setup_invalid"
  | "protocol_unsupported"
  | "protocol_distances_missing"
  | "protocol_distance_not_whole_lengths"
  | "protocol_mixed_conditions"
  | "protocol_times_implausible"
  | "protocol_pace_implausible"
  | "budget_impossible"
  | "event_infeasible"
  | "result_invalid";

export interface SwimError {
  readonly code: SwimErrorCode;
  /** Actionable, user-readable. States the conflict and what would resolve it. */
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>> | undefined;
}

export type SwimResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: SwimError };

export function swimOk<T>(value: T): SwimResult<T> {
  return { ok: true, value };
}

export function swimErr<T>(
  code: SwimErrorCode,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): SwimResult<T> {
  return { ok: false, error: { code, message, details } };
}

/** A validation finding on user setup. Severity decides block vs warn (DC-K4). */
/** Codes a stored row (workout or actual) can fail with. Mirrored by the SQL checks. */
export type SwimResultIssueCode =
  | "date_invalid"
  | "duration_out_of_range"
  | "rpe_out_of_range"
  | "missed_has_actuals"
  | "snapshot_course_mismatch"
  | "snapshot_invalid"
  | "completion_invalid"
  | "provenance_invalid"
  | "version_unsupported"
  | "result_malformed"
  | "split_lengths_invalid"
  | "split_time_invalid"
  | "splits_exceed_actual"
  | "splits_exceed_duration";

export interface SwimIssue {
  readonly field: string;
  readonly code: SwimErrorCode | SwimResultIssueCode | "setup_incomplete" | "setup_implausible";
  readonly severity: "blocking" | "warning";
  readonly message: string;
}

// ---------------------------------------------------------------------------
// Bounded integer arithmetic
// ---------------------------------------------------------------------------

/** Longest single pool length accepted, in native units. */
export const MAX_COURSE_UNITS = 100;
/** Shortest single pool length accepted, in native units. */
export const MIN_COURSE_UNITS = 5;
/** Largest denominator accepted for a rational course length. */
export const MAX_COURSE_DENOMINATOR = 10_000;
/** Largest whole-length count accepted anywhere (one workout or one result). */
export const MAX_POOL_LENGTHS = 2_000;
/**
 * Largest whole-length count accepted in a SUM over many swims. Totals are not
 * a single swim, so the per-swim bound must not truncate a season; this bound
 * exists only so arithmetic stays exact and overflow stays impossible.
 */
export const MAX_AGGREGATE_POOL_LENGTHS = 1_000_000;
/** Largest duration accepted for a swim or a repeat, in milliseconds. */
export const MAX_SWIM_MS = 24 * 60 * 60 * 1_000;

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Multiplication that refuses to leave the safe-integer range. */
export function checkedMul(a: number, b: number): SwimResult<number> {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    return swimErr("arithmetic_overflow", "Non-integer input to swim arithmetic.", { a, b });
  }
  const product = a * b;
  if (!Number.isSafeInteger(product)) {
    return swimErr("arithmetic_overflow", "Swim arithmetic exceeded the safe integer range.", { a, b });
  }
  return swimOk(product);
}

/** Addition that refuses to leave the safe-integer range. */
export function checkedAdd(a: number, b: number): SwimResult<number> {
  if (!Number.isSafeInteger(a) || !Number.isSafeInteger(b)) {
    return swimErr("arithmetic_overflow", "Non-integer input to swim arithmetic.", { a, b });
  }
  const sum = a + b;
  if (!Number.isSafeInteger(sum)) {
    return swimErr("arithmetic_overflow", "Swim arithmetic exceeded the safe integer range.", { a, b });
  }
  return swimOk(sum);
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x === 0 ? 1 : x;
}

// ---------------------------------------------------------------------------
// Pool course
// ---------------------------------------------------------------------------

export type PoolUnit = "m" | "yd";

/**
 * The exact length of one length of one pool, as a reduced positive rational
 * in its native unit. This is an identity, not a measurement to be rounded.
 */
export interface PoolCourse {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: PoolUnit;
}

export interface PoolCourseInput {
  readonly lengthNumerator: number;
  readonly lengthDenominator?: number | undefined;
  readonly unit: PoolUnit;
}

/** Reduce + validate. The only way a `PoolCourse` is ever constructed. */
export function parsePoolCourse(input: PoolCourseInput): SwimResult<PoolCourse> {
  const { lengthNumerator, unit } = input;
  const lengthDenominator = input.lengthDenominator ?? 1;
  if (unit !== "m" && unit !== "yd") {
    return swimErr("course_invalid", "Pool unit must be metres or yards.", { unit });
  }
  if (!isPositiveInteger(lengthNumerator) || !isPositiveInteger(lengthDenominator)) {
    return swimErr("course_invalid", "Pool length must be a positive whole ratio.", {
      lengthNumerator,
      lengthDenominator,
    });
  }
  if (lengthDenominator > MAX_COURSE_DENOMINATOR) {
    return swimErr("course_out_of_range", `Pool length denominator above ${MAX_COURSE_DENOMINATOR}.`, {
      lengthDenominator,
    });
  }
  const divisor = gcd(lengthNumerator, lengthDenominator);
  const numerator = lengthNumerator / divisor;
  const denominator = lengthDenominator / divisor;
  const value = numerator / denominator;
  if (value < MIN_COURSE_UNITS || value > MAX_COURSE_UNITS) {
    return swimErr(
      "course_out_of_range",
      `Pool length must be between ${MIN_COURSE_UNITS} and ${MAX_COURSE_UNITS} ${unit}.`,
      { value, unit },
    );
  }
  return swimOk({ numerator, denominator, unit });
}

/** Throwing constructor for fixtures and known-good literals. */
export function poolCourse(numerator: number, denominator: number, unit: PoolUnit): PoolCourse {
  const parsed = parsePoolCourse({ lengthNumerator: numerator, lengthDenominator: denominator, unit });
  if (!parsed.ok) throw new RangeError(`${parsed.error.code}: ${parsed.error.message}`);
  return parsed.value;
}

const DECIMAL_INPUT_MAX_PLACES = 4;

/**
 * Accept a decimal a user typed (33.33) as the exact rational it names
 * (3333/100). It is NOT re-interpreted as an approximation of 100/3.
 */
export function poolCourseFromDecimal(value: number, unit: PoolUnit): SwimResult<PoolCourse> {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return swimErr("course_invalid", "Pool length must be a positive number.", { value });
  }
  const text = value.toFixed(DECIMAL_INPUT_MAX_PLACES);
  const [whole = "0", fraction = ""] = text.split(".");
  const trimmed = fraction.replace(/0+$/, "");
  const denominator = 10 ** trimmed.length;
  const numerator = Number(whole) * denominator + (trimmed === "" ? 0 : Number(trimmed));
  if (Math.abs(numerator / denominator - value) > 1e-9) {
    return swimErr("course_not_representable", `Pool length needs more than ${DECIMAL_INPUT_MAX_PLACES} decimal places.`, {
      value,
    });
  }
  return parsePoolCourse({ lengthNumerator: numerator, lengthDenominator: denominator, unit });
}

/** Canonical identity string. Equal keys mean the same pool (DC-SW1). */
export function poolCourseKey(course: PoolCourse): string {
  if (!isStructuralPoolCourse(course)) {
    const raw = course as { numerator?: unknown; denominator?: unknown; unit?: unknown } | null;
    return `malformed:${String(raw?.numerator)}/${String(raw?.denominator)}:${String(raw?.unit)}`;
  }
  const divisor = gcd(course.numerator, course.denominator);
  return `${course.numerator / divisor}/${course.denominator / divisor}:${course.unit}`;
}

function isStructuralPoolCourse(course: PoolCourse | null | undefined): course is PoolCourse {
  return (
    course !== null &&
    course !== undefined &&
    isPositiveInteger(course.numerator) &&
    isPositiveInteger(course.denominator) &&
    (course.unit === "m" || course.unit === "yd")
  );
}

/**
 * True when the course is a reduced positive rational inside the supported
 * bounds. A course from outside this module — a DB row, a request body — is
 * only an identity once this holds.
 */
export function isValidPoolCourse(course: PoolCourse | null | undefined): course is PoolCourse {
  if (!isStructuralPoolCourse(course)) return false;
  const normalized = normalizePoolCourse(course);
  return (
    normalized.ok &&
    normalized.value.numerator === course.numerator &&
    normalized.value.denominator === course.denominator
  );
}

/**
 * Reduce and bounds-check a course that arrived from outside. Call this at the
 * boundary; everything downstream may then treat the course as an identity.
 */
export function normalizePoolCourse(course: PoolCourse): SwimResult<PoolCourse> {
  if (!isStructuralPoolCourse(course)) {
    return swimErr("course_invalid", "Pool length must be a positive whole ratio.", { course });
  }
  return parsePoolCourse({
    lengthNumerator: course.numerator,
    lengthDenominator: course.denominator,
    unit: course.unit,
  });
}

export function poolCourseEquals(a: PoolCourse, b: PoolCourse): boolean {
  return poolCourseKey(a) === poolCourseKey(b);
}

/**
 * Exact decimal string when the rational terminates, otherwise the fraction.
 * Never a rounded approximation presented as the value.
 */
function formatExactRational(numerator: number, denominator: number): string {
  if (denominator === 1) return String(numerator);
  let d = denominator;
  let twos = 0;
  let fives = 0;
  while (d % 2 === 0) {
    d /= 2;
    twos += 1;
  }
  while (d % 5 === 0) {
    d /= 5;
    fives += 1;
  }
  if (d !== 1) return `${numerator}/${denominator}`;
  const places = Math.max(twos, fives);
  const scale = 10 ** places;
  const scaled = (numerator * scale) / denominator;
  if (!Number.isSafeInteger(scaled)) return `${numerator}/${denominator}`;
  const text = String(scaled).padStart(places + 1, "0");
  const whole = text.slice(0, text.length - places);
  const fraction = text.slice(text.length - places).replace(/0+$/, "");
  return fraction === "" ? whole : `${whole}.${fraction}`;
}

/** `"25 m"`, `"33.33 m"`, `"100/3 m"`. One implementation, used everywhere. */
export function formatPoolCourse(course: PoolCourse): string {
  return `${formatExactRational(course.numerator, course.denominator)} ${course.unit}`;
}

/** An exact native distance: a reduced rational with its unit. */
export interface ExactDistance {
  readonly numerator: number;
  readonly denominator: number;
  readonly unit: PoolUnit;
}

function exactDistance(
  lengths: number,
  course: PoolCourse,
  maxLengths: number,
): SwimResult<ExactDistance> {
  if (!isNonNegativeInteger(lengths)) {
    return swimErr("lengths_invalid", "Lengths must be a whole number.", { lengths });
  }
  if (lengths > maxLengths) {
    return swimErr("lengths_out_of_range", `Lengths above the ${maxLengths} limit.`, { lengths });
  }
  const product = checkedMul(lengths, course.numerator);
  if (!product.ok) return product;
  const divisor = gcd(product.value, course.denominator) || 1;
  return swimOk({
    numerator: product.value / divisor,
    denominator: course.denominator / divisor,
    unit: course.unit,
  });
}

/** Exact native distance of ONE swim (bounded by {@link MAX_POOL_LENGTHS}). */
export function nativeDistance(lengths: number, course: PoolCourse): SwimResult<ExactDistance> {
  return exactDistance(lengths, course, MAX_POOL_LENGTHS);
}

/**
 * Exact native distance of a SUM of swims — a week, a block, a season. Same
 * arithmetic as {@link nativeDistance}, bounded by
 * {@link MAX_AGGREGATE_POOL_LENGTHS} instead of the single-swim limit, so a
 * total above one swim's ceiling stays exact instead of failing.
 */
export function aggregateNativeDistance(
  lengths: number,
  course: PoolCourse,
): SwimResult<ExactDistance> {
  return exactDistance(lengths, course, MAX_AGGREGATE_POOL_LENGTHS);
}

export function distanceToNumber(distance: ExactDistance): number {
  return distance.numerator / distance.denominator;
}

/** `"400 m"`, `"133.32 m"`, `"800/3 m"`. */
export function formatExactDistance(distance: ExactDistance): string {
  return `${formatExactRational(distance.numerator, distance.denominator)} ${distance.unit}`;
}

/**
 * Native distance label for any length count, single swim or total. Errors
 * instead of degrading to a length count, so a caller can never print a total
 * that silently dropped its unit.
 */
export function swimDistanceLabel(lengths: number, course: PoolCourse): SwimResult<string> {
  if (!isValidPoolCourse(course)) {
    return swimErr("course_invalid", "This pool length cannot be labelled.", { course });
  }
  const distance = aggregateNativeDistance(lengths, course);
  if (!distance.ok) return distance;
  return swimOk(formatExactDistance(distance.value));
}

/**
 * Display shorthand over {@link swimDistanceLabel}. Valid input — including a
 * season total — always yields the exact native distance. Input that cannot be
 * a distance at all (a malformed course, a fractional length count) yields a
 * length count, which is what the caller actually knows; it never invents a
 * distance figure.
 */
export function formatSwimDistance(lengths: number, course: PoolCourse): string {
  const label = swimDistanceLabel(lengths, course);
  return label.ok ? label.value : `${lengths} lengths`;
}

/** Whole lengths that make an exact native distance, or an error (DC-SW1). */
export function lengthsForNativeDistance(distance: number, course: PoolCourse): SwimResult<number> {
  if (typeof distance !== "number" || !Number.isFinite(distance) || distance <= 0) {
    return swimErr("lengths_invalid", "Distance must be a positive number.", { distance });
  }
  const scaled = distance * course.denominator;
  const lengths = scaled / course.numerator;
  if (!Number.isInteger(lengths) || lengths <= 0) {
    return swimErr(
      "distance_not_whole_lengths",
      `${distance} ${course.unit} is not a whole number of lengths in a ${formatPoolCourse(course)} pool.`,
      { distance, course },
    );
  }
  if (lengths > MAX_POOL_LENGTHS) {
    return swimErr("lengths_out_of_range", `Lengths above the ${MAX_POOL_LENGTHS} limit.`, { lengths });
  }
  return swimOk(lengths);
}

/** Exact yard→metre factor (1 yd = 0.9144 m = 1143/1250 m). */
const YARD_METRES_NUMERATOR = 1143;
const YARD_METRES_DENOMINATOR = 1250;

export interface SwimCompatibilityProjection {
  readonly distanceMeters: number;
  readonly distanceKm: number;
  readonly rounded: true;
  readonly source: { readonly lengths: number; readonly course: PoolCourse };
  readonly note: string;
}

/**
 * The ONE conversion into the generic distance columns (ADR 0079). It is
 * rounded, it is write-only, and it never feeds a benchmark, a personal best
 * or progression — those read `lengths` + `course`.
 *
 * Unvalidated input is refused rather than projected: a malformed course or an
 * out-of-range length would otherwise write a plausible-looking metre figure
 * derived from nonsense.
 */
export function compatibilityProjection(
  lengths: number,
  course: PoolCourse,
): SwimResult<SwimCompatibilityProjection> {
  if (!isValidPoolCourse(course)) {
    return swimErr("course_invalid", "This pool length cannot be projected.", { course });
  }
  const distance = nativeDistance(lengths, course);
  if (!distance.ok) return distance;
  const scaled =
    course.unit === "yd"
      ? checkedMul(distance.value.numerator, YARD_METRES_NUMERATOR)
      : swimOk(distance.value.numerator);
  if (!scaled.ok) return scaled;
  const denominator =
    course.unit === "yd"
      ? distance.value.denominator * YARD_METRES_DENOMINATOR
      : distance.value.denominator;
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    return swimErr("course_out_of_range", "This pool length cannot be projected.", { course });
  }
  const meters = scaled.value / denominator;
  if (!Number.isFinite(meters)) {
    return swimErr("lengths_out_of_range", "This distance cannot be projected.", { lengths });
  }
  return swimOk({
    distanceMeters: Math.round(meters * 100) / 100,
    distanceKm: Math.round(meters) / 1000,
    rounded: true,
    source: { lengths, course },
    note: `Rounded projection of ${lengths} lengths of ${formatPoolCourse(course)} for generic distance fields only.`,
  });
}

// ---------------------------------------------------------------------------
// Workout vocabulary
// ---------------------------------------------------------------------------

export type SwimStroke =
  | "freestyle"
  | "backstroke"
  | "breaststroke"
  | "butterfly"
  | "individual_medley"
  | "choice"
  | "kick";

export type SwimEquipment = "kickboard" | "pull_buoy" | "fins" | "paddles" | "snorkel";

/**
 * Effort names, easiest first. `threshold` is the Z3 dose DC-D7/DC-N2 keep
 * default-off: the generator emits it only inside an eligible, opted-in
 * event-preparation window, never in a default plan.
 */
export type SwimEffort = "easy" | "steady" | "brisk" | "threshold" | "sprint";

export const SWIM_EFFORTS: readonly SwimEffort[] = ["easy", "steady", "brisk", "threshold", "sprint"];

export type SwimSectionKind = "warmup" | "preparation" | "main" | "recovery" | "cooldown";

export const SWIM_SECTION_ORDER: readonly SwimSectionKind[] = [
  "warmup",
  "preparation",
  "main",
  "recovery",
  "cooldown",
];

export interface SwimItem {
  readonly repeats: number;
  readonly lengths: number;
  readonly stroke: SwimStroke;
  readonly effort: SwimEffort;
  readonly equipment: readonly SwimEquipment[];
  readonly drill?: string | undefined;
  /** Present only when a compatible calibration exists (DC-SW2). */
  readonly targetMsPerRepeat?: number | undefined;
  readonly restSeconds?: number | undefined;
  readonly sendoffMs?: number | undefined;
  readonly optional: boolean;
  readonly note?: string | undefined;
}

export interface SwimSection {
  readonly kind: SwimSectionKind;
  readonly label: string;
  readonly rounds: number;
  readonly items: readonly SwimItem[];
}

/**
 * What a workout froze about the pace it was written against. `msPer100` keeps
 * half-millisecond resolution because the CSS formula halves a difference of
 * two integer times, so an odd difference lands on `.5` and rounding it here
 * would silently move the pace. The observation that produced it travels with
 * it, so a stored calibration can be re-derived and re-checked (DC-SW2).
 */
export interface SwimCalibrationSnapshot {
  readonly msPer100: number;
  readonly unit: PoolUnit;
  readonly protocol: SwimProtocolId;
  readonly observedOn: string;
  readonly heuristic: true;
  readonly version: string;
  readonly observation?: SwimObservation | undefined;
}

export interface SwimWorkoutSnapshot {
  readonly course: PoolCourse;
  readonly strokes: readonly SwimStroke[];
  readonly equipment: readonly SwimEquipment[];
  readonly protocol: SwimProtocolId | null;
  readonly calibration: SwimCalibrationSnapshot | null;
  readonly versions: {
    readonly model: string;
    readonly generator: string;
    readonly assessment: string | null;
  };
}

export type SwimFocus = "technique_base" | "endurance" | "event_specific";

export interface SwimBudget {
  readonly minutes: number;
  /**
   * The part of the session that is known: the stated rest, the turnarounds,
   * and any straight swim the swimmer's own verified pace covers for exactly
   * these conditions. A lower bound whenever `estimatedMs` is `null` — the
   * session takes at least this long — never a predicted finish time.
   */
  readonly accountedMs: number;
}

export interface SwimWorkout {
  readonly kind: "swim_workout";
  readonly focus: SwimFocus;
  readonly sections: readonly SwimSection[];
  readonly totalLengths: number;
  readonly snapshot: SwimWorkoutSnapshot;
  /** `null` whenever pace is unknown. Never a fabricated number. */
  readonly estimatedMs: number | null;
  readonly budget: SwimBudget;
}

/**
 * Vocabulary alias. The prescription IS the workout; callers that speak of a
 * "prescription" import this rather than declaring their own copy.
 */
export type SwimPrescription = SwimWorkout;

export function swimSectionLengths(section: SwimSection): number {
  const perRound = section.items.reduce((sum, item) => sum + item.repeats * item.lengths, 0);
  return perRound * section.rounds;
}

export function swimWorkoutLengths(workout: SwimWorkout): number {
  return workout.sections.reduce((sum, section) => sum + swimSectionLengths(section), 0);
}

export function swimMainLengths(workout: SwimWorkout): number {
  return workout.sections
    .filter((section) => section.kind === "main")
    .reduce((sum, section) => sum + swimSectionLengths(section), 0);
}

export function swimWorkoutStrokes(workout: SwimWorkout): readonly SwimStroke[] {
  const seen = new Set<SwimStroke>();
  for (const section of workout.sections) for (const item of section.items) seen.add(item.stroke);
  return [...seen];
}

export function swimWorkoutEquipment(workout: SwimWorkout): readonly SwimEquipment[] {
  const seen = new Set<SwimEquipment>();
  for (const section of workout.sections) for (const item of section.items) {
    for (const piece of item.equipment) seen.add(piece);
  }
  return [...seen];
}

/** Structural invariants of an issued workout (DC-SW3). */
export function validateSwimWorkout(workout: SwimWorkout): SwimIssue[] {
  const issues: SwimIssue[] = [];
  const kinds = workout.sections.map((section) => section.kind);
  const ordered = [...kinds].sort(
    (a, b) => SWIM_SECTION_ORDER.indexOf(a) - SWIM_SECTION_ORDER.indexOf(b),
  );
  if (kinds.join("|") !== ordered.join("|")) {
    issues.push({
      field: "sections",
      code: "setup_invalid",
      severity: "blocking",
      message: "Sections are out of order.",
    });
  }
  if (!kinds.includes("warmup") || !kinds.includes("cooldown") || !kinds.includes("main")) {
    issues.push({
      field: "sections",
      code: "setup_incomplete",
      severity: "blocking",
      message: "A swim keeps an easy start, its main work and an easy finish.",
    });
  }
  for (const section of workout.sections) {
    if (!isPositiveInteger(section.rounds)) {
      issues.push({
        field: `sections.${section.kind}.rounds`,
        code: "lengths_invalid",
        severity: "blocking",
        message: "Rounds must be a positive whole number.",
      });
    }
    for (const [index, item] of section.items.entries()) {
      if (!isPositiveInteger(item.repeats) || !isPositiveInteger(item.lengths)) {
        issues.push({
          field: `sections.${section.kind}.items.${index}`,
          code: "lengths_invalid",
          severity: "blocking",
          message: "Repeats and lengths must be positive whole numbers.",
        });
      }
      if (item.targetMsPerRepeat !== undefined && !isPositiveInteger(item.targetMsPerRepeat)) {
        issues.push({
          field: `sections.${section.kind}.items.${index}.targetMsPerRepeat`,
          code: "duration_invalid",
          severity: "blocking",
          message: "Pace targets are whole milliseconds.",
        });
      }
    }
  }
  if (workout.totalLengths !== swimWorkoutLengths(workout)) {
    issues.push({
      field: "totalLengths",
      code: "lengths_invalid",
      severity: "blocking",
      message: "Total lengths disagree with the sections.",
    });
  }
  if (workout.snapshot.calibration === null && workout.estimatedMs !== null) {
    issues.push({
      field: "estimatedMs",
      code: "duration_invalid",
      severity: "blocking",
      message: "An uncalibrated swim has no estimated duration.",
    });
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

export type SwimGoal = "technique_base" | "endurance";

export type SwimExperience = "learning" | "returning" | "recreational" | "trained";

export interface SwimEventTarget {
  readonly dateISO: string;
  readonly distance: number;
  readonly unit: PoolUnit;
}

export interface SwimSetup {
  readonly goal: SwimGoal;
  readonly experience: SwimExperience;
  readonly course: PoolCourse;
  readonly knownStrokes: readonly SwimStroke[];
  readonly equipment: readonly SwimEquipment[];
  /** Whole lengths of this pool the swimmer can currently swim comfortably. */
  readonly recentComfortableLengths: number;
  readonly sessionBudgetMinutes: number;
  readonly event?: SwimEventTarget | undefined;
  readonly benchmarks?: readonly SwimObservation[] | undefined;
}

/** Shortest session the generator will build a real workout inside. */
export const MIN_SESSION_BUDGET_MINUTES = 10;
export const MAX_SESSION_BUDGET_MINUTES = 240;

export function validateSwimSetup(setup: SwimSetup): SwimIssue[] {
  const issues: SwimIssue[] = [];
  if (!isValidPoolCourse(setup.course)) {
    issues.push({
      field: "course",
      code: "course_invalid",
      severity: "blocking",
      message: "The pool length is not a supported pool.",
    });
  }
  if (!isNonNegativeInteger(setup.recentComfortableLengths)) {
    issues.push({
      field: "recentComfortableLengths",
      code: "lengths_invalid",
      severity: "blocking",
      message: "Recent comfortable lengths must be a whole number.",
    });
  } else if (setup.recentComfortableLengths > MAX_POOL_LENGTHS) {
    issues.push({
      field: "recentComfortableLengths",
      code: "lengths_out_of_range",
      severity: "blocking",
      message: `Recent comfortable lengths above the ${MAX_POOL_LENGTHS} limit.`,
    });
  }
  if (
    typeof setup.sessionBudgetMinutes !== "number" ||
    !Number.isFinite(setup.sessionBudgetMinutes) ||
    setup.sessionBudgetMinutes < MIN_SESSION_BUDGET_MINUTES ||
    setup.sessionBudgetMinutes > MAX_SESSION_BUDGET_MINUTES
  ) {
    issues.push({
      field: "sessionBudgetMinutes",
      code: "setup_invalid",
      severity: "blocking",
      message: `Session length must be between ${MIN_SESSION_BUDGET_MINUTES} and ${MAX_SESSION_BUDGET_MINUTES} minutes.`,
    });
  }
  if (setup.knownStrokes.length === 0 && setup.recentComfortableLengths >= 1) {
    issues.push({
      field: "knownStrokes",
      code: "setup_incomplete",
      severity: "blocking",
      message: "Select at least one stroke you can swim.",
    });
  }
  if (setup.event) {
    const eventLengths = lengthsForNativeDistance(setup.event.distance, setup.course);
    if (setup.event.unit !== setup.course.unit) {
      issues.push({
        field: "event.unit",
        code: "protocol_mixed_conditions",
        severity: "warning",
        message: `Event distance is in ${setup.event.unit} and your pool is in ${setup.course.unit}.`,
      });
    } else if (!eventLengths.ok) {
      issues.push({
        field: "event.distance",
        code: eventLengths.error.code,
        severity: "warning",
        message: eventLengths.error.message,
      });
    }
    if (!isISODate(setup.event.dateISO)) {
      issues.push({
        field: "event.dateISO",
        code: "setup_invalid",
        severity: "blocking",
        message: "Event date must be a calendar date.",
      });
    }
  }
  return issues;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * A real calendar date in `YYYY-MM-DD`. The shape check is not enough:
 * `Date.parse` accepts 2026-02-31 and rolls it to 3 March, so the parsed date
 * must round-trip back to the same string.
 */
export function isISODate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const time = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(time)) return false;
  return new Date(time).toISOString().slice(0, 10) === value;
}

/** Whole days from `fromISO` to `toISO`; negative when `toISO` is earlier. */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  const from = Date.parse(`${fromISO}T00:00:00Z`);
  const to = Date.parse(`${toISO}T00:00:00Z`);
  return Math.round((to - from) / 86_400_000);
}

/** `dateISO` moved by whole days. Pure UTC arithmetic, no local timezone. */
export function addDaysISO(dateISO: string, days: number): string {
  const time = Date.parse(`${dateISO}T00:00:00Z`) + days * 86_400_000;
  return new Date(time).toISOString().slice(0, 10);
}

/** Day of week, 0 = Sunday. */
export function weekdayOfISO(dateISO: string): number {
  return new Date(`${dateISO}T00:00:00Z`).getUTCDay();
}

/** Guidance for someone who cannot yet swim one comfortable length (ADR 0079). */
export interface SwimLearningGuidance {
  readonly kind: "swim_learning_guidance";
  readonly reason: "no_comfortable_length";
  readonly course: PoolCourse;
  readonly minutes: number;
  readonly steps: readonly string[];
  readonly versions: { readonly model: string; readonly generator: string };
}

// ---------------------------------------------------------------------------
// Assessment — optional 200/400 critical swim speed
// ---------------------------------------------------------------------------

export type SwimProtocolId = "css_200_400";

export const SWIM_PROTOCOL_DISTANCES: Readonly<Record<SwimProtocolId, readonly [number, number]>> = {
  css_200_400: [200, 400],
};

export interface SwimTrial {
  /** Native-unit distance of the trial (200 or 400 for `css_200_400`). */
  readonly distance: number;
  readonly lengths: number;
  readonly timeMs: number;
}

export interface SwimObservation {
  readonly protocol: SwimProtocolId;
  readonly course: PoolCourse;
  readonly stroke: SwimStroke;
  readonly equipment: readonly SwimEquipment[];
  readonly trials: readonly SwimTrial[];
  readonly observedOn: string;
  /**
   * True when the swimmer confirms these times were taken on the clock over the
   * stated distances. Anything else — including an omitted value — is treated as
   * a recalled estimate and carries the `unverified_self_report` note.
   */
  readonly verified?: boolean | undefined;
  readonly version: string;
}

export type SwimCalibrationNote =
  | "field_estimate_not_lab_threshold"
  | "native_yard_field_estimate"
  | "equipment_specific"
  | "non_freestyle_stroke"
  | "unverified_self_report";

export interface SwimCalibration {
  /**
   * Milliseconds per 100 NATIVE units (100 m in a metre pool, 100 yd in a yard
   * pool). Halves are exact in binary floating point, so `(t400 − t200) / 2`
   * loses nothing.
   */
  readonly msPer100: number;
  readonly unit: PoolUnit;
  readonly course: PoolCourse;
  readonly stroke: SwimStroke;
  readonly equipment: readonly SwimEquipment[];
  readonly protocol: SwimProtocolId;
  readonly heuristic: true;
  readonly notes: readonly SwimCalibrationNote[];
  readonly observation: SwimObservation;
  readonly version: string;
}

/**
 * Plausibility bounds on a 100-native-unit pace. Heuristic guard rails that
 * reject typos (a 9-second 100) rather than judge the swimmer.
 * See {@link SWIM_HEURISTIC_DOC}.
 */
export const SWIM_MIN_PLAUSIBLE_MS_PER_100 = 30_000;
export const SWIM_MAX_PLAUSIBLE_MS_PER_100 = 600_000;

/**
 * Critical swim speed from a paired 200/400 trial:
 * `ms per 100 = (t400 − t200) / 2`.
 *
 * This is a field estimate (Nikitakis et al. 2019 supports moderate agreement
 * with maximal lactate steady state in trained swimmers in METRES). It is not
 * a laboratory threshold, and in a yard pool it is a separately labelled
 * heuristic rather than an equivalently evidenced estimate. Both trials must be
 * exact whole lengths of the SAME pool, stroke and equipment; a short swim is
 * never extrapolated into one.
 *
 * The 400 must take more than twice the 200. At exactly twice, the second half
 * of the 400 matched the standalone 200 and the formula returns a pace faster
 * than the 200 itself; below that it returns a pace nobody swam. Neither is a
 * threshold estimate, so the pair is rejected rather than reinterpreted.
 */
export function estimateCriticalSwimSpeed(observation: SwimObservation): SwimResult<SwimCalibration> {
  const distances = SWIM_PROTOCOL_DISTANCES[observation.protocol];
  if (!distances) {
    return swimErr("protocol_unsupported", "Unsupported assessment protocol.", {
      protocol: observation.protocol,
    });
  }
  const [shortDistance, longDistance] = distances;
  const shortTrial = observation.trials.find((trial) => trial.distance === shortDistance);
  const longTrial = observation.trials.find((trial) => trial.distance === longDistance);
  if (!shortTrial || !longTrial || observation.trials.length !== 2) {
    return swimErr(
      "protocol_distances_missing",
      `This assessment needs exactly one ${shortDistance} and one ${longDistance} ${observation.course.unit} swim.`,
      { distances, provided: observation.trials.map((trial) => trial.distance) },
    );
  }
  for (const trial of [shortTrial, longTrial]) {
    const expected = lengthsForNativeDistance(trial.distance, observation.course);
    if (!expected.ok) {
      return swimErr(
        "protocol_distance_not_whole_lengths",
        `${trial.distance} ${observation.course.unit} is not a whole number of lengths in a ${formatPoolCourse(
          observation.course,
        )} pool. Record the assessment in a pool where it is, or log the swim without an estimate.`,
        { distance: trial.distance, course: observation.course },
      );
    }
    if (trial.lengths !== expected.value) {
      return swimErr(
        "protocol_distance_not_whole_lengths",
        `${trial.distance} ${observation.course.unit} is ${expected.value} lengths of this pool, not ${trial.lengths}.`,
        { distance: trial.distance, expected: expected.value, provided: trial.lengths },
      );
    }
    if (!isPositiveInteger(trial.timeMs) || trial.timeMs > MAX_SWIM_MS) {
      return swimErr("duration_invalid", "Trial times are whole milliseconds above zero.", {
        distance: trial.distance,
        timeMs: trial.timeMs,
      });
    }
  }
  if (longTrial.timeMs <= shortTrial.timeMs * 2) {
    return swimErr(
      "protocol_times_implausible",
      `The ${longDistance} time must be slower than twice the ${shortDistance} time. Check the entries.`,
      { shortMs: shortTrial.timeMs, longMs: longTrial.timeMs },
    );
  }
  if (longTrial.timeMs >= shortTrial.timeMs * 2.5) {
    return swimErr(
      "protocol_times_implausible",
      `The ${longDistance} time is more than 2.5× the ${shortDistance} time, so the pair cannot give a usable estimate.`,
      { shortMs: shortTrial.timeMs, longMs: longTrial.timeMs },
    );
  }
  const msPer100 = (longTrial.timeMs - shortTrial.timeMs) / 2;
  if (msPer100 < SWIM_MIN_PLAUSIBLE_MS_PER_100 || msPer100 > SWIM_MAX_PLAUSIBLE_MS_PER_100) {
    return swimErr(
      "protocol_pace_implausible",
      "These two times give a pace outside the range this estimate supports. Check the entries.",
      { msPer100 },
    );
  }
  const notes: SwimCalibrationNote[] = ["field_estimate_not_lab_threshold"];
  if (observation.course.unit === "yd") notes.push("native_yard_field_estimate");
  if (observation.equipment.length > 0) notes.push("equipment_specific");
  if (observation.stroke !== "freestyle") notes.push("non_freestyle_stroke");
  if (observation.verified !== true) notes.push("unverified_self_report");
  return swimOk({
    msPer100,
    unit: observation.course.unit,
    course: observation.course,
    stroke: observation.stroke,
    equipment: [...observation.equipment],
    protocol: observation.protocol,
    heuristic: true,
    notes,
    observation,
    version: SWIM_ASSESSMENT_VERSION,
  });
}

function sameEquipment(a: readonly SwimEquipment[], b: readonly SwimEquipment[]): boolean {
  if (a.length !== b.length) return false;
  const left = [...a].sort();
  const right = [...b].sort();
  return left.every((piece, index) => piece === right[index]);
}

/** Pace is compared only inside a compatible category (ADR 0079, DC-SW1). */
export function isCalibrationCompatible(
  calibration: SwimCalibration,
  course: PoolCourse,
  stroke: SwimStroke,
  equipment: readonly SwimEquipment[],
): boolean {
  return (
    poolCourseEquals(calibration.course, course) &&
    calibration.stroke === stroke &&
    sameEquipment(calibration.equipment, equipment)
  );
}

export function isUsableSwimCalibration(calibration: SwimCalibration): boolean {
  if (calibration.observation.verified !== true ||
      calibration.version !== SWIM_ASSESSMENT_VERSION || calibration.heuristic !== true) return false;
  const expected = estimateCriticalSwimSpeed(calibration.observation);
  return expected.ok &&
    calibration.msPer100 === expected.value.msPer100 &&
    calibration.unit === expected.value.unit &&
    calibration.protocol === expected.value.protocol &&
    isCalibrationCompatible(calibration, expected.value.course, expected.value.stroke, expected.value.equipment);
}

export function calibrationSnapshot(calibration: SwimCalibration): SwimCalibrationSnapshot {
  return {
    msPer100: calibration.msPer100,
    unit: calibration.unit,
    protocol: calibration.protocol,
    observedOn: calibration.observation.observedOn,
    heuristic: true,
    version: calibration.version,
    observation: calibration.observation,
  };
}

/**
 * Effort multipliers applied to critical swim speed. Heuristic, versioned, and
 * documented in {@link SWIM_HEURISTIC_DOC}; not scientifically calibrated.
 * `threshold` is critical speed itself, which is why it is default-off work.
 */
export const SWIM_EFFORT_PACE_FACTORS: Readonly<Record<SwimEffort, number>> = {
  easy: 1.18,
  steady: 1.1,
  brisk: 1.04,
  threshold: 1.0,
  sprint: 0.9,
};

/** Whole-millisecond pace target for one repeat, or `null` when uncalibrated. */
export function paceTargetMs(
  calibration: SwimCalibration | null,
  effort: SwimEffort,
  lengths: number,
  course: PoolCourse,
  stroke: SwimStroke,
  equipment: readonly SwimEquipment[],
): number | null {
  if (!calibration || !isUsableSwimCalibration(calibration)) return null;
  if (!isCalibrationCompatible(calibration, course, stroke, equipment)) return null;
  if (!isPositiveInteger(lengths)) return null;
  const nativeUnits = (lengths * course.numerator) / course.denominator;
  const factor = SWIM_EFFORT_PACE_FACTORS[effort];
  const ms = Math.round((calibration.msPer100 * factor * nativeUnits) / 100);
  return ms > 0 && ms <= MAX_SWIM_MS ? ms : null;
}

// ---------------------------------------------------------------------------
// Results, lifecycle and analytics
// ---------------------------------------------------------------------------

export type SwimCompletion = "completed" | "partial" | "missed";

export interface SwimResultLifecycle {
  /** The plan was paused over this planned date (ADR 0079 lifecycle). */
  readonly planPaused: boolean;
  /** The session is in the trash. */
  readonly trashed: boolean;
  /** A late offline completion accepted after the plan stopped. */
  readonly archivedLate: boolean;
}

export interface SwimSettledResult {
  readonly workoutId: string;
  readonly dateISO: string;
  readonly course: PoolCourse;
  readonly stroke: SwimStroke;
  readonly equipment: readonly SwimEquipment[];
  readonly plannedLengths: number;
  readonly actualLengths: number | null;
  readonly actualMs: number | null;
  readonly completion: SwimCompletion;
  readonly rpe: number | null;
  readonly lifecycle: SwimResultLifecycle;
}

/**
 * Vocabulary alias for the logged result. Note that {@link SwimResult} is the
 * ok/error wrapper returned by fallible functions — a different thing.
 */
export type SwimLoggedResult = SwimSettledResult;

export interface SwimDose {
  readonly mainRepeats: number;
  readonly mainRepLengths: number;
  readonly mainRestSeconds: number;
}

export interface SwimEventPrep {
  readonly enabled: true;
  readonly windowWeeks: number;
}


export interface SwimVersions {
  readonly model: string;
  readonly generator: string;
  readonly assessment: string | null;
}

/**
 * One recorded interval. Whole lengths, integer milliseconds. Array position is
 * the order; there is no index field, so storage validates exactly these two.
 */
export interface SwimSplit {
  readonly lengths: number;
  readonly timeMs: number;
}

/**
 * What a storage row records about the swim itself: the conditions swum and the
 * work done. Deliberately narrower than the persisted {@link SwimActualResult}:
 * no envelope, no provenance, since the engine reads only the swim.
 */
export interface SwimStoredActual {
  readonly snapshot: SwimWorkoutSnapshot;
  readonly lengths: number;
  readonly timeMs: number | null;
  readonly rpe: number | null;
  readonly completion: "completed" | "partial";
  readonly splits?: readonly SwimSplit[] | undefined;
}

/** How the actual reached storage. Manual entry is the only source (DC-SW7). */
export interface SwimActualProvenance {
  readonly source: "manual";
  readonly recordedAt: string;
  /** Given when the conditions swum differ from the ones prescribed. */
  readonly deviationReason?: string | undefined;
}

/**
 * The persisted actual, exactly as it is stored in `cardio_logs.swim_result`.
 * This is the one canonical shape: `@hta/db` re-exports it rather than
 * redeclaring it, and {@link parseSwimActualResult} is the only runtime
 * validator, so SQL, storage and the load ledger reject the same rows for the
 * same reasons. Identity, schedule and lifecycle belong to the workout row.
 */
export interface SwimActualResult extends SwimStoredActual {
  readonly version: 1;
  /** Always recorded: the SQL bound is 1 ms..24 h, with no null accepted. */
  readonly timeMs: number;
  readonly provenance: SwimActualProvenance;
}

// ---------------------------------------------------------------------------
// Progression audit (DC-SW5). Declared here, not in the engine, so persistence
// can type the stored ledger without depending on the generator.
// ---------------------------------------------------------------------------

export type SwimDecisionKind = "progress" | "hold" | "reduce";

export type SwimLever = "main_repeats" | "main_rep_lengths" | "none";

export type SwimProposalReason =
  | "no_settled_work"
  | "completed_as_prescribed"
  | "effort_comfortable"
  | "effort_high"
  | "missed_sessions"
  | "partial_completion"
  | "effort_not_reported"
  | "recovery_context"
  | "minimum_increment_exceeds_cap"
  | "already_at_minimum";

/** Why a settled result was not evidence for this proposal. */
export type SwimEvidenceExclusion = "lifecycle" | "different_course";

/**
 * The progression thresholds in force when a proposal was made. Frozen with the
 * proposal so a decision taken under one rule set is never re-read under
 * another (DC-SW5). Heuristic; see {@link SWIM_HEURISTIC_DOC}.
 */
export interface SwimProgressionRules {
  readonly version: string;
  readonly strongCompletion: number;
  readonly highRpe: number;
  readonly easyRpe: number;
  readonly capFraction: number;
  readonly maxStepLengths: number;
  readonly minMainRepeats: number;
  readonly minMainRepLengths: number;
}

/**
 * The evidence a proposal was made from, frozen at the moment it was made.
 *
 * It stores the consulted results VERBATIM, not their ids: an actual can be
 * edited afterwards, and a snapshot of ids would then read as evidence that no
 * longer exists. Aggregates are kept alongside so a reader need not recompute
 * them, but the raw rows, the setup and the rule constants are what make the
 * decision reproducible.
 */
export interface SwimProposalSnapshot {
  readonly asOfISO: string;
  readonly courseKey: string;
  /** The setup as consulted — goal, course, strokes, equipment, budget. */
  readonly setup: SwimSetup;
  /** Every result that counted, exactly as it read at decision time. */
  readonly consideredResults: readonly SwimSettledResult[];
  /** Every result that did not count, with the reason it did not. */
  readonly excludedResults: readonly {
    readonly result: SwimSettledResult;
    readonly reason: SwimEvidenceExclusion;
  }[];
  readonly rules: SwimProgressionRules;
  readonly plannedLengths: number;
  readonly actualLengths: number;
  readonly completionRatio: number | null;
  readonly missedSessions: number;
  /** Mean of the reported efforts only. Never a stand-in for the missing ones. */
  readonly meanRpe: number | null;
  readonly rpeReported: number;
  /** Swims that happened with no effort reported. Any of these forces a hold. */
  readonly rpeMissing: number;
  readonly actualMs: number | null;
  readonly recovery: {
    readonly hardStrengthDaysNext7: number;
    readonly primaryRecoveryWeek: boolean;
  } | null;
  readonly capLengths: number;
}

export interface SwimProposal {
  readonly proposalId: string;
  readonly decision: SwimDecisionKind;
  readonly lever: SwimLever;
  readonly from: SwimDose;
  readonly to: SwimDose;
  readonly reasons: readonly SwimProposalReason[];
  readonly snapshot: SwimProposalSnapshot;
  readonly versions: { readonly model: string; readonly generator: string };
}

export type SwimDecisionAction = "accept" | "reject" | "override";

export interface SwimDecisionEntry {
  readonly proposalId: string;
  readonly action: SwimDecisionAction;
  readonly atISO: string;
  readonly decision: SwimDecisionKind;
  /** The dose in force when the proposal was made. */
  readonly from: SwimDose;
  readonly proposed: SwimDose;
  readonly applied: SwimDose;
  readonly reasons: readonly SwimProposalReason[];
  readonly snapshot: SwimProposalSnapshot;
  readonly note?: string | undefined;
  /** Override-and-warn (DC-K4): the override applies and the warning is kept. */
  readonly warning: string | null;
  readonly versions: { readonly model: string; readonly generator: string };
}

export interface SwimDecisionLedger {
  readonly entries: readonly SwimDecisionEntry[];
  readonly currentDose: SwimDose;
}

/**
 * The stroke a mixed session is filed under: the first stroke in the snapshot,
 * which the generator writes main-set first. Grouping only — every length is
 * still counted, and exposure reads the whole snapshot, not this.
 */
export function swimPrimaryStroke(strokes: readonly SwimStroke[]): SwimStroke {
  return strokes[0] ?? "freestyle";
}

/** What the workout row contributes: identity, the plan, and lifecycle state. */
export interface SwimSettledContext {
  readonly workoutId: string;
  readonly dateISO: string;
  readonly plannedLengths: number;
  /** The pool the session was prescribed in. Used only when nothing was swum. */
  readonly plannedCourse: PoolCourse;
  readonly lifecycle: SwimResultLifecycle;
}

/**
 * The single conversion from stored rows to the engine's view (plan §6.9).
 *
 * A skipped or unlogged slot is passed as `null` and settles as MISSED, which
 * is how a miss reaches adherence without inventing an actual. Course, stroke
 * and equipment come from the snapshot — what was actually swum — so a swimmer
 * who moved pool or dropped the paddles is never scored against the plan's
 * conditions.
 */
export function settledFromStoredActual(
  actual: SwimStoredActual | null,
  context: SwimSettledContext,
): SwimSettledResult {
  if (actual === null) {
    return {
      workoutId: context.workoutId,
      dateISO: context.dateISO,
      course: context.plannedCourse,
      stroke: "freestyle",
      equipment: [],
      plannedLengths: context.plannedLengths,
      actualLengths: null,
      actualMs: null,
      completion: "missed",
      rpe: null,
      lifecycle: context.lifecycle,
    };
  }
  return {
    workoutId: context.workoutId,
    dateISO: context.dateISO,
    course: actual.snapshot.course,
    stroke: swimPrimaryStroke(actual.snapshot.strokes),
    equipment: [...actual.snapshot.equipment],
    plannedLengths: context.plannedLengths,
    actualLengths: actual.lengths,
    actualMs: actual.timeMs,
    completion: actual.completion,
    rpe: actual.rpe,
    lifecycle: context.lifecycle,
  };
}

/** RPE is recorded in tenths, so 7.5 is allowed and 7.55 is not. */
function isValidRpe(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 10 &&
    Number.isInteger(Math.round(value * 10)) &&
    Math.abs(value * 10 - Math.round(value * 10)) < 1e-9
  );
}

function isISOTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length < 20) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && isISODate(value.slice(0, 10));
}

/**
 * Bounds a stored actual must satisfy. Mirrors the SQL checks so a rejected row
 * and a rejected object fail for the same reason. Assumes the value already has
 * the declared shape — {@link parseSwimActualResult} is what unknown input goes
 * through.
 */
export function validateSwimActualResult(result: SwimActualResult): SwimIssue[] {
  const issues: SwimIssue[] = [];
  const push = (field: string, code: SwimIssue["code"], message: string): void => {
    issues.push({ field, code, severity: "blocking", message });
  };
  if (result.version !== 1) {
    push("version", "version_unsupported", "This swim result was saved by a newer version.");
  }
  if (!isValidPoolCourse(result.snapshot?.course)) {
    push("snapshot.course", "course_invalid", "The pool length is not a supported pool.");
  }
  if (!Array.isArray(result.snapshot?.strokes) || result.snapshot.strokes.length === 0) {
    push("snapshot.strokes", "snapshot_invalid", "The swim records no stroke.");
  }
  const calibration = result.snapshot?.calibration;
  if (calibration && calibration.unit !== result.snapshot.course?.unit) {
    push(
      "snapshot.calibration",
      "snapshot_invalid",
      "The saved pace was measured in a different unit from the pool.",
    );
  }
  if (!isPositiveInteger(result.lengths) || result.lengths > MAX_POOL_LENGTHS) {
    push("lengths", "lengths_out_of_range", "Lengths are out of range.");
  }
  if (!isPositiveInteger(result.timeMs) || result.timeMs > MAX_SWIM_MS) {
    push("timeMs", "duration_out_of_range", "The recorded time is out of range.");
  }
  if (result.rpe !== null && !isValidRpe(result.rpe)) {
    push("rpe", "rpe_out_of_range", "Effort must be between 0 and 10.");
  }
  if (result.completion !== "completed" && result.completion !== "partial") {
    push("completion", "completion_invalid", "A recorded swim is either completed or partial.");
  }
  const provenance = result.provenance;
  if (
    provenance?.source !== "manual" ||
    !isISOTimestamp(provenance.recordedAt) ||
    (provenance.deviationReason !== undefined && typeof provenance.deviationReason !== "string")
  ) {
    push("provenance", "provenance_invalid", "The swim result is missing how it was recorded.");
  }
  const splits = result.splits ?? [];
  let splitLengths = 0;
  for (const split of splits) {
    if (!isPositiveInteger(split.lengths) || split.lengths > MAX_POOL_LENGTHS) {
      push("splits", "split_lengths_invalid", "Split lengths must be whole lengths.");
    }
    if (!isPositiveInteger(split.timeMs) || split.timeMs > MAX_SWIM_MS) {
      push("splits", "split_time_invalid", "Split times must be positive milliseconds.");
    }
    splitLengths += split.lengths;
  }
  if (splits.length > 0) {
    if (isPositiveInteger(result.lengths) && splitLengths > result.lengths) {
      push("splits", "splits_exceed_actual", "Splits add up to more than the work recorded.");
    }
    const splitMs = splits.reduce((sum, split) => sum + split.timeMs, 0);
    if (isPositiveInteger(result.timeMs) && splitMs > result.timeMs) {
      push("splits", "splits_exceed_duration", "Splits add up to more than the time recorded.");
    }
  }
  return issues;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Vocabularies a stored snapshot is allowed to use. A value outside them cannot
 * be mapped to a stroke, a piece of kit or a protocol, so it is rejected here
 * rather than reaching exposure, analytics or the ledger.
 */
const SWIM_STROKE_VALUES: ReadonlySet<string> = new Set<SwimStroke>([
  "freestyle",
  "backstroke",
  "breaststroke",
  "butterfly",
  "individual_medley",
  "choice",
  "kick",
]);

const SWIM_EQUIPMENT_VALUES: ReadonlySet<string> = new Set<SwimEquipment>([
  "kickboard",
  "pull_buoy",
  "fins",
  "paddles",
  "snorkel",
]);

const SWIM_PROTOCOL_VALUES: ReadonlySet<string> = new Set<SwimProtocolId>(["css_200_400"]);

function isKnownArray(value: unknown, allowed: ReadonlySet<string>): boolean {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string" && allowed.has(entry))
  );
}

function hasCalibrationShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isPlausibleMsPer100(value["msPer100"]) &&
    (value["unit"] === "m" || value["unit"] === "yd") &&
    typeof value["protocol"] === "string" &&
    SWIM_PROTOCOL_VALUES.has(value["protocol"]) &&
    typeof value["observedOn"] === "string" &&
    isISODate(value["observedOn"]) &&
    value["heuristic"] === true &&
    typeof value["version"] === "string" &&
    (value["observation"] === undefined || isRecord(value["observation"]))
  );
}

/**
 * A stored rate is readable when it is a positive half-millisecond value inside
 * the plausible band. Whole milliseconds are not required: {@link
 * estimateCriticalSwimSpeed} halves a difference of two integer times, so its
 * own output would otherwise fail to read back.
 */
function isPlausibleMsPer100(value: unknown): boolean {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value * 2) &&
    value >= SWIM_MIN_PLAUSIBLE_MS_PER_100 &&
    value <= SWIM_MAX_PLAUSIBLE_MS_PER_100
  );
}

function hasSnapshotShape(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const versions = value["versions"];
  const protocol = value["protocol"];
  return (
    isRecord(value["course"]) &&
    isKnownArray(value["strokes"], SWIM_STROKE_VALUES) &&
    isKnownArray(value["equipment"], SWIM_EQUIPMENT_VALUES) &&
    (protocol === null || (typeof protocol === "string" && SWIM_PROTOCOL_VALUES.has(protocol))) &&
    (value["calibration"] === null || hasCalibrationShape(value["calibration"])) &&
    isRecord(versions) &&
    typeof versions["model"] === "string" &&
    typeof versions["generator"] === "string" &&
    (versions["assessment"] === null || typeof versions["assessment"] === "string")
  );
}

/**
 * The one runtime door for a stored actual (plan §6.9). Everything that reads
 * `swim_result` — history, analytics, the daily-load ledger — comes through
 * here, so no caller re-implements native validation and no unvalidated row
 * reaches the arithmetic. Rejects on the first blocking issue, with the message
 * the user should see.
 */
export function parseSwimActualResult(input: unknown): SwimResult<SwimActualResult> {
  if (!isRecord(input)) {
    return swimErr("result_invalid", "The saved swim result is not readable.");
  }
  const splits = input["splits"];
  const shaped =
    hasSnapshotShape(input["snapshot"]) &&
    typeof input["lengths"] === "number" &&
    typeof input["timeMs"] === "number" &&
    (input["rpe"] === null || typeof input["rpe"] === "number") &&
    typeof input["completion"] === "string" &&
    (splits === undefined ||
      (Array.isArray(splits) &&
        splits.every(
          (split) =>
            isRecord(split) &&
            typeof split["lengths"] === "number" &&
            typeof split["timeMs"] === "number",
        ))) &&
    isRecord(input["provenance"]);
  if (!shaped) {
    return swimErr("result_invalid", "The saved swim result is not readable.");
  }
  const candidate = input as unknown as SwimActualResult;
  const issues = validateSwimActualResult(candidate);
  const blocking = issues.find((issue) => issue.severity === "blocking");
  if (blocking) {
    return swimErr("result_invalid", blocking.message, {
      field: blocking.field,
      code: blocking.code,
    });
  }
  return swimOk(candidate);
}

/** Real swimming that happened. Trashed rows and misses are not history. */
export function countsTowardHistory(result: SwimSettledResult): boolean {
  return (
    !result.lifecycle.trashed &&
    result.completion !== "missed" &&
    result.actualLengths !== null &&
    result.actualLengths > 0
  );
}

/** Paused planned dates are not missed work (ADR 0079 lifecycle). */
export function countsTowardAdherence(result: SwimSettledResult): boolean {
  return !result.lifecycle.trashed && !result.lifecycle.planPaused;
}

/** A late completion is history and load, but it cannot advance a plan. */
export function countsTowardProgression(result: SwimSettledResult): boolean {
  return (
    !result.lifecycle.trashed && !result.lifecycle.planPaused && !result.lifecycle.archivedLate
  );
}

export interface SwimCourseTotals {
  readonly courseKey: string;
  readonly course: PoolCourse;
  readonly courseLabel: string;
  readonly plannedLengths: number;
  readonly actualLengths: number;
  /** Exact totals over the whole week, not bounded by one swim's limit. */
  readonly plannedDistance: ExactDistance | null;
  readonly actualDistance: ExactDistance | null;
  readonly actualDistanceLabel: string;
  readonly plannedDistanceLabel: string;
  readonly sessionsPlanned: number;
  /** Planned sessions that were completed — the adherence numerator. */
  readonly sessionsCompleted: number;
  /**
   * Swims that actually happened, including ones no adherence figure can count
   * (a paused plan, a late archived completion). Frequency, not compliance.
   */
  readonly actualSessions: number;
  readonly actualMs: number | null;
  /** Completed ÷ planned sessions, or `null` when nothing was planned. */
  readonly adherence: number | null;
}

export interface SwimWeeklyAnalytics {
  readonly weekStartISO: string;
  /** One entry per native pool. Never an unlabelled mixed total (DC-SW6). */
  readonly byCourse: readonly SwimCourseTotals[];
  readonly sessionsPlanned: number;
  readonly sessionsCompleted: number;
  /** Swims that happened, whether or not adherence could count them. */
  readonly actualSessions: number;
  readonly adherence: number | null;
}

/**
 * The week's swimming, per pool. Results dated outside the seven days from
 * `weekStartISO` are ignored, so a caller cannot accidentally roll a month into
 * one week's adherence.
 */
export function summarizeSwimWeek(input: {
  readonly weekStartISO: string;
  readonly results: readonly SwimSettledResult[];
}): SwimWeeklyAnalytics {
  const buckets = new Map<
    string,
    {
      course: PoolCourse;
      plannedLengths: number;
      actualLengths: number;
      sessionsPlanned: number;
      sessionsCompleted: number;
      actualSessions: number;
      actualMs: number | null;
    }
  >();
  for (const result of input.results) {
    if (result.lifecycle.trashed) continue;
    const offset = daysBetweenISO(input.weekStartISO, result.dateISO);
    if (offset < 0 || offset > 6) continue;
    const key = poolCourseKey(result.course);
    const bucket = buckets.get(key) ?? {
      course: result.course,
      plannedLengths: 0,
      actualLengths: 0,
      sessionsPlanned: 0,
      sessionsCompleted: 0,
      actualSessions: 0,
      actualMs: null,
    };
    if (countsTowardAdherence(result)) {
      bucket.plannedLengths += result.plannedLengths;
      bucket.sessionsPlanned += 1;
    }
    if (countsTowardHistory(result)) {
      bucket.actualLengths += result.actualLengths ?? 0;
      bucket.actualSessions += 1;
      if (countsTowardAdherence(result)) bucket.sessionsCompleted += 1;
      if (result.actualMs !== null) bucket.actualMs = (bucket.actualMs ?? 0) + result.actualMs;
    }
    buckets.set(key, bucket);
  }
  const byCourse: SwimCourseTotals[] = [...buckets.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([courseKey, bucket]) => {
      const plannedDistance = aggregateNativeDistance(bucket.plannedLengths, bucket.course);
      const actualDistance = aggregateNativeDistance(bucket.actualLengths, bucket.course);
      return {
        courseKey,
        course: bucket.course,
        courseLabel: formatPoolCourse(bucket.course),
        plannedLengths: bucket.plannedLengths,
        actualLengths: bucket.actualLengths,
        plannedDistance: plannedDistance.ok ? plannedDistance.value : null,
        actualDistance: actualDistance.ok ? actualDistance.value : null,
        plannedDistanceLabel: formatSwimDistance(bucket.plannedLengths, bucket.course),
        actualDistanceLabel: formatSwimDistance(bucket.actualLengths, bucket.course),
        sessionsPlanned: bucket.sessionsPlanned,
        sessionsCompleted: bucket.sessionsCompleted,
        actualSessions: bucket.actualSessions,
        actualMs: bucket.actualMs,
        adherence:
          bucket.sessionsPlanned === 0 ? null : bucket.sessionsCompleted / bucket.sessionsPlanned,
      };
    });
  const sessionsPlanned = byCourse.reduce((sum, entry) => sum + entry.sessionsPlanned, 0);
  const sessionsCompleted = byCourse.reduce((sum, entry) => sum + entry.sessionsCompleted, 0);
  const actualSessions = byCourse.reduce((sum, entry) => sum + entry.actualSessions, 0);
  return {
    weekStartISO: input.weekStartISO,
    byCourse,
    sessionsPlanned,
    sessionsCompleted,
    actualSessions,
    adherence: sessionsPlanned === 0 ? null : sessionsCompleted / sessionsPlanned,
  };
}

export interface SwimBenchmarkPoint {
  readonly observedOn: string;
  readonly distance: number;
  readonly lengths: number;
  readonly timeMs: number;
  readonly protocol: SwimProtocolId;
  readonly version: string;
}

export type SwimTrendExclusionReason =
  | "protocol_unsupported"
  | "version_unsupported"
  | "course_invalid"
  | "date_invalid"
  | "distance_not_in_protocol"
  | "distance_not_whole_lengths"
  | "duration_invalid"
  | "pace_implausible"
  | "times_implausible";

export interface SwimTrendExclusion {
  readonly observedOn: string;
  readonly protocol: string;
  readonly version: string;
  readonly reason: SwimTrendExclusionReason;
}

export interface SwimTrend {
  readonly course: PoolCourse;
  readonly courseLabel: string;
  readonly stroke: SwimStroke;
  readonly equipment: readonly SwimEquipment[];
  /** Chronological, compatible-category only. */
  readonly points: readonly SwimBenchmarkPoint[];
  /** Fastest time per native distance inside this category. */
  readonly personalBests: readonly SwimBenchmarkPoint[];
  /** Matching records this version cannot read or cannot trust. */
  readonly excluded: readonly SwimTrendExclusion[];
}

/** Assessment versions this build can compare. A future version is not mixed in. */
export const SWIM_SUPPORTED_ASSESSMENT_VERSIONS: readonly string[] = [SWIM_ASSESSMENT_VERSION];

function trendExclusion(
  observation: SwimObservation,
  reason: SwimTrendExclusionReason,
): SwimTrendExclusion {
  return {
    observedOn: observation.observedOn,
    protocol: observation.protocol,
    version: observation.version,
    reason,
  };
}

/**
 * A trend is a comparison, so everything in it must be comparable: the same
 * pool, stroke and equipment (DC-SW1), a protocol this build understands, a
 * version it can read, and times that survive the same checks the assessment
 * itself applies. An observation that fails any of these is excluded whole —
 * a half-trusted record would put an untrustworthy time on the personal-best
 * list. Monotonicity (longer distance, longer time) and the same plausible
 * pace band the estimate uses are the only physiological checks here; the
 * stricter 200/400 pairing rule belongs to the estimate, not to a list of
 * times actually swum.
 */
export function swimBenchmarkTrend(
  observations: readonly SwimObservation[],
  filter: {
    readonly course: PoolCourse;
    readonly stroke: SwimStroke;
    readonly equipment: readonly SwimEquipment[];
    readonly protocol?: SwimProtocolId | undefined;
  },
): SwimTrend {
  const points: SwimBenchmarkPoint[] = [];
  const excluded: SwimTrendExclusion[] = [];
  for (const observation of observations) {
    if (!isValidPoolCourse(observation.course)) {
      excluded.push(trendExclusion(observation, "course_invalid"));
      continue;
    }
    if (!poolCourseEquals(observation.course, filter.course)) continue;
    if (observation.stroke !== filter.stroke) continue;
    if (!sameEquipment(observation.equipment, filter.equipment)) continue;
    if (filter.protocol !== undefined && observation.protocol !== filter.protocol) continue;
    const distances = SWIM_PROTOCOL_DISTANCES[observation.protocol];
    if (!distances) {
      excluded.push(trendExclusion(observation, "protocol_unsupported"));
      continue;
    }
    if (!SWIM_SUPPORTED_ASSESSMENT_VERSIONS.includes(observation.version)) {
      excluded.push(trendExclusion(observation, "version_unsupported"));
      continue;
    }
    if (!isISODate(observation.observedOn)) {
      excluded.push(trendExclusion(observation, "date_invalid"));
      continue;
    }
    let reason: SwimTrendExclusionReason | null = null;
    for (const trial of observation.trials) {
      if (!distances.includes(trial.distance)) {
        reason = "distance_not_in_protocol";
        break;
      }
      const expected = lengthsForNativeDistance(trial.distance, observation.course);
      if (!expected.ok || expected.value !== trial.lengths) {
        reason = "distance_not_whole_lengths";
        break;
      }
      if (!isPositiveInteger(trial.timeMs) || trial.timeMs > MAX_SWIM_MS) {
        reason = "duration_invalid";
        break;
      }
      const msPer100 = (trial.timeMs * 100) / trial.distance;
      if (msPer100 < SWIM_MIN_PLAUSIBLE_MS_PER_100 || msPer100 > SWIM_MAX_PLAUSIBLE_MS_PER_100) {
        reason = "pace_implausible";
        break;
      }
    }
    if (reason === null) {
      for (const a of observation.trials) {
        for (const b of observation.trials) {
          if (a.distance < b.distance && a.timeMs >= b.timeMs) reason = "times_implausible";
        }
      }
    }
    if (reason !== null) {
      excluded.push(trendExclusion(observation, reason));
      continue;
    }
    for (const trial of observation.trials) {
      points.push({
        observedOn: observation.observedOn,
        distance: trial.distance,
        lengths: trial.lengths,
        timeMs: trial.timeMs,
        protocol: observation.protocol,
        version: observation.version,
      });
    }
  }
  points.sort((a, b) =>
    a.observedOn === b.observedOn ? a.distance - b.distance : a.observedOn < b.observedOn ? -1 : 1,
  );
  const bests = new Map<number, SwimBenchmarkPoint>();
  for (const point of points) {
    const current = bests.get(point.distance);
    if (!current || point.timeMs < current.timeMs) bests.set(point.distance, point);
  }
  return {
    course: filter.course,
    courseLabel: formatPoolCourse(filter.course),
    stroke: filter.stroke,
    equipment: [...filter.equipment],
    points,
    personalBests: [...bests.values()].sort((a, b) => a.distance - b.distance),
    excluded,
  };
}

// ---------------------------------------------------------------------------
// Shared load seam (DC-SW9)
//
// This is a naming seam, not a second injury system. It answers one question —
// which regions did this swimming touch — and hands the answer to the existing
// regional workload path, which already owns the weights (primary 1, secondary
// 0.5) and the limitation gates. There is no swim-specific coefficient, no
// per-length load total and no injury-risk ratio here, because nothing supports
// one. Limitation decisions stay with the existing limitations helper, which
// applies the same severity rules as every other modality; swimming never
// reinterprets severity and never silently substitutes a stroke.
// ---------------------------------------------------------------------------

/**
 * Regions a stroke exposes: one primary, the rest secondary. This is the same
 * primary/secondary vocabulary the existing region ledger already uses — there
 * is deliberately no swim-specific injury-risk ratio, because none of the
 * sources support one. Documented in {@link SWIM_HEURISTIC_DOC}.
 */
export interface SwimExposure {
  readonly primaryRegion: Region;
  readonly secondaryRegions: readonly Region[];
}

/** Shared with the existing ledger: primary counts 1, secondary counts 0.5. */
export const SWIM_PRIMARY_REGION_WEIGHT = 1;
export const SWIM_SECONDARY_REGION_WEIGHT = 0.5;

/**
 * A swim logged without structure (a generic cardio entry) keeps the mapping
 * the ledger already used before pool swimming existed.
 */
export const GENERIC_SWIM_EXPOSURE: SwimExposure = {
  primaryRegion: "shoulder_scapular",
  secondaryRegions: ["lumbar_trunk"],
};

const REGION_ORDER: readonly Region[] = [
  "shoulder_scapular",
  "elbow_forearm",
  "lumbar_trunk",
  "adductor_groin",
  "knee",
  "hamstring_posterior",
  "foot_ankle_calf",
];

const LOWER_BODY_REGIONS: readonly Region[] = [
  "adductor_groin",
  "knee",
  "hamstring_posterior",
  "foot_ankle_calf",
];

/**
 * Structured strokes. Every full stroke swims with both arms and legs, so each
 * one exposes the shoulder and elbow that pull it and the lower-body regions
 * its kick uses. Regions only — the ledger already owns primary 1 / secondary
 * 0.5, and there is deliberately no swim-specific coefficient or risk ratio.
 */
const STROKE_EXPOSURE: Readonly<Record<SwimStroke, SwimExposure>> = {
  freestyle: {
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm", "lumbar_trunk", "knee", "foot_ankle_calf"],
  },
  backstroke: {
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm", "lumbar_trunk", "knee", "foot_ankle_calf"],
  },
  butterfly: {
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm", "lumbar_trunk", "knee", "foot_ankle_calf"],
  },
  choice: {
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm", "lumbar_trunk", "knee", "foot_ankle_calf"],
  },
  breaststroke: {
    primaryRegion: "shoulder_scapular",
    secondaryRegions: ["elbow_forearm", "lumbar_trunk", "adductor_groin", "knee"],
  },
  individual_medley: {
    primaryRegion: "shoulder_scapular",
    secondaryRegions: [
      "elbow_forearm",
      "lumbar_trunk",
      "adductor_groin",
      "knee",
      "foot_ankle_calf",
    ],
  },
  kick: {
    primaryRegion: "knee",
    secondaryRegions: ["lumbar_trunk", "hamstring_posterior", "foot_ankle_calf"],
  },
};

/** Equipment adds regions; only the pull buoy takes any away. */
const EQUIPMENT_ADDED_REGIONS: Readonly<Record<SwimEquipment, readonly Region[]>> = {
  fins: ["foot_ankle_calf"],
  paddles: ["elbow_forearm"],
  kickboard: ["shoulder_scapular"],
  pull_buoy: [],
  snorkel: [],
};

export type SwimMuscle =
  | "latissimus_dorsi"
  | "deltoid"
  | "rotator_cuff"
  | "pectoralis"
  | "triceps"
  | "forearm_flexors"
  | "trunk_stabilisers"
  | "erector_spinae"
  | "gluteals"
  | "hip_flexors"
  | "hip_adductors"
  | "quadriceps"
  | "hamstrings"
  | "gastrocnemius"
  | "tibialis_anterior";

const MUSCLE_ORDER: readonly SwimMuscle[] = [
  "latissimus_dorsi",
  "deltoid",
  "rotator_cuff",
  "pectoralis",
  "triceps",
  "forearm_flexors",
  "trunk_stabilisers",
  "erector_spinae",
  "gluteals",
  "hip_flexors",
  "hip_adductors",
  "quadriceps",
  "hamstrings",
  "gastrocnemius",
  "tibialis_anterior",
];

const STROKE_MUSCLES: Readonly<Record<SwimStroke, readonly SwimMuscle[]>> = {
  freestyle: ["latissimus_dorsi", "deltoid", "rotator_cuff", "triceps", "trunk_stabilisers"],
  backstroke: ["latissimus_dorsi", "deltoid", "rotator_cuff", "triceps", "trunk_stabilisers"],
  butterfly: [
    "latissimus_dorsi",
    "deltoid",
    "rotator_cuff",
    "pectoralis",
    "triceps",
    "trunk_stabilisers",
    "erector_spinae",
  ],
  choice: ["latissimus_dorsi", "deltoid", "rotator_cuff", "triceps", "trunk_stabilisers"],
  breaststroke: [
    "latissimus_dorsi",
    "deltoid",
    "pectoralis",
    "trunk_stabilisers",
    "hip_adductors",
    "quadriceps",
  ],
  individual_medley: [
    "latissimus_dorsi",
    "deltoid",
    "rotator_cuff",
    "pectoralis",
    "triceps",
    "trunk_stabilisers",
    "hip_adductors",
    "quadriceps",
  ],
  kick: ["quadriceps", "hip_flexors", "gluteals", "hamstrings", "gastrocnemius"],
};

const EQUIPMENT_ADDED_MUSCLES: Readonly<Record<SwimEquipment, readonly SwimMuscle[]>> = {
  fins: ["gastrocnemius", "tibialis_anterior", "quadriceps"],
  paddles: ["forearm_flexors", "rotator_cuff"],
  kickboard: ["deltoid"],
  pull_buoy: [],
  snorkel: [],
};

const LOWER_BODY_MUSCLES: readonly SwimMuscle[] = [
  "gluteals",
  "hip_flexors",
  "hip_adductors",
  "quadriceps",
  "hamstrings",
  "gastrocnemius",
  "tibialis_anterior",
];

/**
 * Regions one stroke exposes, with its equipment applied (DC-SW9).
 *
 * A pull buoy floats the legs, so it drops lower-body secondaries — except on a
 * kick set, where the buoy cannot be doing that job. Same rule as
 * {@link swimMuscleExposure}, so the two mappings never disagree.
 */
export function swimRegionExposure(
  stroke: SwimStroke,
  equipment: readonly SwimEquipment[] = [],
): SwimExposure {
  const base = STROKE_EXPOSURE[stroke];
  const secondary = new Set<Region>(base.secondaryRegions);
  for (const piece of equipment) {
    for (const region of EQUIPMENT_ADDED_REGIONS[piece]) secondary.add(region);
  }
  if (equipment.includes("pull_buoy") && stroke !== "kick") {
    for (const region of LOWER_BODY_REGIONS) secondary.delete(region);
  }
  secondary.delete(base.primaryRegion);
  return {
    primaryRegion: base.primaryRegion,
    secondaryRegions: REGION_ORDER.filter((region) => secondary.has(region)),
  };
}

/** Muscles one stroke exposes, with its equipment applied. Labels, not loads. */
export function swimMuscleExposure(
  stroke: SwimStroke,
  equipment: readonly SwimEquipment[] = [],
): readonly SwimMuscle[] {
  const muscles = new Set<SwimMuscle>(STROKE_MUSCLES[stroke]);
  for (const piece of equipment) {
    for (const muscle of EQUIPMENT_ADDED_MUSCLES[piece]) muscles.add(muscle);
  }
  if (equipment.includes("pull_buoy") && stroke !== "kick") {
    for (const muscle of LOWER_BODY_MUSCLES) muscles.delete(muscle);
  }
  return MUSCLE_ORDER.filter((muscle) => muscles.has(muscle));
}

/**
 * The union across a mixed set. One session is one summary row, so a set that
 * mixes strokes or equipment exposes the union of their regions. A region that
 * is primary anywhere in the session is primary for the session.
 */
export interface SwimExposureUnion {
  readonly primaryRegions: readonly Region[];
  readonly secondaryRegions: readonly Region[];
  readonly regions: readonly Region[];
  /** Primary 1, secondary 0.5. Shared weights, not a swim-specific ratio. */
  readonly weights: Readonly<Partial<Record<Region, number>>>;
  readonly muscles: readonly SwimMuscle[];
}

export interface SwimExposurePart {
  readonly stroke: SwimStroke;
  readonly equipment: readonly SwimEquipment[];
}

export function swimExposureUnion(parts: readonly SwimExposurePart[]): SwimExposureUnion {
  const primary = new Set<Region>();
  const secondary = new Set<Region>();
  const muscles = new Set<SwimMuscle>();
  for (const part of parts) {
    const exposure = swimRegionExposure(part.stroke, part.equipment);
    primary.add(exposure.primaryRegion);
    for (const region of exposure.secondaryRegions) secondary.add(region);
    for (const muscle of swimMuscleExposure(part.stroke, part.equipment)) muscles.add(muscle);
  }
  for (const region of primary) secondary.delete(region);
  const primaryRegions = REGION_ORDER.filter((region) => primary.has(region));
  const secondaryRegions = REGION_ORDER.filter((region) => secondary.has(region));
  const weights: Partial<Record<Region, number>> = {};
  for (const region of primaryRegions) weights[region] = SWIM_PRIMARY_REGION_WEIGHT;
  for (const region of secondaryRegions) weights[region] = SWIM_SECONDARY_REGION_WEIGHT;
  return {
    primaryRegions,
    secondaryRegions,
    regions: REGION_ORDER.filter((region) => primary.has(region) || secondary.has(region)),
    weights,
    muscles: MUSCLE_ORDER.filter((muscle) => muscles.has(muscle)),
  };
}

/** Every stroke/equipment pairing a workout contains, in section order. */
export function swimWorkoutExposureParts(workout: SwimWorkout): readonly SwimExposurePart[] {
  const parts: SwimExposurePart[] = [];
  const seen = new Set<string>();
  for (const section of workout.sections) {
    for (const item of section.items) {
      const key = `${item.stroke}|${[...item.equipment].sort().join(",")}`;
      if (seen.has(key)) continue;
      seen.add(key);
      parts.push({ stroke: item.stroke, equipment: [...item.equipment] });
    }
  }
  return parts;
}

/** One workout, one summary row (DC-SW9). */
export function swimWorkoutExposure(workout: SwimWorkout): SwimExposureUnion {
  return swimExposureUnion(swimWorkoutExposureParts(workout));
}

/**
 * Exposure of a stored actual when only its snapshot is available — the daily
 * load ledger's case. A snapshot keeps the strokes and the kit but not which
 * kit went with which stroke, so this unions every stroke against the kit the
 * session used. Prefer {@link swimResultExposure} with the workout as performed
 * when it is available: that keeps each item's own pairing (DC-SW9).
 */
export function swimSnapshotExposure(snapshot: SwimWorkoutSnapshot): SwimExposureUnion {
  const equipment = [...snapshot.equipment];
  const strokes = snapshot.strokes.length > 0 ? snapshot.strokes : ["freestyle" as const];
  return swimExposureUnion(strokes.map((stroke) => ({ stroke, equipment })));
}

export interface SwimResultExposure extends SwimExposureUnion {
  /**
   * `performed_workout` — the union of what was actually swum.
   * `result_actual` — the logged stroke and equipment, because they no longer
   * match the prescription (a changed stroke, pool or kit).
   */
  readonly basis: "performed_workout" | "result_actual";
}

/**
 * Exposure of work that actually happened. Pass the workout as performed; when
 * the swimmer changed pool, stroke or equipment the logged actuals win, so the
 * summary row never describes a session that was not swum (DC-SW9).
 */
export function swimResultExposure(
  result: SwimSettledResult,
  performed?: SwimWorkout | null,
): SwimResultExposure {
  const matchesPlan =
    performed != null &&
    poolCourseEquals(performed.snapshot.course, result.course) &&
    performed.snapshot.strokes.includes(result.stroke) &&
    sameEquipment(performed.snapshot.equipment, result.equipment);
  if (matchesPlan) {
    return { ...swimWorkoutExposure(performed), basis: "performed_workout" };
  }
  return {
    ...swimExposureUnion([{ stroke: result.stroke, equipment: result.equipment }]),
    basis: "result_actual",
  };
}
