/**
 * Heuristic — does this movement use a loaded barbell, and which bar?
 *
 * The session logger uses this to decide whether to render the
 * plate-per-side breakdown next to the target weight, and which bar
 * mass (Olympic vs trap/hex) to subtract before the greedy plate
 * walk.
 *
 * We use a deny-list against the slug rather than a positive
 * whitelist: the catalog has hundreds of barbell movements but a
 * smaller, more contained set of non-bar implements. Slug match is
 * case-insensitive and tolerant of `_` / `-` separators.
 */
export type BarKind = "barbell" | "trap_bar" | "safety_bar";

const NON_BARBELL_PATTERNS = [
  "dumbbell",
  "db-",
  "kettlebell",
  "kb-",
  "machine",
  "cable",
  "band",
  "smith",
  "bodyweight",
  "pull-up",
  "pullup",
  "chin-up",
  "chinup",
  "dip-",
  "ring-",
  "sled",
  "landmine",
  "med-ball",
  "kb_",
  "db_",
] as const;

const TRAP_BAR_PATTERNS = ["trap_bar", "trap-bar", "hex_bar", "hex-bar"] as const;

/**
 * Safety-squat-bar tokens, mirroring the equipment-requirement heuristic's
 * `safety_squat` / `ssb` matching (`equipment-requirements.ts`). Anchored on a
 * separator rather than a bare "ssb" substring so an unrelated slug that merely
 * contains those letters can't be misread as a specialty bar.
 */
const SAFETY_BAR_PATTERNS = [
  "safety_squat",
  "safety-squat",
  "safety_bar",
  "safety-bar",
  "ssb-",
  "ssb_",
  "-ssb",
  "_ssb",
] as const;

export function resolveBarKind(movementSlug: string | null | undefined): BarKind | null {
  if (!movementSlug) return null;
  const slug = movementSlug.toLowerCase();
  for (const p of NON_BARBELL_PATTERNS) {
    if (slug.includes(p)) return null;
  }
  for (const p of TRAP_BAR_PATTERNS) {
    if (slug.includes(p)) return "trap_bar";
  }
  for (const p of SAFETY_BAR_PATTERNS) {
    if (slug.includes(p)) return "safety_bar";
  }
  return "barbell";
}

/** The bar half of `Equipment["bars"]`, tolerant of absent props. */
export type BarInventoryKg = {
  barbellKg?: number | null;
  trapBarKg?: number | null;
  safetyBarKg?: number | null;
};

/**
 * Single home (plan §6.9) for "what does the empty bar weigh for this
 * movement, given what the lifter owns?".
 *
 * Both the session renderer and the server-side plan materialisation
 * (`fillSessionFromPlan`) call this before `roundWarmupLoadKg`, so the
 * displayed warm-up load and the persisted `set_logs.weight_kg` can
 * never disagree about the bar floor.
 *
 * Returns `null` — meaning "no bar, so no bar floor and no plate
 * breakdown" — when either the movement isn't loaded on a bar or the
 * user doesn't own the bar it needs. `bars.barbellKg === 0`
 * (travel/hotel, bodyweight-only), `bars.trapBarKg === null`
 * (home/functional/custom) and `bars.safetyBarKg === null` are the
 * canonical "no such bar" signals — see `hasLoadableMainLift` /
 * `presetKeyForScheme` in `lib/settings/equipment-presets.ts`. Never
 * coerce them to a default bar mass at a call site: a safety-squat bar
 * is typically 25 kg against a 20 kg barbell, so substituting the
 * straight-bar mass mis-states every warm-up load and plate count for
 * the lift.
 */
export function resolveBarWeightKg(
  movementSlug: string | null | undefined,
  bars: BarInventoryKg | null | undefined,
): number | null {
  const barKind = resolveBarKind(movementSlug);
  if (barKind == null) return null;
  const weightKg =
    barKind === "trap_bar"
      ? bars?.trapBarKg
      : barKind === "safety_bar"
        ? bars?.safetyBarKg
        : bars?.barbellKg;
  if (typeof weightKg !== "number" || !Number.isFinite(weightKg) || weightKg <= 0) {
    return null;
  }
  return weightKg;
}
