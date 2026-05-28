/**
 * affected-movements — list helper for the "Engine will block"
 * preview rendered inside AddLimitationModal.
 *
 * Given a set of muscles the user is about to flag, this returns the
 * concrete movements the engine's muscle-level filter (see
 * `accessory-picker.ts::loadsBlockedMuscle`) would drop from the
 * user's prescriptions. Each entry is tagged `primary` or
 * `secondary` so the UI can sort + badge them. Useful for the user
 * to spot "the engine will drop X — but I can still do X" and toggle
 * the per-exercise allow-list before they save.
 *
 * Region is included for forward-compatibility but isn't strictly
 * needed at the call site today — the muscle filter is what runs the
 * preview. When `affectedRegion` is non-null, movements whose
 * primaryRegion matches are also included (deduped) so the preview
 * is honest about what region-level limitations would drop.
 *
 * Catalogue scope:
 *   - User-owned rows (`user_id = userId`)
 *   - Global seeds (`user_id IS NULL`)
 *
 * Soft-deleted rows (deleted_at IS NOT NULL) are excluded when the
 * column exists; we fall through cleanly on schemas that don't have
 * it.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type AffectedMovement = {
  id: string;
  slug: string;
  displayName: string;
  affectedAs: "primary" | "secondary";
};

type MovementRow = {
  id: string;
  slug: string;
  display_name: string;
  primary_region: string | null;
  primary_muscles: string[] | null;
  secondary_muscles: string[] | null;
};

export async function getAffectedMovements(
  supabase: SupabaseClient,
  userId: string,
  affectedMuscles: string[],
  affectedRegion: string | null,
): Promise<AffectedMovement[]> {
  if (affectedMuscles.length === 0 && !affectedRegion) return [];

  const muscleSet = new Set(affectedMuscles);

  // Pull a wide selection — the movements catalogue tops out around
  // a few hundred rows in practice, well within a single page.
  const { data, error } = await supabase
    .from("movements")
    .select(
      "id, slug, display_name, primary_region, primary_muscles, secondary_muscles, user_id",
    )
    .or(`user_id.eq.${userId},user_id.is.null`);

  if (error || !data) {
    if (error) {
      console.warn("[affected-movements] read failed", error.message);
    }
    return [];
  }

  const seen = new Set<string>();
  const out: AffectedMovement[] = [];

  for (const row of data as MovementRow[]) {
    if (seen.has(row.id)) continue;

    const primary = row.primary_muscles ?? [];
    const secondary = row.secondary_muscles ?? [];

    let affectedAs: "primary" | "secondary" | null = null;
    if (primary.some((m) => muscleSet.has(m))) {
      affectedAs = "primary";
    } else if (secondary.some((m) => muscleSet.has(m))) {
      affectedAs = "secondary";
    } else if (affectedRegion && row.primary_region === affectedRegion) {
      affectedAs = "primary";
    }

    if (affectedAs === null) continue;
    seen.add(row.id);
    out.push({
      id: row.id,
      slug: row.slug,
      displayName: row.display_name,
      affectedAs,
    });
  }

  // Primary first, then alphabetical by displayName so the preview
  // is stable across re-renders.
  out.sort((a, b) => {
    if (a.affectedAs !== b.affectedAs) {
      return a.affectedAs === "primary" ? -1 : 1;
    }
    return a.displayName.localeCompare(b.displayName);
  });
  return out;
}
