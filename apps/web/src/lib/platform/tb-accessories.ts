/**
 * Tactical Barbell OPTIONAL accessory work (ADR 0048).
 *
 * TB prescribes no accessories by default — and that's deliberate. This module
 * powers the *opt-in* path: when a user turns accessories on, it picks a small,
 * equipment- and limitation-filtered set of aesthetic movements targeting the
 * muscles big compounds under-serve (arms, delts, calves, abs, forearms), placed
 * after the main lifts.
 *
 * Unlike the 5/3/1 assistance resolver (mandatory push/pull/single-leg, strict
 * scope), TB accessories are muscle-driven, permissive (face-pulls / curls /
 * calf work are all welcome), volume-capped per template, and self-regulating.
 *
 * Pure: the caller loads the catalog / equipment / limitations and injects them.
 * Reuses the shared accessory-picker primitives (equipment + limitation filters)
 * rather than the full Hybrid `pickAccessoriesForSession`, whose durability /
 * functional / MEV floors are Hybrid science TB explicitly rejects.
 *
 * Source: Tactical Barbell (K. Black), "Accessory / Assistance Work" + Zulu
 * worked example: optional, after main lifts, 50-70% RM, higher reps, near
 * failure, kept minimal so it never compromises the main lifts.
 */
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import { loadsBlockedRegion, loadsBlockedMuscle } from "@/lib/planner/accessory-picker";
import { resolveRequiredEquipment, isEquipmentAvailable } from "@/lib/planner/equipment-requirements";
import type { Equipment } from "@/lib/settings/equipment-schema";
import type { PrescriptionItem } from "@hta/db";

/** The aesthetic / "indirect" muscles a TB user can target with optional accessories. */
export const TB_ACCESSORY_MUSCLES = [
  "biceps",
  "triceps",
  "front_delts",
  "side_delts",
  "rear_delts",
  "chest",
  "lats",
  "traps",
  "forearms",
  "abs",
  "obliques",
  "calves",
] as const;
export type TbAccessoryMuscle = (typeof TB_ACCESSORY_MUSCLES)[number];

/** Default emphasis when the user opts in without choosing muscles — the classic
 * "indirect" set (arms / shoulders / abs / calves) compounds miss. */
export const TB_DEFAULT_ACCESSORY_MUSCLES: TbAccessoryMuscle[] = [
  "biceps",
  "triceps",
  "side_delts",
  "abs",
  "calves",
];

// Conditioning / power / drill patterns are never accessory hypertrophy work.
const EXCLUDED_PATTERNS = new Set(["cardio", "olympic", "plyometric", "drill"]);

// CP-1 — TB accessory dose. Bodybuilder-style hypertrophy (8-15 reps, ~50-70% RM,
// near failure) per the book; the % isn't a TM prescription so it rides in a note.
const ACCESSORY_REPS = 12;
const ACCESSORY_REPS_NOTE = "After your main lifts \u00b7 8\u201315 reps \u00b7 ~50\u201370%, near failure";

/** Per-template gate + caps (CP-1). `null` = accessories not offered for this template. */
export interface TbAccessoryPlan {
  maxItems: number;
  setsPerItem: number;
}

/**
 * Template gating (ADR 0048). Zulu is the template the book designed to host
 * accessories; Operator/Fighter tolerate a minimum; the specialist templates
 * (Gladiator/Grey-Man) and Mass (which has its own accessory day) are excluded.
 */
export function tbAccessoryPlanForTemplate(templateId: string): TbAccessoryPlan | null {
  switch (templateId) {
    case "zulu":
    case "zulu-ia":
      return { maxItems: 3, setsPerItem: 3 };
    case "operator":
    case "fighter":
      return { maxItems: 2, setsPerItem: 3 };
    default:
      return null;
  }
}

