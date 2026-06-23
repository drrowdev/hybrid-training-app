/**
 * 5/3/1 assistance RESOLVER (ADR 0047, platform layer).
 *
 * The 5/3/1 engine emits per-session assistance INTENT — category-tagged slots
 * (push / pull / single-leg-or-core) with no concrete movement (see
 * `@hta/wendler` `assistance-spec.ts`). This module turns each intent into a real
 * catalog movement, filtered by the user's available equipment and active injury
 * limitations, with per-session rotation so the same category doesn't always land
 * on the identical movement.
 *
 * Pure: the caller loads the catalog / equipment / limitations and injects them.
 * No DB, no React.
 */
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import { loadsBlockedRegion, loadsBlockedMuscle } from "@/lib/planner/accessory-picker";
import { declaredExperienceToTier } from "@/lib/planner/experience-tier";
import { pickValueBiased } from "./foreign-accessory-ranking";
import type { DeclaredExperience } from "@hta/engine";
import { resolveRequiredEquipment, isEquipmentAvailable } from "@/lib/planner/equipment-requirements";
import type { Equipment } from "@/lib/settings/equipment-schema";
import type { ResolvedMovement } from "./adapter";

/**
 * Assistance slots a movement can be classified into. 5/3/1 emits the coarse
 * `single_leg_or_core` intent; HYROX emits granular slots so it can target the
 * race demands (vertical vs horizontal pull, overhead/explosive press, calf
 * prehab). The classifier returns ONE base slot per movement; the planner builds
 * the finer request pools (pull_vertical / pull_horizontal / push_overhead) as
 * sub-sets of pull / push.
 */
export type AssistanceSlot = "push" | "pull" | "single_leg" | "core" | "carry" | "prehab";

/**
 * What an `assistanceCategory` string on a prescription item may request.
 * `single_leg_or_core` (5/3/1) unions single_leg + core + carry + prehab. The
 * HYROX-specific `pull_vertical` / `pull_horizontal` / `push_overhead` are
 * sub-pools that fall back to the general pull / push pool when empty (so the
 * slot is never dropped for want of, e.g., a pull-up bar).
 */
export type AssistanceRequest =
  | AssistanceSlot
  | "single_leg_or_core"
  | "pull_vertical"
  | "pull_horizontal"
  | "push_overhead";

// Primary-muscle buckets used to classify ISOLATION movements, whose `pattern`
// alone ("isolation") doesn't say push vs pull. Compound presses/pulls are caught
// earlier by their `press` / `pull` pattern, so these only disambiguate isolations.
const PUSH_MUSCLES = new Set(["chest", "upper_chest", "triceps", "front_delts", "side_delts"]);
// A real "pull" slot must train the lats or biceps — back width/thickness or arm
// flexion. This is the single source of "what counts as pull": it keeps every row /
// pulldown / chin / pull-up / curl (all carry lats or biceps) while excluding
// rear-delt / scapular PREHAB (face pulls, band pull-aparts, Y-raises, rear-delt
// flies) and grip work, which Wendler treats as shoulder-health detail, not the
// primary pull assistance.
const PULL_MUSCLES = new Set(["lats", "biceps"]);
const CORE_MUSCLES = new Set(["abs", "obliques"]);

// Name keywords that mark a movement as single-leg even when its pattern is a
// bilateral squat/hinge (mirrors @hta/wendler categoryFromMovement).
const SINGLE_LEG_KEYWORDS = [
  "lunge",
  "split squat",
  "bulgarian",
  "step-up",
  "step up",
  "pistol",
  "single-leg",
  "single leg",
  "one-leg",
  "one leg",
  "skater",
  "shrimp squat",
];

// Patterns that are never hypertrophy assistance: conditioning, the Olympic /
// plyometric power family, movement drills, dedicated tendon-rehab and the
// rotator-cuff prehab bucket. Assistance draws from press / pull / squat / hinge /
// isolation / carry only.
const EXCLUDED_PATTERNS = new Set(["cardio", "olympic", "plyometric", "drill", "tendon", "cuff"]);

/**
 * Classify a catalog movement into the 5/3/1 assistance slot it best serves, or
 * `null` when it isn't suitable assistance.
 *
 * Order matters: a compound `pull` / `press` PATTERN wins first — a single-arm row
 * is a pull even though it carries the `anti_rotation` role, and a half-kneeling
 * landmine press is a push even though it loads the trunk. Pull additionally
 * requires real back/biceps involvement so rear-delt prehab doesn't qualify. Only
 * then do we test for single-leg / core, and finally disambiguate isolations.
 */
