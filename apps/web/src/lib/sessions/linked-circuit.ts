import type { MovementGroup } from "./movement-grouping";

export type LinkedCircuitInfo = {
  id: string;
  name: string;
  position: number;
  size: number;
  rounds: number;
};

function requiredItemIndices(group: MovementGroup): number[] {
  return group.itemIndices.filter((_, slot) => !group.items[slot]?.optional);
}

function circuitInfo(group: MovementGroup): LinkedCircuitInfo | null {
  const circuit = group.items[0]?.circuit;
  if (
    !circuit ||
    !circuit.id ||
    !circuit.name ||
    !Number.isInteger(circuit.position) ||
    !Number.isInteger(circuit.size) ||
    !Number.isInteger(circuit.rounds) ||
    circuit.position < 0 ||
    circuit.size < 2 ||
    circuit.position >= circuit.size ||
    circuit.rounds < 1
  ) {
    return null;
  }
  return circuit;
}

/**
 * Returns circuit membership only when every declared movement is present with
 * one unique position and enough granular set slots for every round.
 */
export function buildLinkedCircuitByMovementId(
  groups: readonly MovementGroup[],
): ReadonlyMap<string, LinkedCircuitInfo> {
  const candidates = new Map<
    string,
    Array<{ group: MovementGroup; info: LinkedCircuitInfo }>
  >();
  for (const group of groups) {
    const info = circuitInfo(group);
    if (!info) continue;
    const entries = candidates.get(info.id) ?? [];
    entries.push({ group, info });
    candidates.set(info.id, entries);
  }

  const result = new Map<string, LinkedCircuitInfo>();
  for (const entries of candidates.values()) {
    const expected = entries[0]!.info;
    const ordered = [...entries].sort(
      (left, right) => left.info.position - right.info.position,
    );
    const complete =
      ordered.length === expected.size &&
      ordered.every(
        ({ group, info }, index) =>
          info.name === expected.name &&
          info.size === expected.size &&
          info.rounds === expected.rounds &&
          info.position === index &&
          requiredItemIndices(group).length >= expected.rounds,
      );
    if (!complete) continue;
    for (const { group, info } of ordered) {
      result.set(group.movementId, info);
    }
  }

  // Existing materialised TB3 sessions predate typed circuit metadata. They do
  // retain the engine note on all nine granular slots, so infer only the exact
  // legacy AB Triad shape: three movements, each 3×5, all explicitly labelled.
  const legacyPositions = new Map([
    ["hanging-leg-raise", 0],
    ["hanging-knee-raise", 1],
    ["toes-to-bar", 2],
  ]);
  const legacyAbTriad = groups
    .map((group) => ({
      group,
      position: group.movementSlug
        ? legacyPositions.get(group.movementSlug)
        : undefined,
    }))
    .filter(
      (
        entry,
      ): entry is { group: MovementGroup; position: number } =>
        entry.position != null &&
        !result.has(entry.group.movementId) &&
        requiredItemIndices(entry.group).length === 3 &&
        entry.group.items.every(
          (item) =>
            item.reps === 5 &&
            typeof item.notes === "string" &&
            /\bAB Triad\b/i.test(item.notes),
        ),
    );
  if (
    legacyAbTriad.length === 3 &&
    new Set(legacyAbTriad.map(({ position }) => position)).size === 3
  ) {
    legacyAbTriad.forEach(({ group, position }) => {
      result.set(group.movementId, {
        id: "tb-ab-triad",
        name: "AB Triad",
        position,
        size: 3,
        rounds: 3,
      });
    });
  }

  return result;
}

function orderedMembers(
  groups: readonly MovementGroup[],
  membership: ReadonlyMap<string, LinkedCircuitInfo>,
  circuitId: string,
): MovementGroup[] {
  return groups
    .filter(
      (group) => membership.get(group.movementId)?.id === circuitId,
    )
    .sort(
      (left, right) =>
        membership.get(left.movementId)!.position -
        membership.get(right.movementId)!.position,
    );
}

/** First open movement in round-major order (round 1 A→B→C, then round 2). */
export function firstOpenCircuitMovementId(
  circuitId: string,
  groups: readonly MovementGroup[],
  membership: ReadonlyMap<string, LinkedCircuitInfo>,
  coveredItemIndices: ReadonlySet<number>,
): string | null {
  const members = orderedMembers(groups, membership, circuitId);
  const rounds = members[0]
    ? membership.get(members[0].movementId)!.rounds
    : 0;
  for (let round = 0; round < rounds; round += 1) {
    for (const member of members) {
      const itemIndex = requiredItemIndices(member)[round];
      if (itemIndex != null && !coveredItemIndices.has(itemIndex)) {
        return member.movementId;
      }
    }
  }
  return null;
}

/** First open movement in workout order, treating a linked circuit as one unit. */
export function firstOpenMovementId(
  groups: readonly MovementGroup[],
  membership: ReadonlyMap<string, LinkedCircuitInfo>,
  coveredItemIndices: ReadonlySet<number>,
): string {
  const visitedCircuits = new Set<string>();
  for (const group of groups) {
    const info = membership.get(group.movementId);
    if (info) {
      if (visitedCircuits.has(info.id)) continue;
      visitedCircuits.add(info.id);
      const open = firstOpenCircuitMovementId(
        info.id,
        groups,
        membership,
        coveredItemIndices,
      );
      if (open) return open;
      continue;
    }
    if (
      requiredItemIndices(group).some(
        (index) => !coveredItemIndices.has(index),
      )
    ) {
      return group.movementId;
    }
  }
  return groups[0]?.movementId ?? "";
}

export function circuitMembersFor(
  movementId: string,
  groups: readonly MovementGroup[],
  membership: ReadonlyMap<string, LinkedCircuitInfo>,
): MovementGroup[] {
  const circuitId = membership.get(movementId)?.id;
  return circuitId ? orderedMembers(groups, membership, circuitId) : [];
}

export function circuitRoundFor(
  group: MovementGroup,
  info: LinkedCircuitInfo,
  coveredItemIndices: ReadonlySet<number>,
): number {
  const completed = requiredItemIndices(group).filter((index) =>
    coveredItemIndices.has(index),
  ).length;
  return Math.min(info.rounds, completed + 1);
}
