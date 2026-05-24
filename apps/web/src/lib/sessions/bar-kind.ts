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
export type BarKind = "barbell" | "trap_bar";

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

export function resolveBarKind(movementSlug: string | null | undefined): BarKind | null {
  if (!movementSlug) return null;
  const slug = movementSlug.toLowerCase();
  for (const p of NON_BARBELL_PATTERNS) {
    if (slug.includes(p)) return null;
  }
  for (const p of TRAP_BAR_PATTERNS) {
    if (slug.includes(p)) return "trap_bar";
  }
  return "barbell";
}