export function classifyAssistanceCandidate(m: CatalogMovement): AssistanceSlot | null {
  const pattern = m.pattern ?? "";
  if (EXCLUDED_PATTERNS.has(pattern)) return null;
  const name = m.displayName.toLowerCase();
  const roles = new Set<string>(m.functionalRoles as unknown as string[]);
  const primary = m.primaryMuscles;
  const trainsPull = primary.some((mu) => PULL_MUSCLES.has(mu));

  // Compound pattern wins — keeps unilateral rows/presses in the right slot. Pull
  // must train lats/biceps so rear-delt prehab (face pull, band pull-apart) is not
  // treated as primary pull assistance.
  if ((pattern === "pull" || roles.has("pull")) && trainsPull) return "pull";
  if (pattern === "press") return "push";

  // Loaded carry — its own slot (farmer / suitcase / overhead / Zercher). Checked
  // before single-leg/core so a suitcase carry's oblique loading doesn't pull it
  // into the core bucket. 5/3/1's coarse single_leg_or_core request unions the
  // carry pool back in, so carries stay available there too.
  if (pattern === "carry") return "carry";

  // Calf / Achilles isolation → PREHAB, never single-leg. A "Single-Leg Calf
  // Raise" matches the single-leg keyword but is a calf isolation, not a
  // single-leg STRENGTH movement; routing it to prehab keeps the single-leg slot
  // for real unilateral lower work. (5/3/1's single_leg_or_core unions prehab, so
  // its pool is unchanged.)
  if (m.primaryRegion === "foot_ankle_calf") return "prehab";

  // Single-leg: explicit role, or a name keyword that overrides a bilateral
  // squat/hinge pattern (lunge, split squat, step-up, pistol, single-leg RDL).
  if (roles.has("single_leg")) return "single_leg";
  if (SINGLE_LEG_KEYWORDS.some((kw) => name.includes(kw))) return "single_leg";

  // Core: anti-extension / lumbar-trunk / abs-oblique trunk work. `anti_rotation`
  // is intentionally NOT a trigger (it tags every unilateral press/pull/carry).
  if (roles.has("anti_extension")) return "core";
  if (m.primaryRegion === "lumbar_trunk") return "core";
  if (primary.some((mu) => CORE_MUSCLES.has(mu))) return "core";

  // Isolation disambiguation (compounds were already handled by pattern above).
  if (pattern === "isolation" && trainsPull) return "pull";
  if (pattern === "isolation" && primary.some((mu) => PUSH_MUSCLES.has(mu))) return "push";

  return null;
}

// Shoulder muscles that mark a press as OVERHEAD (vs a horizontal bench press,
// which is chest-driven). HYROX has no horizontal press in the race.
const OVERHEAD_PRESS_MUSCLES = new Set(["front_delts", "side_delts"]);
const OVERHEAD_PRESS_KEYWORDS = [
  "overhead",
  "push press",
  "push-press",
  "thruster",
  "jerk",
  "z-press",
  "z press",
  "military",
  "shoulder press",
  "landmine press",
  "ohp",
];

/** A vertical pull (pull-up / chin-up / pulldown) — overhead pulling pattern. */
export function isVerticalPull(m: CatalogMovement): boolean {
  const n = m.displayName.toLowerCase();
  return /pull-?up|chin-?up|pulldown|pull-?down|lat pull/.test(n);
}

/** A horizontal pull (any row). */
export function isHorizontalPull(m: CatalogMovement): boolean {
  return m.displayName.toLowerCase().includes("row");
}

/** An overhead / explosive press (shoulder-driven or a push-press/thruster/jerk) — NOT bench. */
export function isOverheadPress(m: CatalogMovement): boolean {
  const n = m.displayName.toLowerCase();
  if (OVERHEAD_PRESS_KEYWORDS.some((kw) => n.includes(kw))) return true;
  // Shoulder-primary press with no chest involvement = overhead.
  const primary = m.primaryMuscles;
  const isShoulder = primary.some((mu) => OVERHEAD_PRESS_MUSCLES.has(mu));
  const isChest = primary.some((mu) => mu === "chest" || mu === "upper_chest");
  return isShoulder && !isChest;
}

/** Limitation filters (a subset of the planner's LimitationsContext). */
export interface AssistanceCatalogFilters {
  blockedRegions: Set<string>;
  blockedMuscles?: Set<string>;
  blockedMovementIds?: Set<string>;
  allowedMovementIds?: Set<string>;
}

export interface BuildAssistancePlannerArgs {
  catalog: CatalogMovement[];
  equipment?: Equipment;
  filters: AssistanceCatalogFilters;
  /** Movement ids never to use as assistance (the user's anchored main lifts). */
  excludeMovementIds?: Set<string>;
  /**
   * Declared training experience (`profiles.training_experience`). Applies an
   * UNLOCK FLOOR only: a movement is dropped when the user's tier is BELOW its
   * `experienceMin` (beginners don't get skill/Olympic/plyo/advanced-unilateral
   * variants they can't yet perform). The upper band (`experienceMax`) is
   * deliberately IGNORED here — because this resolver is unranked (uniform
   * rotation), honouring it would STRIP staples from advanced athletes, which
   * the design forbids (experience-tier-foreign-programs-design.md §0/§3 Part B).
   * `null` → no gate (byte-identical to the pre-gate behaviour).
   */
  experience?: DeclaredExperience | null;
}

