/**
 * Deterministic accessory-role derivation.
 *
 * Source of truth for `movements.bulletproof_roles` + `functional_roles`,
 * derived from fields each movement already carries (pattern, bilateral,
 * metadata.protocol/tempo, experienceMin). Used by BOTH the seed (so every
 * row ships tagged and a reseed can't wipe the tags — see seeds/run.ts) and
 * the data migration that reconciles prod.
 *
 * Replaces the hand-maintained slug lists in 0019_tag_accessory_roles.sql,
 * which drifted out of sync with the catalog (its slugs no longer exist) and
 * were silently overwritten on every reseed — leaving prod with ZERO
 * durability-floor coverage. See docs: the durability floor (DC-O4) and the
 * archetype functional requirements both read these tags.
 *
 * Pure. No I/O. The seed's pre-set power_* functional roles are preserved.
 */

export type RoleDerivationInput = {
  slug: string;
  pattern: string;
  bilateral?: boolean | null;
  isCompound?: boolean | null;
  primaryRegion?: string | null;
  experienceMin?: number | null;
  functionalRoles?: readonly string[] | null;
  metadata?: Record<string, unknown> | null;
};

/** Main-lift variants excluded from `compound_assistance` (they ARE the lift). */
const MAIN_LIFTS = new Set([
  "back-squat-high-bar",
  "back-squat-low-bar",
  "front-squat",
  "bench-press-flat",
  "bench-press-incline",
  "conventional-deadlift",
  "sumo-deadlift",
  "trap-bar-deadlift",
  "ohp-standing",
  "ohp-seated",
  "push-press",
]);

const lc = (v: unknown): string => (typeof v === "string" ? v.toLowerCase() : "");

export function deriveAccessoryRoles(m: RoleDerivationInput): {
  bulletproofRoles: string[];
  functionalRoles: string[];
} {
  const meta = (m.metadata ?? {}) as Record<string, unknown>;
  const protocol = lc(meta.protocol);
  const tempo = lc(meta.tempo);
  const emphasis = lc(meta.emphasis);
  const proto = `${protocol} ${tempo} ${emphasis}`;
  // Hold detection excludes `emphasis` so a carry's "isometric-stabilisation"
  // emphasis doesn't mis-tag it as a heavy_isometric hold.
  const isoStr = `${protocol} ${tempo}`;
  const slug = m.slug.toLowerCase();
  const expMin = m.experienceMin ?? 0;

  const bulletproof = new Set<string>();
  // heavy_isometric — genuine time-under-tension holds.
  if (/isometric/.test(isoStr)) bulletproof.add("heavy_isometric");
  // hsr — heavy slow resistance (Kongsgaard) / 3 s eccentric tempo.
  if (/hsr|kongsgaard/.test(proto) || /^3-0-3|^3-0-x/.test(tempo)) bulletproof.add("hsr");
  // plyometric — jump-type stretch-shortening only (exclude med-ball throws).
  if (m.pattern === "plyometric" && !/med-ball|throw/.test(slug)) {
    bulletproof.add(expMin >= 3 ? "plyometric_high" : "plyometric_low");
  }
  // carry
  if (m.pattern === "carry") bulletproof.add("carry");
  // alfredson_eccentric — symptomatic eccentric protocols (not part of the floor).
  if (/alfredson|eccentric-only|strain-prevention/.test(proto) || slug.includes("eccentric")) {
    bulletproof.add("alfredson_eccentric");
  }

  const lowerUnilateral = m.bilateral === false && (m.pattern === "squat" || m.pattern === "hinge");
  const functional = new Set<string>();
  // single_leg — lower-body unilateral.
  if (lowerUnilateral) functional.add("single_leg");
  // anti_rotation — explicit anti-rotation, bird-dog, or unilateral upper-body / carry.
  if (
    /anti-rotation/.test(proto) ||
    slug === "bird-dog" ||
    (m.bilateral === false && (m.pattern === "press" || m.pattern === "pull" || m.pattern === "carry"))
  ) {
    functional.add("anti_rotation");
  }
  // anti_extension — trunk-brace work.
  if (
    m.primaryRegion === "lumbar_trunk" &&
    /plank|ab-wheel|dead-bug|hollow|hanging-|dragon-flag|toes-to-bar/.test(slug)
  ) {
    functional.add("anti_extension");
  }
  // loaded_mobility — deep-ROM loaded work.
  if (/loaded-mobility|spinal-flexion/.test(proto) || /jefferson|cossack|atg-split|deficit-rdl/.test(slug)) {
    functional.add("loaded_mobility");
  }
  // hip_stabilizer — frontal-plane hip (abduction/adduction/copenhagen).
  if (/abduction|adduction|copenhagen/.test(slug)) functional.add("hip_stabilizer");
  // ankle_foot — tibialis / calf / foot.
  if (m.primaryRegion === "foot_ankle_calf" && /tibialis|calf/.test(slug)) functional.add("ankle_foot");
  // compound_assistance — non-main compound strength variants.
  if (
    m.isCompound &&
    ["squat", "hinge", "press", "pull"].includes(m.pattern) &&
    !MAIN_LIFTS.has(slug)
  ) {
    functional.add("compound_assistance");
  }
  // velocity_cued — explosive loaded intent.
  if (/jump-squat|banded-jump|speed-/.test(slug)) functional.add("velocity_cued");
  // Preserve seed-set power roles.
  for (const r of m.functionalRoles ?? []) {
    if (r.startsWith("power_")) functional.add(r);
  }

  return {
    bulletproofRoles: [...bulletproof].sort(),
    functionalRoles: [...functional].sort(),
  };
}
