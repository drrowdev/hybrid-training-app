/**
 * ADR 0017 — DB→catalog adapter for cardio-modality substitution.
 *
 * The planner's main movement query (actions.ts) loads only the
 * archetype-referenced cardio slugs and without `metadata`, so it cannot
 * see alternate-modality movements. This module assembles the full cardio
 * catalog the resolver needs from raw movement rows, reusing the existing
 * single-source-of-truth classifiers (`classifyCardioKind` for intensity,
 * `normalizeCardioModality` for the modality vocabulary).
 *
 * Pure: the DB query lives in the caller; this only maps rows → entries.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

import { classifyCardioKind } from "@/lib/sessions/cardio-swap";

import {
  normalizeCardioModality,
  type CardioCatalogEntry,
} from "./preferred-cardio-modality";

/** Raw `movements` row shape needed to classify a cardio catalog entry. */
export type CardioCatalogRow = {
  id: string;
  slug: string;
  display_name: string;
  equipment: string | null;
  experience_min: number | null;
  metadata: Record<string, unknown> | null;
};

/**
 * A catalog entry plus the identity fields the planner needs to build the
 * prescription movement object when a substitution is chosen. The
 * resolver only reads the {@link CardioCatalogEntry} subset; the `id` /
 * `displayName` ride along for the caller's slug→movement lookup.
 */
export type CardioCatalogMovement = CardioCatalogEntry & {
  id: string;
  displayName: string;
};

/** Map raw cardio movement rows to classified catalog entries. */
export function buildCardioCatalog(
  rows: readonly CardioCatalogRow[],
): CardioCatalogMovement[] {
  return rows.map((row) => ({
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    modality: normalizeCardioModality(
      (row.metadata ?? {}).modality,
    ),
    cardioKind: classifyCardioKind(row.metadata),
    equipment: row.equipment,
    experienceMin: row.experience_min,
  }));
}

/** Column projection for the cardio catalog query. */
const CARDIO_CATALOG_SELECT =
  "id, slug, display_name, equipment, experience_min, metadata";

/**
 * Load the full global cardio catalog (every `pattern = 'cardio'`,
 * `user_id IS NULL` movement) as classified entries. Queried lazily — only
 * when the user has a non-empty modality preference — so the default
 * (running) path pays nothing. Returns [] on error, which makes the
 * resolver fall back to the archetype default.
 */
export async function loadCardioCatalog(
  supabase: SupabaseClient,
): Promise<CardioCatalogMovement[]> {
  const { data, error } = await supabase
    .from("movements")
    .select(CARDIO_CATALOG_SELECT)
    .eq("pattern", "cardio")
    .is("user_id", null);
  if (error || !data) return [];
  return buildCardioCatalog(data as CardioCatalogRow[]);
}
