import {
  movementGroupKey,
  type MovementGroup,
} from "./movement-grouping";
import type { PrescriptionItem } from "@hta/db";

export type LinkedCircuitInfo = {
  id: string;
  name: string;
  position: number;
  size: number;
  rounds: number;
};

/**
 * Circuit membership and round-major navigation for the live logger.
 *
 * ## Why this is item-index based, not movement-group based
 *
 * A circuit is a per-SET fact, not a per-movement one. The original
 * implementation read `group.items[0].circuit` and treated the whole movement as
 * "in the circuit", which held only for the engine's AB Triad — three
 * accessories, three items each, no warm-ups, equal set counts. It breaks the
 * moment a user links arbitrary lifts:
 *
 *   - An anchored main lift's `items[0]` is a WARM-UP, which carries no circuit
 *     metadata, so the link was invisible and main-lift links silently did
 *     nothing.
 *   - Warm-ups counted as circuit progress, so round numbers were wrong.
 *   - Members with more sets than the group's round count had trailing sets that
 *     navigation never offered but completion still demanded, so the "Finish
 *     session" bar could never arm.
 *
 * So membership is resolved from the items that actually carry circuit metadata,
 * and every helper works in terms of PARTICIPATING item indices. Warm-ups, the
 * optional tail, and any required set beyond `rounds` fall back to ordinary solo
 * navigation and full rest.
 */

function requiredItemIndices(group: MovementGroup): number[] {
  return group.itemIndices.filter((_, slot) => !group.items[slot]?.optional);
}

function validCircuit(
  circuit: PrescriptionItem["circuit"],
): circuit is NonNullable<PrescriptionItem["circuit"]> {
  return (
    !!circuit &&
    !!circuit.id &&
    !!circuit.name &&
    Number.isInteger(circuit.position) &&
    Number.isInteger(circuit.size) &&
    Number.isInteger(circuit.rounds) &&
    circuit.position >= 0 &&
    circuit.size >= 2 &&
    circuit.position < circuit.size &&
    circuit.rounds >= 1
  );
}

/**
 * The circuit a group belongs to, read from the FIRST item that carries valid
 * metadata — deliberately not `items[0]`, which is a warm-up on any anchored
 * main lift.
 */
function circuitInfo(group: MovementGroup): LinkedCircuitInfo | null {
  for (const item of group.items) {
    if (validCircuit(item.circuit)) {
      const { id, name, position, size, rounds } = item.circuit;
      return { id, name, position, size, rounds };
    }
  }
  return null;
}

/**
 * Prescription item indices of this group that take part in the rotation, in
 * round order.
 *
 * Two resolution paths:
 *   1. Explicit — the platform adapter stamps `circuit.round` on each granular
 *      set as it expands a `sets > 1` engine item. Those slots participate, in
 *      round order, and nothing else does.
 *   2. Legacy — stored prescriptions predating the stamp (notably the engine's
 *      AB Triad) carry the circuit on every slot with no `round`. Fall back to
 *      the first `rounds` REQUIRED, non-warm-up slots, which reproduces the old
 *      behaviour exactly for those sessions while still excluding warm-ups.
 */
export function participatingItemIndices(
  group: MovementGroup,
  info: LinkedCircuitInfo,
): number[] {
  const stamped: { itemIndex: number; round: number }[] = [];
  group.items.forEach((item, slot) => {
    const itemIndex = group.itemIndices[slot];
    if (itemIndex == null) return;
    if (item.circuit?.id !== info.id) return;
    const round = item.circuit?.round;
    if (typeof round === "number" && Number.isInteger(round) && round >= 0) {
      stamped.push({ itemIndex, round });
    }
  });
  if (stamped.length > 0) {
    return stamped
      .sort((left, right) => left.round - right.round)
      .slice(0, info.rounds)
      .map((entry) => entry.itemIndex);
  }
  const eligible: number[] = [];
  group.items.forEach((item, slot) => {
    const itemIndex = group.itemIndices[slot];
    if (itemIndex == null) return;
    if (item.optional) return;
    if (item.kind === "warmup") return;
    eligible.push(itemIndex);
  });
  return eligible.slice(0, info.rounds);
}

/** True when this specific set is inside the rotation. */
export function isCircuitItemIndex(
  group: MovementGroup,
  info: LinkedCircuitInfo | undefined,
  itemIndex: number,
): boolean {
  if (!info) return false;
  return participatingItemIndices(group, info).includes(itemIndex);
}

/**
 * Required slots of this group that are NOT in the rotation — warm-ups and any
 * set beyond the group's round count. These are logged solo with full rest.
 */
