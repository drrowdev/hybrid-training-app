/**
 * Superset segmentation for the preview / plan accessory lists — ADR 0026 P5a.
 *
 * The read-time pairing pass (ADR 0026 P4, `lib/planner/superset-view.ts`) tags
 * paired accessory items with `meta.supersetGroup` / `meta.supersetSlot` and
 * pulls each A2 partner up to sit immediately after its A1. By the time the
 * accessory rows reach the preview / plan renderers (one `PrescriptionMovementRow`
 * per movement, in prescription order) a superset is therefore two CONSECUTIVE
 * rows that share the same `supersetGroup` id.
 *
 * This module is the pure, render-free segmentation: it folds a flat accessory
 * row list into a sequence of solo rows and superset clusters so a renderer can
 * wrap the paired rows in a "Superset" bracket. It is deliberately conservative:
 *
 *   - A cluster is only emitted as a superset when 2+ consecutive rows share the
 *     id. A lone row carrying a `supersetGroup` (its partner was trimmed by the
 *     ADR-0013 autoreg end-slice, or landed in a different render section like
 *     hinge-compensation) is a WIDOWED member and renders solo — never as a
 *     half-bracket. This is the widowed-fallback the ADR requires.
 *   - With the preference off, no row carries a `supersetGroup`, so every segment
 *     is solo and the output is structurally identical to the un-segmented list.
 */
import type { PrescriptionMovementRow } from "./prescription-grouping";
import { SUPERSET_GROUP_KEY, SUPERSET_SLOT_KEY, type SupersetSlot } from "@/lib/planner/antagonist-pairs";

export type SupersetRowSegment =
  | { kind: "solo"; row: PrescriptionMovementRow }
  | { kind: "superset"; groupId: string; rows: PrescriptionMovementRow[] };

/**
 * The superset group id carried by a row's items, or null when the row is not
 * part of a superset. All items of a single accessory movement share one group
 * id (a movement is either the A1 or the A2 of one pair), so the first tagged
 * item wins.
 *
 * Falls back to a linked-circuit id: user-authored links (supersets, tri-sets,
 * giant sets) are expressed as `item.circuit`, not `meta.supersetGroup`, and
 * must bracket in exactly the same way.
 */
export function supersetGroupOfRow(row: PrescriptionMovementRow): string | null {
  for (const it of row.items) {
    const g = it.meta?.[SUPERSET_GROUP_KEY];
    if (typeof g === "string" && g.length > 0) return g;
  }
  for (const it of row.items) {
    const c = it.circuit;
    if (
      c &&
      typeof c.id === "string" &&
      c.id.length > 0 &&
      Number.isInteger(c.size) &&
      c.size >= 2
    ) {
      return c.id;
    }
  }
  return null;
}

/** The human name of a row's linked circuit, when it has one. */
export function circuitNameOfRow(row: PrescriptionMovementRow): string | null {
  for (const it of row.items) {
    const c = it.circuit;
    if (c && typeof c.name === "string" && c.name.length > 0) return c.name;
  }
  return null;
}

/** The A1 / A2 slot carried by a row's items, or null when unpaired. */
export function supersetSlotOfRow(row: PrescriptionMovementRow): SupersetSlot | null {
  for (const it of row.items) {
    const s = it.meta?.[SUPERSET_SLOT_KEY];
    if (s === "A1" || s === "A2") return s;
  }
  return null;
}

/**
 * Fold a flat accessory row list into solo rows + superset clusters.
 *
 * Pure and order-preserving: clusters consecutive rows that share a
 * `supersetGroup` id; a single-row "cluster" degrades to a solo segment
 * (widowed fallback). When no row is tagged, returns one solo segment per row.
 */
export function segmentSupersetRows(
  rows: readonly PrescriptionMovementRow[],
): SupersetRowSegment[] {
  const out: SupersetRowSegment[] = [];
  let i = 0;
  while (i < rows.length) {
    const g = supersetGroupOfRow(rows[i]);
    if (g === null) {
      out.push({ kind: "solo", row: rows[i] });
      i += 1;
      continue;
    }
    const cluster: PrescriptionMovementRow[] = [rows[i]];
    let j = i + 1;
    while (j < rows.length && supersetGroupOfRow(rows[j]) === g) {
      cluster.push(rows[j]);
      j += 1;
    }
    if (cluster.length >= 2) {
      out.push({ kind: "superset", groupId: g, rows: cluster });
    } else {
      out.push({ kind: "solo", row: cluster[0] });
    }
    i = j;
  }
  return out;
}
