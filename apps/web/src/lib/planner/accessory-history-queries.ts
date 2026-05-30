/**
 * ADR 0012 — previous-block accessory history for value-weighted rotation.
 *
 * Returns the set of accessory + power-primer movement ids the user was
 * prescribed in their **most recent (previous) block**, grouped by
 * day-role. The accessory picker demotes these for the next block (scaled
 * by movement value) so high-value compound staples persist while
 * redundant isolations rotate. See `accessory-picker.ts` (`candidateScore`)
 * and `docs/adr/0012-accessory-variation-value-bias.md`.
 *
 * Read-only and user-scoped: takes the RLS-respecting per-request Supabase
 * client and an explicit `user_id` predicate (defence in depth — never the
 * service-role client). Fails open to an empty map whenever history is
 * missing, so a user's first-ever block sees an empty recency set and the
 * picker stays byte-identical to its pre-ADR-0012 behaviour.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Prescription, PrescriptionItemKind } from "@hta/db";

/** Item kinds that come from the picker paths and should rotate per block. */
const ROTATABLE_KINDS: ReadonlySet<PrescriptionItemKind> = new Set([
  "accessory",
  "power_potentiation",
]);

type PlannedSessionRow = {
  role: string | null;
  prescription: unknown;
};

/**
 * Build a `Map<dayRole, Set<movementId>>` from the user's previous block.
 * The map is keyed by `planned_sessions.role`; rows with no role (e.g.
 * pure cardio days) are skipped since they carry no rotatable accessories.
 */
export async function getPreviousBlockAccessoryIdsByRole(
  supabase: SupabaseClient,
  userId: string,
): Promise<Map<string, Set<string>>> {
  const byRole = new Map<string, Set<string>>();

  // Most recent block for this user. At block-creation time this is the
  // block we're about to archive — i.e. the "previous" block relative to
  // the one being generated.
  const { data: blocks, error: blockErr } = await supabase
    .from("training_blocks")
    .select("id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1);
  if (blockErr || !blocks || blocks.length === 0) return byRole;

  const prevBlockId = (blocks[0] as { id: string }).id;

  const { data: rows, error: psErr } = await supabase
    .from("planned_sessions")
    .select("role, prescription")
    .eq("user_id", userId)
    .eq("block_id", prevBlockId);
  if (psErr || !rows) return byRole;

  for (const row of rows as PlannedSessionRow[]) {
    const role = row.role;
    if (!role) continue;
    const items = (row.prescription as Prescription | null)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (!ROTATABLE_KINDS.has(item.kind)) continue;
      if (!item.movementId) continue;
      let set = byRole.get(role);
      if (!set) {
        set = new Set<string>();
        byRole.set(role, set);
      }
      set.add(item.movementId);
    }
  }

  return byRole;
}
