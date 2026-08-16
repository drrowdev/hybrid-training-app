/**
 * Superset segmentation for the preview / plan accessory lists.
 *
 * A user-authored link (superset, tri-set, giant set) is realised by the engine
 * as `item.circuit` on each member, and the members are emitted adjacent. By the
 * time the rows reach the preview / plan renderers (one `PrescriptionMovementRow`
 * per movement, in prescription order) a link is therefore two or more
 * CONSECUTIVE rows sharing the same circuit id.
 *
 * This module is the pure, render-free segmentation: it folds a flat row list
 * into a sequence of solo rows and superset clusters so a renderer can wrap the
 * linked rows in a bracket. It is deliberately conservative:
 *
 *   - A cluster is only emitted when 2+ consecutive rows share the id. A lone
 *     row carrying a circuit (its partner dropped out of this week's session, or
 *     landed in a different render section) renders solo — never a half-bracket.
 *   - With no links authored, no row carries a circuit, so every segment is solo
 *     and the output is structurally identical to the un-segmented list.
 */
import type { PrescriptionMovementRow } from "./prescription-grouping";

export type SupersetRowSegment =
  | { kind: "solo"; row: PrescriptionMovementRow }
  | { kind: "superset"; groupId: string; rows: PrescriptionMovementRow[] };

/**
 * The circuit id carried by a row's items, or null when the row is not linked.
 * All items of a single movement share one id (a movement belongs to at most one
 * link), so the first tagged item wins.
 */
export function supersetGroupOfRow(row: PrescriptionMovementRow): string | null {
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

/** The human name of a row's link, when it has one. */
export function circuitNameOfRow(row: PrescriptionMovementRow): string | null {
  for (const it of row.items) {
    const c = it.circuit;
    if (c && typeof c.name === "string" && c.name.length > 0) return c.name;
  }
  return null;
}

/**
 * Fold a flat row list into solo rows + superset clusters.
 *
 * Pure and order-preserving: clusters consecutive rows that share a circuit id;
 * a single-row "cluster" degrades to a solo segment. When no row is linked,
 * returns one solo segment per row.
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
