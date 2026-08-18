/**
 * Auto-warmup ladder generator.
 *
 * The engine prepends a series of `kind: "warmup"` prescription items
 * before each main lift so the lifter rehearses the motor pattern and
 * connective tissue gets a sub-maximal exposure before the first
 * working set. Practitioner consensus + Baar 2017 tendon adaptation
 * literature.
 *
 * Pure: no DB, no IO. Inputs in, items out. Wired into the
 * prescription assembly in `lib/planner/actions.ts`.
 */
import type { PrescriptionItem } from "@hta/db";
import {
  GLOBAL_WARMUP_PERCENTS,
  GLOBAL_WARMUP_REPS,
  type WarmupRamp,
} from "@hta/program-core";

/**
 * What `percentLadder` is a percentage OF.
 *
 * - `"top_set"` (default, app-wide): each entry is a percentage of the day's
 *   heaviest working set, so the ramp climbs as the top set climbs.
 * - `"training_max"`: each entry is a percentage of the Training Max itself,
 *   so the ramp is FLAT across a wave — a 5s week, a 3s week and a 5/3/1 week
 *   warm up with identical loads. Programs whose published method specifies a
 *   fixed ramp off the TM declare this (see `program-warmup-scheme.ts`).
 */
export type WarmupAnchor = "top_set" | "training_max";

/** Anchor assumed when a stored scheme predates the field. */
export const DEFAULT_WARMUP_ANCHOR: WarmupAnchor = "top_set";

export type WarmupScheme = {
  /** Number of warmup sets (0-5). 0 disables auto-warmups. */
  setCount: number;
  /**
   * Percent per warmup, in order. Length must match setCount. Interpreted
   * against `anchor`: a percentage of the top working set (default) or a
   * percentage of the Training Max.
   */
  percentLadder: number[];
  /** Reps per warmup set, in order. Length must match setCount. */
  repLadder: number[];
  /**
   * What `percentLadder` is measured against. OPTIONAL and absent-means-
   * `"top_set"`: this field was added after `profiles.warmup_scheme` shipped,
   * and every payload stored before it stays valid and unchanged in meaning.
   * Never write it for a top-set ladder — leaving it off keeps stored blobs
   * byte-identical to the pre-anchor shape.
   */
  anchor?: WarmupAnchor;
};

/** The scheme's effective anchor, applying the absent-means-`"top_set"` rule. */
export function warmupAnchorOf(scheme: Pick<WarmupScheme, "anchor">): WarmupAnchor {
  return scheme.anchor ?? DEFAULT_WARMUP_ANCHOR;
}

/**
 * Convert an engine-space ladder fraction (0.4) into the percent space this
 * module stores and renders (40). Rounded to 0.1% so float noise (0.30000004)
 * never reaches a persisted scheme.
 */
export function fractionToPercent(fraction: number): number {
  return Math.round(fraction * 1000) / 10;
}

/**
 * Shape written by the first warmup-settings release (migration 0039). The
 * column was nullable, so this exact value is the only legacy payload that
 * can be identified as the old implicit default rather than a user's custom
 * choice. It is upgraded to DEFAULT_WARMUP_SCHEME at read time.
 */
export const LEGACY_DEFAULT_WARMUP_SCHEME: WarmupScheme = {
  setCount: 3,
  percentLadder: [40, 50, 60],
  repLadder: [5, 3, 2],
};

/**
 * Practitioner-consensus default: 3-set ramp at 40/60/80% of the top
 * working set × 5/5/3, anchored to the top set (`anchor` deliberately
 * omitted — see `WarmupScheme.anchor`).
 *
 * DERIVED, not restated: the ladder is the app-wide ramp owned by
 * `@hta/program-core` (`GLOBAL_WARMUP_PERCENTS` / `GLOBAL_WARMUP_REPS`,
 * the same constants `buildGlobalWarmupItems` and `@hta/wendler`'s
 * `TOP_SET_WARMUP` use), converted from fractions (0.4) to the percent
 * space this module works in (40). Plan §6.9 — one home for a derived
 * value; `__tests__/warmups.test.ts` pins the two in lockstep.
 *
 * Note this ramp is the APP's convention, not any external program's
 * published warm-up. A program that specifies its own ramp supplies it via
 * `program-warmup-scheme.ts` instead of inheriting this.
 */
export const DEFAULT_WARMUP_SCHEME: WarmupScheme = {
  setCount: GLOBAL_WARMUP_PERCENTS.length,
  percentLadder: GLOBAL_WARMUP_PERCENTS.map(fractionToPercent),
  repLadder: [...GLOBAL_WARMUP_REPS],
};

export type WarmupLoadOptions = {
  /** Empty-bar mass in kg. A non-positive value means no bar floor. */
  barWeightKg?: number;
  /**
   * Available plate weights in kg, one value per plate size. The inventory
   * represents plates loaded on both sides, so the smallest available plate
   * contributes twice its weight to the total-load increment.
   */
  availablePlateWeightsKg?: readonly number[];
};

