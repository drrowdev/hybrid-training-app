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
import type { PrescriptionItem } from "@hta/db";
import type { PrescriptionMovementRow } from "./prescription-grouping";

export type SupersetRowSegment =
  | { kind: "solo"; row: PrescriptionMovementRow }
  | { kind: "superset"; groupId: string; rows: PrescriptionMovementRow[] };

/**
 * The circuit id carried by a set of items, or null when none is linked. All
 * items of a single movement share one id (a movement belongs to at most one
 * link), so the first tagged item wins.
 */
export function circuitIdOfItems(
  items: readonly PrescriptionItem[],
): string | null {
  for (const it of items) {
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

/** The human name of a set of items' link, when they have one. */
export function circuitNameOfItems(
  items: readonly PrescriptionItem[],
): string | null {
  for (const it of items) {
    const c = it.circuit;
    if (c && typeof c.name === "string" && c.name.length > 0) return c.name;
  }
  return null;
}

/**
 * Cluster consecutive entries that share a circuit id.
 *
 * Conservative: a cluster is only emitted when 2+ CONSECUTIVE entries share the
 * id. A lone entry carrying one (its partner dropped out of this week's session,
 * or landed in a different render section) stays solo — never a half-bracket.
 */
function clusterByCircuit<T>(
  entries: readonly T[],
  idOf: (entry: T) => string | null,
): { id: string | null; entries: T[] }[] {
  const out: { id: string | null; entries: T[] }[] = [];
  let i = 0;
  while (i < entries.length) {
    const id = idOf(entries[i]!);
    if (id === null) {
      out.push({ id: null, entries: [entries[i]!] });
      i += 1;
      continue;
    }
    const cluster: T[] = [entries[i]!];
    let j = i + 1;
    while (j < entries.length && idOf(entries[j]!) === id) {
      cluster.push(entries[j]!);
      j += 1;
    }
    out.push(cluster.length >= 2 ? { id, entries: cluster } : { id: null, entries: cluster });
    i = j;
  }
  return out;
}

export function supersetGroupOfRow(row: PrescriptionMovementRow): string | null {
  return circuitIdOfItems(row.items);
}

/** The human name of a row's link, when it has one. */
export function circuitNameOfRow(row: PrescriptionMovementRow): string | null {
  return circuitNameOfItems(row.items);
}

/**
 * Fold a flat row list into solo rows + superset clusters.
 *
 * Pure and order-preserving. When no row is linked, returns one solo segment
 * per row.
 */
export function segmentSupersetRows(
  rows: readonly PrescriptionMovementRow[],
): SupersetRowSegment[] {
  return clusterByCircuit(rows, supersetGroupOfRow).map((c) =>
    c.id === null
      ? ({ kind: "solo", row: c.entries[0]! } as const)
      : ({ kind: "superset", groupId: c.id, rows: c.entries } as const),
  );
}

/**
 * The circuit id carried by a movement section (warm-ups excluded — a warm-up
 * never joins the rotation, so only the working sets can name the link).
 */
export function supersetGroupOfSection(section: {
  sets: ReadonlyArray<{ item: PrescriptionItem }>;
}): string | null {
  return circuitIdOfItems(section.sets.map((s) => s.item));
}

/** The human name of a movement section's link, when it has one. */
export function circuitNameOfSection(section: {
  sets: ReadonlyArray<{ item: PrescriptionItem }>;
}): string | null {
  return circuitNameOfItems(section.sets.map((s) => s.item));
}

export type SupersetSectionSegment<T> =
  | { kind: "solo"; section: T }
  | { kind: "superset"; groupId: string; name: string | null; sections: T[] };

/**
 * Fold movement sections (main / supplemental cards) into solo cards + superset
 * clusters.
 *
 * The preview previously bracketed only ACCESSORY rows, because auto-pairing
 * could only ever produce accessory pairs. User-authored links span main and
 * supplemental lifts too, so those cards need the same treatment or a link the
 * lifter created is invisible on the surface they check before training.
 */
export function segmentSupersetSections<
  T extends { sets: ReadonlyArray<{ item: PrescriptionItem }> },
>(sections: readonly T[]): SupersetSectionSegment<T>[] {
  return clusterByCircuit(sections, supersetGroupOfSection).map((c) =>
    c.id === null
      ? ({ kind: "solo", section: c.entries[0]! } as const)
      : ({
          kind: "superset",
          groupId: c.id,
          name: circuitNameOfSection(c.entries[0]!),
          sections: c.entries,
        } as const),
  );
}