/** Resolve one assistance slot for a session. `slotIndex` keeps slots independent. */
export type SessionAssistanceResolver = (
  category: string,
  slotIndex: number,
) => ResolvedMovement | undefined;

/** Bind a per-session resolver (own `usedThisSession` state) keyed by engine ref. */
export type AssistancePlanner = (sessionRef: string) => SessionAssistanceResolver;

/**
 * Pre-filter the catalog into per-slot candidate pools (equipment + limitation +
 * main-lift filtered, classified by slot) and return a planner that hands out a
 * stable, rotating, duplicate-free pick per session.
 */
export function buildAssistancePlanner(args: BuildAssistancePlannerArgs): AssistancePlanner {
  const { catalog, equipment, filters, excludeMovementIds, experience } = args;

  // Unlock floor: drop a candidate only when the user's tier is BELOW its
  // `experienceMin`. `null` tier → no gate. Never honours `experienceMax`, so
  // no staple is ever stripped from an advanced athlete (design §3 Part B).
  const tier = declaredExperienceToTier(experience ?? null);

  const byCategory: Record<AssistanceSlot, CatalogMovement[]> = {
    push: [],
    pull: [],
    single_leg: [],
    core: [],
    carry: [],
    prehab: [],
  };

  for (const m of catalog) {
    if (excludeMovementIds?.has(m.id)) continue;
    if (filters.blockedMovementIds?.has(m.id)) continue;
    if (loadsBlockedRegion(m, filters.blockedRegions)) continue;
    if (loadsBlockedMuscle(m, filters.blockedMuscles, filters.allowedMovementIds)) continue;
    if (equipment && !isEquipmentAvailable(resolveRequiredEquipment(m), equipment)) continue;
    if (tier != null && tier < (m.experienceMin ?? 0)) continue;
    const slot = classifyAssistanceCandidate(m);
    if (slot) byCategory[slot].push(m);
  }
  // Deterministic ordering so rotation is reproducible across deploys.
  for (const key of Object.keys(byCategory) as AssistanceSlot[]) {
    byCategory[key].sort((a, b) => a.slug.localeCompare(b.slug));
  }
  // 5/3/1's coarse `single_leg_or_core` request draws from the union of the
  // granular pools (unilateral + core + carry + prehab) — the same breadth it had
  // before the slots were split (calves now live in `prehab` but stay in this
  // union), so 5/3/1 selection is unchanged. Sorted for determinism.
  const singleLegOrCore = [
    ...byCategory.single_leg,
    ...byCategory.core,
    ...byCategory.carry,
    ...byCategory.prehab,
  ].sort((a, b) => a.slug.localeCompare(b.slug));

  // HYROX sub-pools of pull / push (sorted; built from the already-filtered pools).
  const pullVertical = byCategory.pull.filter(isVerticalPull);
  const pullHorizontal = byCategory.pull.filter(isHorizontalPull);
  const pushOverhead = byCategory.push.filter(isOverheadPress);

  /**
   * Map an assistance REQUEST string to its candidate pool. The HYROX sub-pools
   * fall back to the general pull / push pool when empty (e.g. no pull-up bar),
   * so the slot is filled with the best available rather than dropped.
   */
  const poolFor = (category: string): CatalogMovement[] => {
    switch (category) {
      case "single_leg_or_core":
        return singleLegOrCore;
      case "pull_vertical":
        return pullVertical.length > 0 ? pullVertical : byCategory.pull;
      case "pull_horizontal":
        return pullHorizontal.length > 0 ? pullHorizontal : byCategory.pull;
      case "push_overhead":
        return pushOverhead.length > 0 ? pushOverhead : byCategory.push;
      default:
        return byCategory[category as AssistanceSlot] ?? [];
    }
  };

  return (sessionRef) => {
    const usedThisSession = new Set<string>();
    return (category, slotIndex) => {
      const pool = poolFor(category);
      if (!pool || pool.length === 0) return undefined;
      // Prefer movements not yet used this session; fall back to the full pool
      // when a small catalog can't fill every slot uniquely.
      const fresh = pool.filter((m) => !usedThisSession.has(m.id));
      const list = fresh.length > 0 ? fresh : pool;
      // F1 — staples-first selection (value-biased, with per-candidate jitter for
      // rotation). Selection only; sets/reps stay engine-owned (ADR 0047).
      const pick = pickValueBiased(list, `${sessionRef}:${category}:${slotIndex}`)!;
      usedThisSession.add(pick.id);
      return { movementId: pick.id, slug: pick.slug, displayName: pick.displayName };
    };
  };
}
