/**
 * PlatformContext builder — assembles the read-only shared state a program
 * engine needs (the user's canonical 1RMs + plate rounding) and the movement
 * resolver the adapter uses to turn engine keys back into the user's anchored
 * movements.
 *
 * The 1RM store is `training_maxes` (one_rm_kg per movement); each row is bucketed
 * to an engine key via its movement's StrengthRole. This is the single place the
 * platform reads a user's strength state — it is never mutated here.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PlatformContext } from "@hta/program-core";
import { engineKeyForSlug } from "./movement-keys";
import type { MovementResolver, ResolvedMovement } from "./adapter";

export interface PlatformContextBundle {
  ctx: PlatformContext;
  resolveMovement: MovementResolver;
  /** Engine keys that have a usable 1RM anchored (e.g. ["squat","bench","deadlift"]). */
  anchoredKeys: string[];
}

interface TmRow {
  one_rm_kg: string | number | null;
  movement: { id: string; slug: string; display_name: string } | null;
}

/**
 * Build the PlatformContext for a user from their training maxes. `roundingKg`
 * defaults to 2.5 kg (1.25 kg plates / pair) unless the user trains in pounds.
 */
export async function buildPlatformContext(
  supabase: Pick<SupabaseClient, "from">,
  userId: string,
  opts: { roundingKg?: number; gender?: "male" | "female" } = {},
): Promise<PlatformContextBundle> {
  const { data, error } = await supabase
    .from("training_maxes")
    .select("one_rm_kg, movement:movements(id, slug, display_name)")
    .eq("user_id", userId);
  if (error) throw new Error(`buildPlatformContext: ${error.message}`);

  const oneRepMaxes: Record<string, number> = {};
  const resolved = new Map<string, ResolvedMovement>();

  for (const row of (data ?? []) as unknown as TmRow[]) {
    const mv = row.movement;
    if (!mv) continue;
    const engineKey = engineKeyForSlug(mv.slug);
    if (!engineKey) continue;
    const oneRm = row.one_rm_kg == null ? NaN : Number(row.one_rm_kg);
    if (Number.isFinite(oneRm) && oneRm > 0) {
      oneRepMaxes[engineKey] = oneRm;
    }
    resolved.set(engineKey, { movementId: mv.id, slug: mv.slug, displayName: mv.display_name });
  }

  const resolveMovement: MovementResolver = (engineKey) => resolved.get(engineKey);

  return {
    ctx: {
      oneRepMaxes,
      roundingKg: opts.roundingKg ?? 2.5,
      ...(opts.gender ? { gender: opts.gender } : {}),
    },
    resolveMovement,
    anchoredKeys: Object.keys(oneRepMaxes),
  };
}
