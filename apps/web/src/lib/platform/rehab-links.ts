/**
 * Realise user-authored links across a REHAB protocol's prescription items.
 *
 * Rehab is linked separately from strength rather than through the engine's
 * `applySessionLinks`, because the two never meet: rehab items are built in
 * `materialize.ts` and PREPENDED into the day's strength prescription long
 * after the engine has emitted and linked the strength work.
 *
 * Three things here differ from the strength path, and each one is a bug that
 * would otherwise ship:
 *
 * ## 1. A station can span several items
 *
 * A protocol addresses sides as separate rows — "Copenhagen plank, left" and
 * "Copenhagen plank, right" are two `RehabDraft`s carrying one `movementId`.
 * The logger keys rehab cards as `rehab:<movementId>` with side deliberately
 * excluded, so those rows are ONE card. A link member is therefore a movement,
 * and its station is every item carrying that movement.
 *
 * That is why rounds are stamped here rather than left to the reader's legacy
 * fallback. `participatingItemIndices` falls back to "the first `rounds`
 * required slots of the group", which is right only when a station is one item
 * per round — true of the engine's AB Triad, false the moment a station holds
 * six items for three rounds. Unstamped, the rotation would take the three LEFT
 * sets and orphan every right-side set to solo work.
 *
 * ## 2. Circuit ids must not collide with the strength links in the same session
 *
 * `applySessionLinks` uses the stored link id verbatim, and ids are unique only
 * WITHIN a series — both editors mint `link-1`. Once rehab is embedded into a
 * strength prescription the logger groups circuit candidates globally by id, so
 * two unrelated `link-1`s would present four groups for a two-station circuit,
 * fail the completeness check, and silently drop BOTH circuits. The stored id
 * stays as authored; the materialised one is namespaced.
 *
 * ## 3. Members must end up contiguous
 *
 * The preview brackets consecutive rows sharing a circuit id, so a protocol
 * ordered A, solo, B linked as A+B would navigate as a circuit but render as
 * two unrelated rows. Members are re-emitted together at the earliest member's
 * position, exactly as the strength path does.
 *
 * Input items are expected to be EXPANDED (one set per item) — this counts
 * items, not `sets`.
 */
import type { PrescriptionItem } from "@hta/db";
import type { SessionLink } from "./session-links";

/** Series key under which a protocol's links are stored. */
export function rehabSeriesKey(protocolId: string): string {
  return `rehab.${protocolId}`;
}

/**
 * Circuit id as materialised. Namespaced by protocol so a rehab link can never
 * collide with a strength link embedded in the same session.
 */
export function rehabCircuitId(protocolId: string, linkId: string): string {
  return `rehab:${protocolId}:${linkId}`;
}

type Station = {
  /** Indices into `items`, in protocol order. Never empty. */
  indices: number[];
};

/**
 * Resolve one link against the items present, or `null` when it cannot be
 * realised. A link with any member absent is dropped WHOLE — never a
 * half-bracket (ADR 0071).
 */
function resolveStations(
  items: readonly PrescriptionItem[],
  link: SessionLink,
  claimed: ReadonlySet<number>,
): Station[] | null {
  const stations: Station[] = [];
  for (const member of link.members) {
    const indices: number[] = [];
    items.forEach((item, index) => {
      if (item.movementId === member && !claimed.has(index)) indices.push(index);
    });
    if (indices.length === 0) return null;
    stations.push({ indices });
  }
  // Two links sharing a movement is unrepresentable — `circuit` is singular.
  const seen = new Set<number>();
  for (const station of stations) {
    for (const index of station.indices) {
      if (seen.has(index)) return null;
      seen.add(index);
    }
  }
  return stations;
}

export function applyRehabLinks(
  items: readonly PrescriptionItem[],
  links: readonly SessionLink[],
  protocolId: string,
): PrescriptionItem[] {
  if (links.length === 0) return [...items];

  const claimed = new Set<number>();
  const resolved: { link: SessionLink; stations: Station[] }[] = [];
  for (const link of links) {
    const stations = resolveStations(items, link, claimed);
    if (!stations) continue;
    for (const station of stations) {
      for (const index of station.indices) claimed.add(index);
    }
    resolved.push({ link, stations });
  }
  if (resolved.length === 0) return [...items];

  const out = items.map((item) => ({ ...item }));

  for (const { link, stations } of resolved) {
    // A station's depth is how many sets it can contribute to the rotation.
    // `rounds` is the shallowest, so every station has a set for every round;
    // deeper stations keep their tail as ordinary solo work at full rest.
    const rounds = Math.min(...stations.map((station) => station.indices.length));
    if (rounds < 1) continue;
    stations.forEach((station, position) => {
      station.indices.forEach((itemIndex, depth) => {
        if (depth >= rounds) return;
        out[itemIndex]!.circuit = {
          id: rehabCircuitId(protocolId, link.id),
          name: link.name,
          position,
          size: stations.length,
          rounds,
          round: depth,
        };
      });
    });
  }

  // Re-emit each link's stations together at its earliest member's position,
  // every other item keeping its place.
  const anchorOf = new Map<number, number[]>();
  const absorbed = new Set<number>();
  for (const { stations } of resolved) {
    const ordered = stations.flatMap((station) => station.indices);
    const anchor = Math.min(...ordered);
    anchorOf.set(anchor, ordered);
    for (const index of ordered) {
      if (index !== anchor) absorbed.add(index);
    }
  }

  const emitted: PrescriptionItem[] = [];
  out.forEach((item, index) => {
    const group = anchorOf.get(index);
    if (group) {
      for (const memberIndex of group) emitted.push(out[memberIndex]!);
      return;
    }
    if (absorbed.has(index)) return;
    emitted.push(item);
  });
  return emitted;
}

/**
 * Movements a rehab protocol can offer for linking: one entry per DISTINCT
 * movement, since repeated rows for one movement are a single station.
 */
export function rehabLinkableMovements(
  items: readonly { movementId: string; movementName?: string }[],
): { key: string; label: string }[] {
  const byId = new Map<string, string>();
  for (const item of items) {
    if (!item.movementId) continue;
    if (!byId.has(item.movementId)) {
      byId.set(item.movementId, item.movementName ?? "Movement");
    }
  }
  return Array.from(byId, ([key, label]) => ({ key, label }));
}
