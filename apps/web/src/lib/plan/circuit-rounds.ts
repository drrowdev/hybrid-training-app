/**
 * Folds an authored mixed circuit back into one block of stations.
 *
 * A circuit that contains cardio (ski erg, sled, run…) is stored with every
 * round expanded, each station carrying its own single-round circuit whose id is
 * `<partId>:<round>:<position>`. Rendered flat, a three-round circuit of six
 * stations reads as eighteen unrelated rows scattered across the Accessories and
 * Cardio sections. This module recognises that shape and returns the stations
 * once, with the round count, so a renderer can show one circuit.
 *
 * Strength-only circuits (giant sets) use a shared circuit id instead and are
 * handled by `superset-grouping`; they never match here.
 */
import type { PrescriptionItem } from "@hta/db";

export type RoundCircuit = {
  partId: string;
  name: string;
  rounds: number;
  /** One item per station, in the order the lifter performs them. */
  stations: PrescriptionItem[];
};

const EXPANDED_ROUND_ID = /^(.+):(\d+):(\d+)$/;

function expandedRound(item: PrescriptionItem) {
  const circuit = item.circuit;
  const partId = item.meta?.authoredPartId;
  if (!circuit || typeof partId !== "string" || circuit.id !== partId) return null;
  if (circuit.size !== 1 || circuit.rounds !== 1) return null;
  const match = EXPANDED_ROUND_ID.exec(partId);
  if (!match) return null;
  return {
    partId: match[1]!,
    round: Number(match[2]),
    position: Number(match[3]),
    name: circuit.name,
  };
}

export function extractRoundCircuits(items: readonly PrescriptionItem[]): {
  circuits: RoundCircuit[];
  rest: PrescriptionItem[];
} {
  const byPart = new Map<
    string,
    { name: string; rounds: Set<number>; stations: Map<number, { round: number; item: PrescriptionItem }> }
  >();
  const rest: PrescriptionItem[] = [];

  for (const item of items) {
    const found = expandedRound(item);
    if (!found) {
      rest.push(item);
      continue;
    }
    let part = byPart.get(found.partId);
    if (!part) {
      part = { name: found.name, rounds: new Set(), stations: new Map() };
      byPart.set(found.partId, part);
    }
    part.rounds.add(found.round);
    const current = part.stations.get(found.position);
    if (!current || found.round < current.round) {
      part.stations.set(found.position, { round: found.round, item });
    }
  }

  const circuits = [...byPart.entries()].map(([partId, part]) => ({
    partId,
    name: part.name,
    rounds: part.rounds.size,
    stations: [...part.stations.entries()].sort(([a], [b]) => a - b).map(([, entry]) => entry.item),
  }));
  return { circuits, rest };
}
