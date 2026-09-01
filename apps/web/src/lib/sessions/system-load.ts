/**
 * Which movements are anchored on a SYSTEM load — a 1RM that counts bodyweight
 * plus whatever hangs off the belt (weighted pull-ups, weighted dips).
 *
 * The catalog's `body_weight_loaded` cannot answer this: it marks a movement as
 * bodyweight-CAPABLE, which is equally true of lunges, step-ups and push-ups.
 * Identity comes from the movement's slug instead (see `@hta/domain`).
 *
 * Reading it from the catalog rather than trusting only the stored item is what
 * lets an existing program stop prescribing 77 kg on a belt without the lifter
 * having to rebuild it — and, in the other direction, stops a plan materialised
 * under the old rule from subtracting bodyweight off an ordinary lift.
 */
import type { PrescriptionItem } from "@hta/db";
import { isSystemLoadMovementSlug } from "@hta/domain";

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
 * Whether each of `movementIds` is anchored on a system load. Movements absent
 * from the map were not resolvable in the catalog. Returns an empty map for an
 * empty input without touching the database.
 */
export async function loadSystemLoadMovementIds(
  supabase: MinimalClient,
  movementIds: string[],
): Promise<Map<string, boolean>> {
  const ids = [...new Set(movementIds.filter((id) => typeof id === "string" && id.length > 0))];
  if (ids.length === 0) return new Map();
  const { data, error } = await (supabase.from("movements") as MovementIdQuery)
    .select("id, slug")
    .in("id", ids);
  if (error) throw new Error(`loadSystemLoadMovementIds: ${error.message}`);
  const rows = (data ?? []) as Array<{ id: string; slug?: string | null }>;
  return new Map(rows.map((row) => [row.id, isSystemLoadMovementSlug(row.slug)]));
}

/**
 * True when this item's percentage / target load is the added part of a system
 * load.
 *
 * The catalog decides for any movement it knows, overriding the item's own
 * `systemLoad` marker: items materialised while `body_weight_loaded` stood in
 * for this question carry the marker on ordinary bodyweight-capable lifts, and
 * honouring it there subtracts bodyweight from a lunge. The stored marker is
 * only consulted for a movement the catalog could not resolve.
 */
export function isSystemLoadItem(
  item: Pick<PrescriptionItem, "movementId" | "systemLoad">,
  systemLoadByMovementId: ReadonlyMap<string, boolean>,
): boolean {
  const known = systemLoadByMovementId.get(item.movementId);
  if (known !== undefined) return known;
  return item.systemLoad === true;
}
