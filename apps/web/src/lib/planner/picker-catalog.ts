/**
 * Canonical picker-catalog loader. The global movement catalog (with
 * role / region / muscle tags) is needed both by block generation
 * (`createBlock` in actions.ts) and by the mid-block limitation-response
 * path (ADR 0014), which derives limitation-safe swaps against the same
 * catalog. Centralised here so the projection and the
 * row→`CatalogMovement` mapping live in exactly one place.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogMovement } from "./accessory-picker";
import type { BulletproofRole, FunctionalRole } from "./accessory-roles";

export type DbMovement = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string;
  secondary_regions: string[] | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
  is_compound: boolean;
  body_weight_loaded: boolean;
  bulletproof_roles: string[] | null;
  functional_roles: string[] | null;
  is_supported: boolean;
  eccentric_load_score: number | null;
  stim_to_fatigue_score: number | null;
  high_strain_tendon: boolean;
  experience_min: number | null;
  experience_max: number | null;
  pattern: string;
  equipment: string | null;
};

/** Column projection for the picker catalog. */
export const CATALOG_SELECT =
  "id, slug, display_name, primary_region, secondary_regions, primary_muscles, secondary_muscles, is_compound, body_weight_loaded, bulletproof_roles, functional_roles, is_supported, eccentric_load_score, stim_to_fatigue_score, high_strain_tendon, experience_min, experience_max, pattern, equipment";

export function toCatalogMovement(m: DbMovement): CatalogMovement {
  return {
    id: m.id,
    slug: m.slug,
    displayName: m.display_name,
    primaryMuscles: m.primary_muscles ?? [],
    secondaryMuscles: m.secondary_muscles ?? [],
    primaryRegion: m.primary_region,
    secondaryRegions: m.secondary_regions ?? [],
    bulletproofRoles: (m.bulletproof_roles ?? []) as BulletproofRole[],
    functionalRoles: (m.functional_roles ?? []) as FunctionalRole[],
    isSupported: m.is_supported,
    isCompound: m.is_compound,
    isLoadable: m.body_weight_loaded,
    eccentricLoadScore: m.eccentric_load_score,
    stimToFatigueScore: m.stim_to_fatigue_score,
    highStrainTendon: m.high_strain_tendon,
    experienceMin: m.experience_min ?? 0,
    experienceMax: m.experience_max ?? 4,
    pattern: m.pattern,
    equipment: m.equipment,
  };
}

/** Load the full global catalog (user_id IS NULL) as CatalogMovements. */
export async function loadPickerCatalog(
  supabase: SupabaseClient,
): Promise<CatalogMovement[]> {
  const { data, error } = await supabase
    .from("movements")
    .select(CATALOG_SELECT)
    .is("user_id", null);
  if (error || !data) return [];
  return (data as DbMovement[]).map(toCatalogMovement);
}
