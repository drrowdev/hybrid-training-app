/**
 * ADR 0026 P4 — read-time antagonist-superset pairing.
 *
 * Pairing is a PRESENTATION layer applied at the prescription read seams,
 * AFTER the autoreg trim (ADR 0013) and modifications, gated by the user's
 * profile-level `superset_accessories` preference. The stored prescription and
 * the materialised set_logs never carry superset meta, which buys three
 * properties for free:
 *
 *   - pref OFF  -> `applySupersetPairing` returns the input UNCHANGED, so the
 *     whole legacy read path is byte-identical (the regression invariant).
 *   - pref ON   -> we pair what autoreg + modifications ALREADY kept, so the
 *     surviving item SET is identical to OFF — only the within-accessory order
 *     and `meta` differ, and the shown session time drops (P2 estimator).
 *   - the preference is LIVE: flipping it re-groups the current block on the
 *     next read, exactly like haptics / timer-sound, with no re-materialisation
 *     and no stale superset meta baked into old prescriptions.
 *
 * Applying AFTER the autoreg end-slice is load-bearing. `pairAntagonistAccessories`
 * pulls each A2 partner up next to its A1; pairing BEFORE the slice could pull a
 * low-priority A2 up into the kept window and push a different accessory into the
 * trimmed tail, changing WHICH items survive. After the slice the survivor set is
 * already fixed, so the regroup is purely cosmetic.
 */
import type { Muscle, Prescription } from "@hta/db";
import type { SupabaseClient } from "@supabase/supabase-js";
import { pairAntagonistAccessories } from "./antagonist-pairs";

/** Resolve a movement id to its catalog primary muscles (DB `muscle` enum). */
export type MovementMuscleResolver = (movementId: string) => readonly Muscle[];

/**
 * Annotate a prescription with antagonist-superset grouping when the user has
 * the preference ON. Pure: returns the input reference untouched when disabled
 * (byte-identical legacy path) and a fresh array when enabled.
 */
export function applySupersetPairing(
  prescription: Prescription,
  enabled: boolean,
  primaryMusclesOf: MovementMuscleResolver,
): Prescription {
  if (!enabled) return prescription;
  const items = prescription.items ?? [];
  if (items.length === 0) return prescription;
  const paired = pairAntagonistAccessories(items, (it) =>
    primaryMusclesOf(it.movementId),
  );
  return { ...prescription, items: paired };
}

/**
 * Load primary muscles for a set of movement ids through the user-scoped
 * (RLS-safe) Supabase client, so both the global catalog and the caller's own
 * custom movements resolve. Returns a id -> primary muscles map; ids that don't
 * resolve are simply absent (the pairing pass treats them as unclassifiable).
 *
 * Only the ids actually present in the prescription are fetched — never the
 * whole catalog — so this stays a single small `in (...)` query per read seam,
 * and a no-op (no query) when there are no items to resolve.
 */
export async function loadPrimaryMusclesByMovementId(
  supabase: SupabaseClient,
  movementIds: readonly string[],
): Promise<Map<string, Muscle[]>> {
  const ids = [...new Set(movementIds)].filter((id): id is string => !!id);
  const map = new Map<string, Muscle[]>();
  if (ids.length === 0) return map;
  const { data } = await supabase
    .from("movements")
    .select("id, primary_muscles")
    .in("id", ids);
  for (const row of (data ?? []) as {
    id: string;
    primary_muscles: string[] | null;
  }[]) {
    map.set(row.id, (row.primary_muscles ?? []) as Muscle[]);
  }
  return map;
}

/** Build a resolver from a preloaded id -> muscles map (empty list fallback). */
export function resolverFromMap(
  map: Map<string, Muscle[]>,
): MovementMuscleResolver {
  return (movementId: string) => map.get(movementId) ?? [];
}

/**
 * Read the caller's `superset_accessories` execution-style preference through
 * the user-scoped client. Defaults to false (feature off) when the row or
 * column is missing, so a fresh / partial profile stays on the byte-identical
 * legacy path.
 */
export async function getSupersetAccessoriesPref(
  supabase: SupabaseClient,
  userId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("profiles")
    .select("superset_accessories")
    .eq("id", userId)
    .maybeSingle();
  return (data as { superset_accessories?: boolean } | null)?.superset_accessories === true;
}