/** Validate/normalise a requested muscle list to the allowlist; fall back to default. */
export function resolveTbAccessoryMuscles(requested: readonly string[] | undefined): TbAccessoryMuscle[] {
  const allow = new Set<string>(TB_ACCESSORY_MUSCLES);
  const picked = (requested ?? []).filter((m): m is TbAccessoryMuscle => allow.has(m));
  return picked.length > 0 ? picked : [...TB_DEFAULT_ACCESSORY_MUSCLES];
}

export interface TbAccessoryFilters {
  blockedRegions: Set<string>;
  blockedMuscles?: Set<string>;
  blockedMovementIds?: Set<string>;
  allowedMovementIds?: Set<string>;
}

export interface BuildTbAccessoryInjectorArgs {
  catalog: CatalogMovement[];
  equipment?: Equipment;
  filters: TbAccessoryFilters;
  /** Chosen aesthetic muscles (already allowlist-validated). */
  muscles: readonly string[];
  /** Hard cap on accessory items per session (template-dependent). */
  maxItems: number;
  /** Working sets per accessory item. */
  setsPerItem: number;
  /** Movement ids never to use (the user's anchored main lifts). */
  excludeMovementIds?: Set<string>;
}

/** Produce the accessory items for one session (keyed by engine ref for rotation). */
export type TbAccessoryInjector = (sessionRef: string) => PrescriptionItem[];

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
 * Pre-bucket the catalog by primary muscle (equipment + limitation + main-lift
 * filtered) and return an injector that hands out a small, rotating, duplicate-free
 * accessory set per session. Muscles are rotated session-to-session so when the cap
 * is smaller than the chosen-muscle count, every muscle still gets hit over time.
 */
export function buildTbAccessoryInjector(args: BuildTbAccessoryInjectorArgs): TbAccessoryInjector {
  const { catalog, equipment, filters, muscles, maxItems, setsPerItem, excludeMovementIds } = args;

  const byMuscle = new Map<string, CatalogMovement[]>();
  for (const mu of muscles) if (!byMuscle.has(mu)) byMuscle.set(mu, []);

  for (const m of catalog) {
    if (EXCLUDED_PATTERNS.has(m.pattern ?? "")) continue;
    if (excludeMovementIds?.has(m.id)) continue;
    if (filters.blockedMovementIds?.has(m.id)) continue;
    if (loadsBlockedRegion(m, filters.blockedRegions)) continue;
    if (loadsBlockedMuscle(m, filters.blockedMuscles, filters.allowedMovementIds)) continue;
    if (equipment && !isEquipmentAvailable(resolveRequiredEquipment(m), equipment)) continue;
    for (const mu of m.primaryMuscles) {
      if (byMuscle.has(mu)) byMuscle.get(mu)!.push(m);
    }
  }
  for (const arr of byMuscle.values()) arr.sort((a, b) => a.slug.localeCompare(b.slug));

  // Keep only muscles that actually have a candidate, in the user's chosen order.
  const liveMuscles = muscles.filter((mu) => (byMuscle.get(mu)?.length ?? 0) > 0);

  return (sessionRef) => {
    if (liveMuscles.length === 0 || maxItems <= 0) return [];
    const used = new Set<string>();
    const items: PrescriptionItem[] = [];
    const start = mixSeed(hashString(sessionRef)) % liveMuscles.length;
    for (let i = 0; i < liveMuscles.length && items.length < maxItems; i++) {
      const mu = liveMuscles[(start + i) % liveMuscles.length]!;
      const pool = byMuscle.get(mu)!;
      const fresh = pool.filter((m) => !used.has(m.id));
      const list = fresh.length > 0 ? fresh : pool;
      const pick = list[mixSeed(hashString(`${sessionRef}:${mu}`)) % list.length]!;
      if (used.has(pick.id)) continue;
      used.add(pick.id);
      items.push({
        movementId: pick.id,
        movementSlug: pick.slug,
        movementName: pick.displayName,
        kind: "accessory",
        sets: setsPerItem,
        reps: ACCESSORY_REPS,
        notes: ACCESSORY_REPS_NOTE,
      });
    }
    return items;
  };
}