/**
 * Resolve a generated warm-up target into a load the user can actually put
 * on a bar.
 *
 * Warm-up prescription items intentionally store `% TM`, because the planner
 * does not know a user's training-max kilograms at assembly time. The session
 * renderer calls this helper after multiplying by TM. It keeps a small lift's
 * first warm-up from becoming lighter than the empty bar and uses the user's
 * smallest configured plate pair as the rounding increment.
 */
export function roundWarmupLoadKg(
  rawKg: number,
  options: WarmupLoadOptions = {},
): number {
  if (!Number.isFinite(rawKg) || rawKg <= 0) return 0;

  const barWeightKg =
    typeof options.barWeightKg === "number" &&
    Number.isFinite(options.barWeightKg) &&
    options.barWeightKg > 0
      ? options.barWeightKg
      : 0;
  const plateWeights = (options.availablePlateWeightsKg ?? []).filter(
    (weight): weight is number =>
      typeof weight === "number" && Number.isFinite(weight) && weight > 0,
  );
  const smallestPlateKg = plateWeights.length > 0 ? Math.min(...plateWeights) : null;
  const incrementKg = smallestPlateKg != null ? smallestPlateKg * 2 : 2.5;
  const roundedKg = Math.round(rawKg / incrementKg) * incrementKg;

  // Keep floating-point noise out of persisted/logged loads.
  return Math.max(barWeightKg, Math.round(roundedKg * 100) / 100);
}

/**
 * True iff `scheme` is structurally consistent: setCount in [0..5] and
 * both ladders' lengths equal setCount. setCount === 0 still requires
 * empty ladders for the schema to be "well-formed".
 *
 * `anchor` is optional by contract: a payload stored before the field
 * existed is well-formed and means `"top_set"` (back-compat — every
 * `profiles.warmup_scheme` blob written to date has no anchor). Only an
 * anchor that is PRESENT and not a known value is rejected.
 */
export function isWellFormedScheme(scheme: unknown): scheme is WarmupScheme {
  if (!scheme || typeof scheme !== "object") return false;
  const s = scheme as Partial<WarmupScheme>;
  if (typeof s.setCount !== "number" || !Number.isFinite(s.setCount)) return false;
  if (!Number.isInteger(s.setCount) || s.setCount < 0 || s.setCount > 5) return false;
  if (!Array.isArray(s.percentLadder) || !Array.isArray(s.repLadder)) return false;
  if (s.percentLadder.length !== s.setCount) return false;
  if (s.repLadder.length !== s.setCount) return false;
  if (
    s.anchor !== undefined &&
    s.anchor !== "top_set" &&
    s.anchor !== "training_max"
  ) {
    return false;
  }
  if (!s.percentLadder.every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100)) {
    return false;
  }
  if (!s.repLadder.every((n) => typeof n === "number" && Number.isInteger(n) && n > 0 && n <= 20)) {
    return false;
  }
  return true;
}

/**
 * Detect the exact pre-40/60/80 default. This is deliberately narrower than
 * "any old-looking scheme": valid user-authored schemes must remain intact.
 */
export function isLegacyDefaultWarmupScheme(
  scheme: unknown,
): scheme is WarmupScheme {
  if (!isWellFormedScheme(scheme)) return false;
  return (
    scheme.setCount === LEGACY_DEFAULT_WARMUP_SCHEME.setCount &&
    scheme.percentLadder.every(
      (value, index) =>
        value === LEGACY_DEFAULT_WARMUP_SCHEME.percentLadder[index],
    ) &&
    scheme.repLadder.every(
      (value, index) => value === LEGACY_DEFAULT_WARMUP_SCHEME.repLadder[index],
    )
  );
}

/**
 * Normalise a possibly-NULL / possibly-malformed stored scheme into a
 * usable one. Falls back to DEFAULT_WARMUP_SCHEME on any structural issue,
 * and upgrades the exact 0039-era implicit default. Other valid schemes
 * preserve the user's intent.
 *
 * Read-boundary only: call it where a scheme is loaded out of
 * `profiles.warmup_scheme`, never inside generation. `generateWarmupItems`
 * stays faithful to whatever it is handed so an editor preview can show
 * the user's in-flight ladder verbatim.
 *
 * ⚠️ This function ERASES the difference between "user never chose" (NULL) and
 * "user explicitly chose the default ladder". Where that difference decides
 * whether a program's own ramp applies, use {@link resolveWarmupPreference}
 * instead — see its docs.
 */
export function resolveWarmupScheme(stored: unknown): WarmupScheme {
  if (stored == null) return DEFAULT_WARMUP_SCHEME;
  if (isLegacyDefaultWarmupScheme(stored)) return DEFAULT_WARMUP_SCHEME;
  if (!isWellFormedScheme(stored)) return DEFAULT_WARMUP_SCHEME;
  return stored;
}

/**
 * Whether the lifter has expressed a warm-up preference at all.
 *
 * - `"program"` — no usable preference stored. A program that publishes its own
 *   ramp (5/3/1) uses THAT ramp; everything else uses the app default.
 * - `"user"` — an explicit choice, which wins over a program's ramp everywhere,
 *   including `setCount: 0` ("skip warm-ups").
 */
export type WarmupPreference =
  | { mode: "program" }
  | { mode: "user"; scheme: WarmupScheme };

