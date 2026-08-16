/**
 * Pure editing logic for the session-link editor.
 *
 * Kept out of the component so it can be tested directly — the web test
 * environment is Node with no DOM, so components are only ever statically
 * rendered and interaction behaviour has to live somewhere it can be exercised.
 */
import {
  MAX_LINK_MEMBERS,
  MAX_LINKS_PER_SERIES,
  defaultLinkName,
  type SessionLink,
} from "@/lib/platform/session-links";

export interface LinkableMovement {
  /** Canonical slot identity — must match the engine's `sourceMovement ?? movement`. */
  key: string;
  label: string;
  /** Main lifts warn when linked (DC-K4 — override and warn, never block). */
  isMain?: boolean;
  /** Already part of a built-in circuit (the AB Triad); cannot be linked. */
  lockedReason?: string;
  /**
   * Canonical slots this entry contributes when linked, when it stands for a
   * GROUP rather than a single lift.
   *
   * The AB Triad is one engine-owned circuit of three movements. Supersetting a
   * lift "with the AB Triad" is really a four-station circuit, so the triad is
   * offered as one row that expands to its three slots — you pick the triad, not
   * its parts. Absent ⇒ the entry contributes just its own `key`.
   */
  expandsTo?: readonly string[];
}

/** The canonical slots an entry contributes to a link. */
export function slotsOf(movement: LinkableMovement): readonly string[] {
  return movement.expandsTo && movement.expandsTo.length > 0
    ? movement.expandsTo
    : [movement.key];
}

/** Every movement already claimed by a link in this slot. */
export function linkedKeys(links: readonly SessionLink[]): Set<string> {
  return new Set(links.flatMap((link) => link.members));
}

/**
 * Movements the user may still pick: not locked by a built-in circuit, and not
 * already inside another link — a prescription item carries at most one circuit,
 * so a movement can belong to a single link only. A group entry (the AB Triad)
 * is withheld once ANY of its slots is claimed.
 */
export function selectableMovements(
  movements: readonly LinkableMovement[],
  links: readonly SessionLink[],
): LinkableMovement[] {
  const claimed = linkedKeys(links);
  return movements.filter(
    (m) => !m.lockedReason && !slotsOf(m).some((slot) => claimed.has(slot)),
  );
}

/** The first free `link-N` id for this slot. */
export function nextLinkId(links: readonly SessionLink[]): string {
  const taken = new Set(links.map((link) => link.id));
  let n = links.length + 1;
  while (taken.has(`link-${n}`)) n += 1;
  return `link-${n}`;
}

/**
 * True when the selection can become a link.
 *
 * `movements` is required, not optional: the size that matters is the number of
 * SLOTS the selection expands to, and a group entry (the AB Triad) contributes
 * three. Defaulting it would silently answer "no" for every valid selection.
 */
export function canCreateLink(
  selected: readonly string[],
  links: readonly SessionLink[],
  movements: readonly LinkableMovement[],
): boolean {
  const size = expandSelection(movements, selected).length;
  return (
    selected.length >= 2 &&
    size >= 2 &&
    size <= MAX_LINK_MEMBERS &&
    links.length < MAX_LINKS_PER_SERIES
  );
}

/**
 * The canonical slots a selection contributes, in SLOT order, with group
 * entries (the AB Triad) expanded to their members.
 */
export function expandSelection(
  movements: readonly LinkableMovement[],
  selected: readonly string[],
): string[] {
  const out: string[] = [];
  for (const m of movements) {
    if (!selected.includes(m.key) || m.lockedReason) continue;
    for (const slot of slotsOf(m)) {
      if (!out.includes(slot)) out.push(slot);
    }
  }
  return out;
}

/**
 * Add a link for the current selection.
 *
 * Members are stored in SLOT order rather than click order, so the link reads
 * the way the session is written and the engine's positions line up with how the
 * lifter sees the session. A group entry contributes all of its slots, so
 * "back extension + AB Triad" becomes a four-station circuit. Returns the input
 * unchanged when the selection can't form a link.
 */
export function addLink(
  links: readonly SessionLink[],
  movements: readonly LinkableMovement[],
  selected: readonly string[],
): SessionLink[] {
  if (!canCreateLink(selected, links, movements)) return [...links];
  const members = expandSelection(movements, selected);
  if (members.length < 2) return [...links];
  return [
    ...links,
    { id: nextLinkId(links), name: defaultLinkName(members.length), members },
  ];
}

export function removeLink(
  links: readonly SessionLink[],
  id: string,
): SessionLink[] {
  return links.filter((link) => link.id !== id);
}

/**
 * Move a member up or down within its link.
 *
 * Order is not cosmetic: a member's index becomes its `circuit.position`, which
 * drives the logger's rotation order AND where the rest timer fires — rest is
 * suppressed for every member except the last in a round. So the lifter has to
 * be able to say which lift closes the round.
 *
 * Returns the input unchanged when the move would fall off either end, so a
 * disabled control and a stray call behave identically.
 */
