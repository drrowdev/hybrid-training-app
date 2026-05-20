/**
 * Training-max queries — used by Settings (list) and Log UI (lookup-by-movement).
 *
 * The "main lift" question is answered by data, not metadata: a movement is a
 * main lift for this user IFF they've set a TM for it. Default suggestions
 * (Back Squat / Bench / Deadlift / OHP) are surfaced in the Settings empty
 * state but never assumed.
 */
import { createClient } from "@/lib/supabase/server";

export type TmRow = {
  id: string;
  movementId: string;
  movementName: string;
  movementSlug: string;
  tmKg: number;
  updatedAt: string;
};

export async function listTrainingMaxes(): Promise<TmRow[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("training_maxes")
    .select("id, movement_id, tm_kg, updated_at, movements(display_name, slug)")
    .order("updated_at", { ascending: false });
  if (error || !data) return [];

  return data.map((r) => {
    const m = (r.movements ?? {}) as { display_name?: string; slug?: string };
    return {
      id: r.id,
      movementId: r.movement_id,
      movementName: m.display_name ?? "Unknown movement",
      movementSlug: m.slug ?? "",
      tmKg: Number(r.tm_kg),
      updatedAt: r.updated_at,
    };
  });
}

/** Slug-keyed dictionary so the Log UI can look up by either id or slug. */
export type TmDict = {
  byMovementId: Map<string, number>;
  bySlug: Map<string, number>;
};

export async function getTrainingMaxDict(): Promise<TmDict> {
  const rows = await listTrainingMaxes();
  const byMovementId = new Map<string, number>();
  const bySlug = new Map<string, number>();
  for (const r of rows) {
    byMovementId.set(r.movementId, r.tmKg);
    if (r.movementSlug) bySlug.set(r.movementSlug, r.tmKg);
  }
  return { byMovementId, bySlug };
}