/**
 * Classify a RAW `profiles.warmup_scheme` value into a {@link WarmupPreference}.
 *
 * Pass the column value straight from the query — never the output of
 * {@link resolveWarmupScheme}, which has already collapsed NULL into the
 * default and destroyed the signal this function exists to read.
 *
 * - NULL ⇒ `"program"`. Migration 0039 added the column with no backfill and
 *   the settings editor is its only writer, so NULL provably means "this lifter
 *   has never touched the setting" rather than "chose the default".
 * - The exact 0039-era payload ⇒ `"user"` (upgraded to the current default).
 *   It could only have been written BY the settings editor, so it is a real
 *   choice even though it is no longer the default ladder.
 * - Malformed ⇒ `"program"`. An unreadable blob is not a preference; falling
 *   back to the program's own ramp is the conservative reading.
 */
export function resolveWarmupPreference(stored: unknown): WarmupPreference {
  if (stored == null) return { mode: "program" };
  if (isLegacyDefaultWarmupScheme(stored)) {
    return { mode: "user", scheme: DEFAULT_WARMUP_SCHEME };
  }
  if (!isWellFormedScheme(stored)) return { mode: "program" };
  return { mode: "user", scheme: stored };
}

/**
 * Convert an app-space {@link WarmupScheme} (percent 0..100) into the engine-space
 * {@link WarmupRamp} (fraction 0..1) that crosses the platform seam on
 * `PlatformContext.warmupRamp`. Single home for the conversion (plan §6.9),
 * the inverse direction of {@link fractionToPercent}.
 *
 * `setCount: 0` becomes an EMPTY ramp, which is how "skip warm-ups" reaches an
 * engine. The ladders are sliced to `setCount` so a scheme carrying trailing
 * junk beyond its own count cannot smuggle extra rungs into an engine.
 */
export function warmupSchemeToRamp(scheme: WarmupScheme): WarmupRamp {
  const count = Math.max(0, scheme.setCount);
  return {
    percents: scheme.percentLadder.slice(0, count).map((p) => p / 100),
    reps: scheme.repLadder.slice(0, count),
    anchor: warmupAnchorOf(scheme),
  };
}

/** Round to nearest 0.5%. */
function roundHalfPct(pct: number): number {
  return Math.round(pct * 2) / 2;
}

/**
 * Generate the warmup prescription items for one main lift.
 *
 * Faithful to the scheme it is handed: the only rewrite is the
 * structural fallback for a malformed scheme. It deliberately does NOT
 * call `resolveWarmupScheme` — that read-time legacy upgrade belongs to
 * the callers that load a scheme out of `profiles.warmup_scheme`
 * (`build-block-assembly-context`, `quick-generate-resolve`,
 * `planned-movement-actions`, `swap-actions`, the training settings
 * page). Keeping it out of here is what lets the warmup settings editor
 * preview exactly the ladder the user typed instead of an upgraded one.
 *
 * @param mainMovementId  Movement ID of the main lift (warmups share it).
 * @param topWorkingPercent  % TM of the heaviest planned working set
 *                           for this movement (0-100). For a `"top_set"`
 *                           scheme (the default) warmups are computed
 *                           relative to the TOP set, not each working set,
 *                           so a 65/75/85 wave gets one series of warmups
 *                           built off 85%. For a `"training_max"` scheme
 *                           the ladder is already in %TM and this argument
 *                           only gates that the movement HAS a working
 *                           anchor at all (a movement with no loaded work
 *                           gets no ramp either way).
 * @param scheme  User's warmup configuration. Callers reading a stored
 *                scheme pass it through `resolveWarmupScheme` first.
 * @param baseMeta  Optional movement metadata (slug, name) copied onto
 *                  each generated item so the renderer doesn't have to
 *                  cross-reference the catalog.
 */
export function generateWarmupItems(
  mainMovementId: string,
  topWorkingPercent: number,
  scheme: WarmupScheme,
  baseMeta?: { movementSlug?: string; movementName?: string },
): PrescriptionItem[] {
  const resolved = isWellFormedScheme(scheme) ? scheme : DEFAULT_WARMUP_SCHEME;
  if (resolved.setCount <= 0) return [];
  if (!Number.isFinite(topWorkingPercent) || topWorkingPercent <= 0) return [];

  // A TM-anchored ladder IS the %TM series (40 → 40% TM), so it does not
  // scale with the day's top set — the defining property of a fixed ramp.
  const tmAnchored = warmupAnchorOf(resolved) === "training_max";
  const items: PrescriptionItem[] = [];
  for (let i = 0; i < resolved.setCount; i++) {
    const rung = resolved.percentLadder[i]!;
    const pct = roundHalfPct(tmAnchored ? rung : (topWorkingPercent * rung) / 100);
    items.push({
      movementId: mainMovementId,
      movementSlug: baseMeta?.movementSlug,
      movementName: baseMeta?.movementName,
      kind: "warmup",
      sets: 1,
      reps: resolved.repLadder[i]!,
      percentTm: pct,
      intensityLabel: `${pct}% TM`,
    });
  }
  return items;
}
