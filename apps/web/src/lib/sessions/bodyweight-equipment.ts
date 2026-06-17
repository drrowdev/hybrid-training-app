/**
 * Whether a movement can be performed with NO external load — i.e. a 0 kg "pure
 * bodyweight" set is valid, so the logger must not demand a weight. Used (∪ the
 * `body_weight_loaded` flag) to decide whether the per-set logger requires a
 * weight before "Log set" is enabled.
 *
 * Rule (inverse of "requires load"): a movement needs an added-weight entry ONLY
 * when its catalog `equipment` denotes a LOAD-BEARING implement — a barbell,
 * dumbbell, kettlebell, EZ-bar, trap-bar, cable stack, plate, selectorized
 * machine, etc. Everything else — bodyweight, or an apparatus that carries no
 * inherent load (GHD, ab-wheel, pull-up bar, bench for a dragon flag, dip bars,
 * rings, bands, med-balls) — is bodyweight-capable, so 0 kg logs fine.
 *
 * This replaces the older "equipment contains a `bodyweight`/`bw` token" check,
 * which wrongly demanded a weight for apparatus movements like the GHD sit-up
 * (`ghd-machine`), dragon flag (`bench`) or hanging leg raise (`bar`).
 */

// Substrings that mark a load-bearing implement (you add external weight). Matched
// against the whole lowercased equipment string so multi-token tags resolve (e.g.
// `decline-bench-plate` → plate, `bench-dumbbells` → dumbbell, `ez-bar-bench` → ez-bar).
const LOAD_BEARING_TOKENS = [
  "barbell",
  "dumbbell",
  "kettlebell",
  "ez-bar",
  "trap-bar",
  "ssb",
  "cable",
  "plate",
  "landmine",
  "smith",
  "sandbag",
  "preacher",
  "machine",
  "t-bar",
];

export function isBodyweightCapableEquipment(equipment: string | null | undefined): boolean {
  // Unknown equipment: keep the conservative default of requiring a weight.
  if (!equipment) return false;
  const e = equipment.toLowerCase();
  const tokens = e.split(/[-_]/);
  // An explicit bodyweight option (`bodyweight`, `dumbbell-or-bw`, …) is always capable.
  if (tokens.includes("bodyweight") || tokens.includes("bw")) return true;
  // The GHD is an apparatus performed bodyweight despite carrying a `machine` tag.
  if (tokens.includes("ghd")) return true;
  // Otherwise it's bodyweight-capable iff no load-bearing implement is required.
  return !LOAD_BEARING_TOKENS.some((t) => e.includes(t));
}
