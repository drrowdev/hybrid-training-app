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
import { resolveRequiredEquipment, isEquipmentAvailable } from "@/lib/planner/equipment-requirements";
import type { Equipment } from "@/lib/settings/equipment-schema";
import type { ResolvedMovement } from "./adapter";

/** The three 5/3/1 assistance slots the engine emits (matches `assistanceCategory`). */
export type AssistanceSlot = "push" | "pull" | "single_leg_or_core";

// Primary-muscle buckets used to classify ISOLATION movements, whose `pattern`
// alone ("isolation") doesn't say push vs pull. Compound presses/pulls are caught
// earlier by their `press` / `pull` pattern, so these only disambiguate isolations.
const PUSH_MUSCLES = new Set(["chest", "upper_chest", "triceps", "front_delts", "side_delts"]);
const PULL_MUSCLES = new Set(["lats", "mid_back", "traps", "biceps", "rear_delts", "forearms"]);
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
 * `null` when it isn't suitable assistance. Single-leg/core is tested first (most
 * specific), then pull, then push.
 */
export function classifyAssistanceCandidate(m: CatalogMovement): AssistanceSlot | null {
  const pattern = m.pattern ?? "";
  if (EXCLUDED_PATTERNS.has(pattern)) return null;
  const name = m.displayName.toLowerCase();
  const roles = new Set<string>(m.functionalRoles as unknown as string[]);
  const primary = m.primaryMuscles;

  // Single-leg or core (most specific).
  if (roles.has("single_leg") || roles.has("anti_extension") || roles.has("anti_rotation")) {
    return "single_leg_or_core";
  }
  if (m.primaryRegion === "lumbar_trunk") return "single_leg_or_core";
  if (primary.some((mu) => CORE_MUSCLES.has(mu))) return "single_leg_or_core";
  if (SINGLE_LEG_KEYWORDS.some((kw) => name.includes(kw))) return "single_leg_or_core";

  // Pull (back / biceps / rear delts).
  if (pattern === "pull" || roles.has("pull")) return "pull";
  if (pattern === "isolation" && primary.some((mu) => PULL_MUSCLES.has(mu))) return "pull";

  // Push (chest / shoulders / triceps).
  if (pattern === "press") return "push";
  if (pattern === "isolation" && primary.some((mu) => PUSH_MUSCLES.has(mu))) return "push";

  return null;
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
}

/** Resolve one assistance slot for a session. `slotIndex` keeps slots independent. */
export type SessionAssistanceResolver = (
  category: string,
  slotIndex: number,
) => ResolvedMovement | undefined;

/** Bind a per-session resolver (own `usedThisSession` state) keyed by engine ref. */
export type AssistancePlanner = (sessionRef: string) => SessionAssistanceResolver;

// Integer bit-mix (mirrors accessory-picker `mixSeed`) for stable rotation.
function mixSeed(seed: number): number {
  let x = seed | 0;
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = Math.imul(x ^ (x >>> 16), 0x45d9f3b);
  x = x ^ (x >>> 16);
  return x < 0 ? x + 0x100000000 : x;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * Pre-filter the catalog into per-slot candidate pools (equipment + limitation +
 * main-lift filtered, classified by slot) and return a planner that hands out a
 * stable, rotating, duplicate-free pick per session.
 */
export function buildAssistancePlanner(args: BuildAssistancePlannerArgs): AssistancePlanner {
  const { catalog, equipment, filters, excludeMovementIds } = args;

  const byCategory: Record<AssistanceSlot, CatalogMovement[]> = {
    push: [],
    pull: [],
    single_leg_or_core: [],
  };

  for (const m of catalog) {
    if (excludeMovementIds?.has(m.id)) continue;
    if (filters.blockedMovementIds?.has(m.id)) continue;
    if (loadsBlockedRegion(m, filters.blockedRegions)) continue;
    if (loadsBlockedMuscle(m, filters.blockedMuscles, filters.allowedMovementIds)) continue;
    if (equipment && !isEquipmentAvailable(resolveRequiredEquipment(m), equipment)) continue;
    const slot = classifyAssistanceCandidate(m);
    if (slot) byCategory[slot].push(m);
  }
  // Deterministic ordering so rotation is reproducible across deploys.
  for (const key of Object.keys(byCategory) as AssistanceSlot[]) {
    byCategory[key].sort((a, b) => a.slug.localeCompare(b.slug));
  }

  return (sessionRef) => {
    const usedThisSession = new Set<string>();
    return (category, slotIndex) => {
      const pool = byCategory[category as AssistanceSlot];
      if (!pool || pool.length === 0) return undefined;
      // Prefer movements not yet used this session; fall back to the full pool
      // when a small catalog can't fill every slot uniquely.
      const fresh = pool.filter((m) => !usedThisSession.has(m.id));
      const list = fresh.length > 0 ? fresh : pool;
      const idx = mixSeed(hashString(`${sessionRef}:${category}:${slotIndex}`)) % list.length;
      const pick = list[idx]!;
      usedThisSession.add(pick.id);
      return { movementId: pick.id, slug: pick.slug, displayName: pick.displayName };
    };
  };
}