export function soloItemIndices(
  group: MovementGroup,
  info: LinkedCircuitInfo | undefined,
): number[] {
  const required = requiredItemIndices(group);
  if (!info) return required;
  const inCircuit = new Set(participatingItemIndices(group, info));
  return required.filter((index) => !inCircuit.has(index));
}

/**
 * Returns circuit membership only when every declared movement is present with
 * one unique position and exactly enough participating slots for every round.
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
          participatingItemIndices(group, expected).length === expected.rounds,
      );
    if (!complete) continue;
    for (const { group, info } of ordered) {
      result.set(movementGroupKey(group), info);
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
        !result.has(movementGroupKey(entry.group)) &&
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
      result.set(movementGroupKey(group), {
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
      (group) => membership.get(movementGroupKey(group))?.id === circuitId,
    )
    .sort(
      (left, right) =>
        membership.get(movementGroupKey(left))!.position -
        membership.get(movementGroupKey(right))!.position,
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
    ? membership.get(movementGroupKey(members[0]))!.rounds
    : 0;
  for (let round = 0; round < rounds; round += 1) {
    for (const member of members) {
      const info = membership.get(movementGroupKey(member))!;
      const itemIndex = participatingItemIndices(member, info)[round];
      if (itemIndex != null && !coveredItemIndices.has(itemIndex)) {
        return movementGroupKey(member);
      }
    }
  }
  return null;
}

/**
 * First open movement in workout order, treating a linked circuit as one unit.
 *
 * Once a circuit's rounds are all covered its members are NOT skipped: any
 * remaining required slot outside the rotation (a warm-up, or a set beyond the
 * round count) is ordinary solo work and must still be offered, or completion
 * can never be reached and the Finish bar never arms.
 */
export function firstOpenMovementId(
  groups: readonly MovementGroup[],
  membership: ReadonlyMap<string, LinkedCircuitInfo>,
  coveredItemIndices: ReadonlySet<number>,
): string {
  const visitedCircuits = new Set<string>();
  for (const group of groups) {
    const info = membership.get(movementGroupKey(group));
    if (info && !visitedCircuits.has(info.id)) {
      visitedCircuits.add(info.id);
      const open = firstOpenCircuitMovementId(
        info.id,
        groups,
        membership,
        coveredItemIndices,
      );
      if (open) return open;
    }
    if (
      soloItemIndices(group, info).some(
        (index) => !coveredItemIndices.has(index),
      )
    ) {
      return movementGroupKey(group);
    }
  }
  return groups[0] ? movementGroupKey(groups[0]) : "";
}

export function circuitMembersFor(
  groupKey: string,
  groups: readonly MovementGroup[],
  membership: ReadonlyMap<string, LinkedCircuitInfo>,
): MovementGroup[] {
  const circuitId = membership.get(groupKey)?.id;
  return circuitId ? orderedMembers(groups, membership, circuitId) : [];
}

export function circuitRoundFor(
  group: MovementGroup,
  info: LinkedCircuitInfo,
  coveredItemIndices: ReadonlySet<number>,
): number {
  const completed = participatingItemIndices(group, info).filter((index) =>
    coveredItemIndices.has(index),
  ).length;
  return Math.min(info.rounds, completed + 1);
}

/**
 * The prescription item index this group will log next — the first uncovered
 * REQUIRED slot in display order.
 *
 * Display order matters: a linked main lift still warms up first, so the next
 * set is the warm-up even though the movement belongs to a circuit. Keying the
 * cue and the rest behaviour off this index is what stops a warm-up from being
 * treated as a circuit station. Mirrors `autoCursorForGroup`, which is what the
 * logger actually lands on.
 */
export function nextOpenItemIndex(
  group: MovementGroup,
  coveredItemIndices: ReadonlySet<number>,
): number | null {
  for (let slot = 0; slot < group.itemIndices.length; slot += 1) {
    if (group.items[slot]?.optional) continue;
    const index = group.itemIndices[slot];
    if (index != null && !coveredItemIndices.has(index)) return index;
  }
  return null;
}

/**
 * Whether saving the set at `itemIndex` should skip the rest timer.
 *
 * Only true inside the rotation, and only when another station follows in the
 * same round — you walk straight to it. The last movement of a round, and every
 * slot outside the rotation, rests normally.
 */
export function circuitSuppressesRest(
  group: MovementGroup,
  info: LinkedCircuitInfo | undefined,
  itemIndex: number | null,
): boolean {
  if (!info || itemIndex == null) return false;
  if (!isCircuitItemIndex(group, info, itemIndex)) return false;
  return info.position < info.size - 1;
}