export function moveMember(
  links: readonly SessionLink[],
  linkId: string,
  fromIndex: number,
  direction: -1 | 1,
): SessionLink[] {
  return links.map((link) => {
    if (link.id !== linkId) return link;
    const toIndex = fromIndex + direction;
    if (
      fromIndex < 0 ||
      fromIndex >= link.members.length ||
      toIndex < 0 ||
      toIndex >= link.members.length
    ) {
      return link;
    }
    const members = [...link.members];
    const [moved] = members.splice(fromIndex, 1);
    members.splice(toIndex, 0, moved!);
    return { ...link, members };
  });
}

/** Toggle a movement in the pending selection, respecting the member cap. */
export function toggleSelection(
  selected: readonly string[],
  key: string,
): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= MAX_LINK_MEMBERS) return [...selected];
  return [...selected, key];
}

/** True when any link in this slot contains a main lift — drives the warning. */
export function linksIncludeMainLift(
  links: readonly SessionLink[],
  movements: readonly LinkableMovement[],
): boolean {
  const mains = new Set(
    movements.filter((m) => m.isMain).map((m) => m.key),
  );
  return links.some((link) => link.members.some((m) => mains.has(m)));
}

/**
 * Drop a movement from every link in a slot, dissolving any link left with
 * fewer than two members.
 *
 * Called when a lift is removed from the slot. Without it the link keeps a
 * member that no longer exists: the wizard would still show it, and the engine
 * would then refuse to realise the whole link (every member must be present),
 * so the lifter's superset would vanish at materialisation with nothing having
 * said so. Pruning here keeps the editor honest — the link visibly shrinks, or
 * visibly disappears, at the moment the lift is removed.
 */
export function pruneMovementFromLinks(
  links: readonly SessionLink[],
  movementKey: string,
): SessionLink[] {
  return links
    .map((link) =>
      link.members.includes(movementKey)
        ? { ...link, members: link.members.filter((m) => m !== movementKey) }
        : link,
    )
    .filter((link) => link.members.length >= 2);
}

/**
 * Drop every member that is no longer offered by the slot, dissolving links
 * left too small. Used when the slot's movement list is replaced wholesale
 * (template switch, edit-mode rehydration) rather than one lift at a time.
 */
export function pruneLinksToMovements(
  links: readonly SessionLink[],
  movements: readonly LinkableMovement[],
): SessionLink[] {
  const present = new Set(movements.map((m) => m.key));
  return links
    .map((link) => ({
      ...link,
      members: link.members.filter((m) => present.has(m)),
    }))
    .filter((link) => link.members.length >= 2);
}

/**
 * Linkable lifts for an Activation strength session.
 *
 * Activation does not use the `sessionMovements` list the weekly templates do —
 * it has fixed program slots, each optionally overridden or removed. Members are
 * keyed by the CANONICAL slot (`sourceMovement`) rather than the movement
 * currently filling it, because that is the identity the engine resolves links
 * against, so a link survives swapping the exercise in that slot.
 *
 * A removed slot is not offered. The built-in AB Triad is locked while it is
 * complete, since an item carries at most one circuit.
 */
export function activationLinkableMovements(args: {
  slots: ReadonlyArray<{ sourceMovement: string }>;
  /** Canonical slot -> the movement filling it, or null when removed. */
  selected: Readonly<Record<string, string | null>>;
  labelOf: (movementKey: string) => string;
  /** Source slots the engine already links (the AB Triad). */
  builtinCircuitSources: readonly string[];
  /** Display name for the built-in group, e.g. "AB Triad". */
  builtinCircuitLabel: string;
}): LinkableMovement[] {
  const {
    slots,
    selected,
    labelOf,
    builtinCircuitSources,
    builtinCircuitLabel,
  } = args;
  const inBuiltin = new Set(builtinCircuitSources);
  // The built-in circuit only stands as a unit when all of its slots are present
  // AND still filled; otherwise its movements are ordinary lifts again.
  const complete =
    builtinCircuitSources.length > 0 &&
    builtinCircuitSources.every(
      (source) =>
        slots.some((slot) => slot.sourceMovement === source) &&
        selected[source] != null,
    );
  const out: LinkableMovement[] = [];
  let builtinEmitted = false;
  for (const slot of slots) {
    const movement = selected[slot.sourceMovement];
    if (movement == null) continue;
    if (complete && inBuiltin.has(slot.sourceMovement)) {
      // One row for the whole group, at the position of its first member.
      if (builtinEmitted) continue;
      builtinEmitted = true;
      out.push({
        key: builtinCircuitSources[0]!,
        label: builtinCircuitLabel,
        isMain: true,
        expandsTo: builtinCircuitSources,
      });
      continue;
    }
    out.push({
      key: slot.sourceMovement,
      label: labelOf(movement),
      // Activation's slots are all prescribed program lifts, not accessories.
      isMain: true,
    });
  }
  return out;
}

/** True when this link contains a main lift. */
export function linkHasMainLift(
  link: SessionLink,
  movements: readonly LinkableMovement[],
): boolean {
  return linksIncludeMainLift([link], movements);
}
