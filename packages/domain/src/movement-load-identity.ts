/**
 * What a saved max MEANS for a given movement.
 *
 * `movements.body_weight_loaded` cannot answer this. That column marks a
 * movement as bodyweight-CAPABLE — it can be logged at 0 kg, external load is
 * optional (lunges, step-ups, push-ups, inverted rows, dips, pull-ups). Reading
 * it as "this movement's 1RM includes bodyweight" prices a 70% forward-lunge
 * substitution at `70 − bodyweight` and hands an 80 kg lifter a 0 kg AMRAP
 * where the honest answer is 70 kg on the bar.
 *
 * Only two categories of movement have a max that is not an ordinary external
 * load, and both are enumerable:
 *
 *   - SYSTEM LOAD · the 1RM counts bodyweight PLUS whatever hangs off the belt,
 *     so a percentage of it names a TOTAL. Weighted pull-ups and weighted dips.
 *     See `addedLoadFromSystemLoad` for the conversion.
 *   - REP MAX · the saved number is MAX CLEAN REPS, not kilograms. It shares the
 *     `one_rm_kg` column, so nothing downstream may multiply it by a percentage
 *     or render it with a weight unit.
 *
 * Single home for both facts (plan §6.9). One table of `{ slug, engineKey }`
 * pairs so the catalog side and the engine side cannot drift apart.
 */

/** A movement named on both sides of the platform boundary. */
export interface MovementIdentity {
  /** Shared-catalog slug (`movements.slug`). */
  readonly slug: string;
  /** Engine movement key, as the program packages name it. */
  readonly engineKey: string;
}

/** Movements whose saved max counts bodyweight as well as added load. */
export const SYSTEM_LOAD_MOVEMENTS: readonly MovementIdentity[] = [
  { slug: "weighted-pull-up", engineKey: "weighted-pullup" },
  { slug: "weighted-dip", engineKey: "weighted-dip" },
];

/** Movements whose saved max is a rep count rather than a load. */
export const REP_MAX_MOVEMENTS: readonly MovementIdentity[] = [
  { slug: "pull-up-overhand", engineKey: "pullup" },
];

const SYSTEM_LOAD_SLUGS: ReadonlySet<string> = new Set(
  SYSTEM_LOAD_MOVEMENTS.map((m) => m.slug),
);
const SYSTEM_LOAD_KEYS: ReadonlySet<string> = new Set(
  SYSTEM_LOAD_MOVEMENTS.map((m) => m.engineKey),
);
const REP_MAX_SLUGS: ReadonlySet<string> = new Set(
  REP_MAX_MOVEMENTS.map((m) => m.slug),
);
const REP_MAX_KEYS: ReadonlySet<string> = new Set(
  REP_MAX_MOVEMENTS.map((m) => m.engineKey),
);

export const SYSTEM_LOAD_MOVEMENT_SLUGS = SYSTEM_LOAD_SLUGS;
export const SYSTEM_LOAD_ENGINE_KEYS = SYSTEM_LOAD_KEYS;
export const REP_MAX_MOVEMENT_SLUGS = REP_MAX_SLUGS;
export const REP_MAX_ENGINE_KEYS = REP_MAX_KEYS;

/** True when this catalog movement's saved max includes bodyweight. */
export function isSystemLoadMovementSlug(slug: string | null | undefined): boolean {
  return slug != null && SYSTEM_LOAD_SLUGS.has(slug);
}

/** True when this engine movement's anchor includes bodyweight. */
export function isSystemLoadEngineKey(key: string | null | undefined): boolean {
  return key != null && SYSTEM_LOAD_KEYS.has(key);
}

/** True when this catalog movement's saved max is a rep count, not kilograms. */
export function isRepMaxMovementSlug(slug: string | null | undefined): boolean {
  return slug != null && REP_MAX_SLUGS.has(slug);
}

/** True when this engine movement's anchor is a rep count, not kilograms. */
export function isRepMaxEngineKey(key: string | null | undefined): boolean {
  return key != null && REP_MAX_KEYS.has(key);
}
