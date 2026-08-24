/**
 * Which movements are anchored on a SYSTEM load — a 1RM that counts bodyweight
 * plus whatever hangs off the belt (weighted pull-ups, weighted dips).
 *
 * The catalog already records this as `movements.body_weight_loaded`, so both
 * newly generated plans AND plans materialised before the engine learned to
 * subtract bodyweight resolve correctly. A prescription item may also carry
 * `systemLoad` from the engine; either is sufficient.
 *
 * Reading it from the catalog rather than trusting only the stored item is what
 * lets an existing program stop prescribing 77 kg on a belt without the lifter
 * having to rebuild it.
 */
import type { PrescriptionItem } from "@hta/db";

type MinimalClient = { from: (table: string) => unknown };

type MovementIdQuery = {
  select: (columns: string) => {
    in: (
      column: string,
      values: string[],
    ) => PromiseLike<{ data: unknown; error: { message: string } | null }>;
  };
};

/**
 * The subset of `movementIds` whose maxes include bodyweight. Returns an empty
 * set for an empty input without touching the database.
 */
export async function loadSystemLoadMovementIds(
  supabase: MinimalClient,
  movementIds: string[],
): Promise<Set<string>> {
  const ids = [...new Set(movementIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return new Set();
  const { data, error } = await (supabase.from("movements") as MovementIdQuery)
    .select("id, body_weight_loaded")
    .in("id", ids);
  if (error) throw new Error(`loadSystemLoadMovementIds: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; body_weight_loaded?: boolean | null }>;
  return new Set(rows.filter((row) => row.body_weight_loaded === true).map((row) => row.id));
}

/** True when this item's percentage / target load is the added part of a system load. */
export function isSystemLoadItem(
  item: Pick<PrescriptionItem, "movementId" | "systemLoad">,
  systemLoadMovementIds: ReadonlySet<string>,
): boolean {
  return item.systemLoad === true || systemLoadMovementIds.has(item.movementId);
}
