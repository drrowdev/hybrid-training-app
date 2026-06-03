/**
 * Superset card grouping for the live workout logger — ADR 0026 P5b.
 *
 * The logger (`/app/sessions/[id]`) renders one `MovementCard` per movement and
 * matches each logged set to its prescription item by the STORED
 * `prescription_item_index`. That index is positional, so the logger must NOT
 * reorder the underlying `prescription.items` array (P4's read-time pairing,
 * which pulls A2 up, is therefore deliberately NOT applied here — it would shift
 * indices and break set↔item matching).
 *
 * Instead we group at the CARD level: derive which accessory movements pair
 * (reusing the same pure classifier the rest of ADR 0026 uses, so the logger and
 * the preview/plan surfaces agree), then reorder and bracket the CARDS. Each card
 * keeps its own original `itemIndices`, so the index-based set matching is
 * untouched.
 */
import type { Muscle, Prescription } from "@hta/db";
import type { MovementGroup } from "./movement-grouping";
import {
  pairAntagonistAccessories,
  SUPERSET_GROUP_KEY,
  SUPERSET_SLOT_KEY,
  type SupersetSlot,
} from "@/lib/planner/antagonist-pairs";
import type { MovementMuscleResolver } from "@/lib/planner/superset-view";

export type SupersetCardInfo = { groupId: string; slot: SupersetSlot };

/**
 * Map movementId -> superset membership, derived from the UNPAIRED stored
 * prescription without mutating it. We run the pure pairing pass on the items
 * purely to read back its `meta` tags, then key by movementId. Only true pairs
 * (both members present, which the materialised session guarantees) yield
 * entries; unclassifiable / unmatched accessories are simply absent.
 */
export function buildSupersetByMovementId(
  prescription: Prescription | null,
  primaryMusclesOf: MovementMuscleResolver,
): Map<string, SupersetCardInfo> {
  const out = new Map<string, SupersetCardInfo>();
  const items = prescription?.items ?? [];
  if (items.length === 0) return out;
  const paired = pairAntagonistAccessories(items, (it) =>
    primaryMusclesOf(it.movementId),
  );
  for (const it of paired) {
    const g = it.meta?.[SUPERSET_GROUP_KEY];
    const s = it.meta?.[SUPERSET_SLOT_KEY];
    if (typeof g === "string" && g.length > 0 && (s === "A1" || s === "A2") && it.movementId) {
      out.set(it.movementId, { groupId: g, slot: s });
    }
  }
  return out;
}

/** Accessory movement ids present in a prescription (for the muscle prefetch). */
export function accessoryMovementIds(prescription: Prescription | null): string[] {
  const ids = new Set<string>();
  for (const it of prescription?.items ?? []) {
    if (it.kind === "accessory" && it.movementId) ids.add(it.movementId);
  }
  return [...ids];
}

export type MovementSupersetSegment =
  | { kind: "solo"; group: MovementGroup }
  | { kind: "superset"; groupId: string; groups: MovementGroup[] };

/**
 * Fold a list of accessory `MovementGroup`s into solo cards + superset clusters,
 * pulling each A2 partner up adjacent to its A1. Order-stable for solos: a pair
 * is emitted at the position of whichever member appears first.
 *
 * Conservative: a member whose partner is absent from the list (trimmed, or in a
 * different bucket) renders solo — never a half-bracket. With an empty membership
 * map every group is solo and the output order is identical to the input.
 */
export function segmentAccessoryGroups(
  groups: MovementGroup[],
  supersetByMovementId: ReadonlyMap<string, SupersetCardInfo>,
): MovementSupersetSegment[] {
  const consumed = new Set<string>();
  const out: MovementSupersetSegment[] = [];
  for (const g of groups) {
    if (consumed.has(g.movementId)) continue;
    const info = supersetByMovementId.get(g.movementId);
    if (!info) {
      out.push({ kind: "solo", group: g });
      continue;
    }
    let partner: MovementGroup | undefined;
    for (const other of groups) {
      if (other.movementId === g.movementId) continue;
      if (consumed.has(other.movementId)) continue;
      const oi = supersetByMovementId.get(other.movementId);
      if (oi && oi.groupId === info.groupId) {
        partner = other;
        break;
      }
    }
    if (!partner) {
      out.push({ kind: "solo", group: g });
      continue;
    }
    const a1 = info.slot === "A1" ? g : partner;
    const a2 = info.slot === "A1" ? partner : g;
    out.push({ kind: "superset", groupId: info.groupId, groups: [a1, a2] });
    consumed.add(g.movementId);
    consumed.add(partner.movementId);
  }
  return out;
}
