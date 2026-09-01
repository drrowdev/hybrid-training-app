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
  /**
   * Identity of this ROW in the picker.
   *
   * For a single lift this is the canonical slot — the engine's
   * `sourceMovement ?? movement`. For a GROUP row it is a synthetic key
   * (`group:<id>`) that is deliberately NOT one of its members, so a member's
   * own name is never shadowed by the group's name.
   */
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
   *
   * Each slot carries its own label because once the link exists it is displayed
   * member by member: a bare slot id would surface raw slugs
   * ("hanging-knee-raise") in the link's A1/A2/A3 rows.
   */
  expandsTo?: ReadonlyArray<{ key: string; label: string }>;
}

/** The canonical slots an entry contributes to a link. */
export function slotsOf(movement: LinkableMovement): readonly string[] {
  return movement.expandsTo && movement.expandsTo.length > 0
    ? movement.expandsTo.map((slot) => slot.key)
    : [movement.key];
}

/**
 * Display name for every canonical slot the offered movements can contribute,
 * including the members hidden inside a group row.
 *
 * The editor renders links member by member, and a link's members are SLOTS, so
 * a map keyed by row identity alone leaves every expanded group member without
 * a name.
 */
export function slotLabels(
  movements: readonly LinkableMovement[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const movement of movements) {
    if (movement.expandsTo && movement.expandsTo.length > 0) {
      for (const slot of movement.expandsTo) out.set(slot.key, slot.label);
    } else {
      out.set(movement.key, movement.label);
    }
  }
  return out;
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
 * The picker rows a selection resolves to, ignoring anything locked or unknown.
 *
 * The unit the lifter reasons in: a group row (the AB Triad) is ONE station
 * however many movements it contributes, which is what the link's name counts.
 */
export function selectedStations(
  movements: readonly LinkableMovement[],
  selected: readonly string[],
): LinkableMovement[] {
  return movements.filter(
    (m) => selected.includes(m.key) && !m.lockedReason,
  );
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
    {
      id: nextLinkId(links),
      // Named by stations, not members: "back extension + AB Triad" is a
      // superset of two things, not a giant set of four.
      name: defaultLinkName(selectedStations(movements, selected).length),
      members,
    },
  ];
}

export function removeLink(
  links: readonly SessionLink[],
  id: string,
): SessionLink[] {
  return links.filter((link) => link.id !== id);
}

/**
 * Toggle a movement in the pending selection, respecting the member cap.
 */
export function toggleSelection(
  selected: readonly string[],
  key: string,
): string[] {
  if (selected.includes(key)) return selected.filter((k) => k !== key);
  if (selected.length >= MAX_LINK_MEMBERS) return [...selected];
  return [...selected, key];
}

/**
 * True when any link in this slot contains a main lift — drives the warning.
 *
 * Matched against SLOTS, not row keys: a group row's key is synthetic and never
 * appears in a link's members.
 */
export function linksIncludeMainLift(
  links: readonly SessionLink[],
  movements: readonly LinkableMovement[],
): boolean {
  const mains = new Set(
    movements.filter((m) => m.isMain).flatMap((m) => slotsOf(m)),
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
  const present = new Set(movements.flatMap((m) => slotsOf(m)));
  return links
    .map((link) => ({
      ...link,
      members: link.members.filter((m) => present.has(m)),
    }))
    .filter((link) => link.members.length >= 2);
}

/** One session series' worth of valid link membership. */
export interface SeriesMovementSet {
  key: string;
  /** Canonical slot identities this series can ever contain right now. */
  identities: readonly string[];
}

/**
 * Re-key a whole `bySeries` map against a NEW template or program's series,
 * used at the moment a template/program switch would otherwise leave stale
 * links pointing at slots the new selection doesn't have.
 *
 * Two things happen at once, both required — neither alone is safe:
 *
 *  - A series key absent from `seriesMovements` (the new template dropped that
 *    session, or the whole program changed) is DROPPED entirely rather than
 *    carried over. Templates reuse `slot-1`, `slot-2`, … across templates, so
 *    keeping an unrecognised key's links around risks silently reattaching
 *    them to an unrelated session that happens to reuse the same key.
 *  - A series key that IS still there is pruned member-by-member via
 *    `pruneLinksToMovements`, so a link that only partly survives (one lift
 *    swapped, one kept) keeps the members that are still valid instead of
 *    being dropped wholesale.
 *
 * Passing `[]` for `seriesMovements` (switching to a non-TB program) clears
 * every link, since no series exists to validate them against.
 */
export function pruneLinksAcrossSeries(
  linksBySeries: Readonly<Record<string, SessionLink[]>>,
  seriesMovements: readonly SeriesMovementSet[],
): Record<string, SessionLink[]> {
  const identitiesByKey = new Map(
    seriesMovements.map((series) => [series.key, series.identities]),
  );
  const next: Record<string, SessionLink[]> = {};
  for (const [seriesKey, links] of Object.entries(linksBySeries)) {
    if (!links.length) continue;
    const identities = identitiesByKey.get(seriesKey);
    if (!identities) continue;
    const pruned = pruneLinksToMovements(
      links,
      identities.map((key) => ({ key, label: key })),
    );
    if (pruned.length > 0) next[seriesKey] = pruned;
  }
  return next;
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
  slots: ReadonlyArray<{
    sourceMovement: string;
    /**
     * Whether the slot is a main lift. Supplied by the server projection from
     * the template (peak/support split, plus supplemental prescription rules) —
     * Activation days mix main and supplemental work, so this cannot be assumed.
     * Absent ⇒ treated as main, matching a template that says nothing.
     */
    role?: "main" | "supplemental";
  }>;
  /** Canonical slot -> the movement filling it, or null when removed. */
  selected: Readonly<Record<string, string | null>>;
  labelOf: (movementKey: string) => string;
  /** Source slots the engine already links (the AB Triad). */
  builtinCircuitSources: readonly string[];
  /** Display name for the built-in group, e.g. "AB Triad". */
  builtinCircuitLabel: string;
  /** Synthetic key for the group row; never one of its members. */
  builtinCircuitKey: string;
}): LinkableMovement[] {
  const {
    slots,
    selected,
    labelOf,
    builtinCircuitSources,
    builtinCircuitLabel,
    builtinCircuitKey,
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
        key: builtinCircuitKey,
        label: builtinCircuitLabel,
        // The triad is accessory core work; linking it warrants no warning.
        isMain: false,
        expandsTo: builtinCircuitSources.map((source) => ({
          key: source,
          label: labelOf(selected[source] ?? source),
        })),
      });
      continue;
    }
    out.push({
      key: slot.sourceMovement,
      label: labelOf(movement),
      isMain: slot.role !== "supplemental",
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

/**
 * One thing the lifter picked, as they picked it.
 *
 * A link's `members` are canonical SLOTS because that is what the engine
 * resolves and what `circuit.position` indexes. But the lifter chose STATIONS:
 * "Back Extension + AB Triad" is two picks, not four. Rendering members
 * directly is why a two-pick superset displayed as A1–A4 and read as a giant
 * set. Stations are the display unit; members stay the stored unit.
 */
export interface LinkStation {
  /** Row identity — a group row's synthetic key, or the slot itself. */
  key: string;
  label: string;
  /** Canonical slots this station contributes, in stored order. */
  slots: string[];
  /** Index of this station's first slot within `link.members`. */
  memberOffset: number;
}

/** The row that owns a canonical slot, if any of the offered rows do. */
function ownerOf(
  slot: string,
  movements: readonly LinkableMovement[],
): LinkableMovement | undefined {
  return movements.find((m) => slotsOf(m).includes(slot));
}

/**
 * Collapse a link's members into the stations the lifter actually chose.
 *
 * Consecutive members belonging to the same row fold into one station. They are
 * only folded when CONTIGUOUS: if a reorder ever split a group apart, showing
 * it as one station would misreport the order the engine will run.
 */
export function linkStations(
  link: SessionLink,
  movements: readonly LinkableMovement[],
): LinkStation[] {
  const out: LinkStation[] = [];
  link.members.forEach((member, index) => {
    const owner = ownerOf(member, movements);
    const key = owner?.key ?? member;
    const previous = out[out.length - 1];
    if (previous && previous.key === key) {
      previous.slots.push(member);
      return;
    }
    out.push({
      key,
      label: owner?.label ?? member,
      slots: [member],
      memberOffset: index,
    });
  });
  return out;
}

/**
 * Per-slot link membership, for annotating the program-slot rows.
 *
 * The rows are the lifter's mental model of the session, so the link has to be
 * visible there — a panel underneath makes two linked lifts look like two
 * unrelated entries. Keyed by canonical slot because that is what a row is
 * keyed by.
 */
export interface SlotLinkBadge {
  linkId: string;
  linkName: string;
  /** 1-based station position — the "A1" / "A2" the lifter sees. */
  station: number;
  stationCount: number;
  /** First slot of its station: where the station's label/controls belong. */
  isStationStart: boolean;
  /** Last slot of the LAST station — the one rest follows. */
  isLinkEnd: boolean;
  hasMainLift: boolean;
}

export function slotLinkBadges(
  links: readonly SessionLink[],
  movements: readonly LinkableMovement[],
): Map<string, SlotLinkBadge> {
  const out = new Map<string, SlotLinkBadge>();
  for (const link of links) {
    const stations = linkStations(link, movements);
    const hasMainLift = linkHasMainLift(link, movements);
    const lastMember = link.members[link.members.length - 1];
    stations.forEach((station, stationIndex) => {
      station.slots.forEach((slot, slotIndex) => {
        out.set(slot, {
          linkId: link.id,
          linkName: link.name,
          station: stationIndex + 1,
          stationCount: stations.length,
          isStationStart: slotIndex === 0,
          isLinkEnd: slot === lastMember,
          hasMainLift,
        });
      });
    });
  }
  return out;
}

/**
 * Move a whole station within its link.
 *
 * Order is not cosmetic: a member's index becomes its `circuit.position`, which
 * drives the logger's rotation order AND where the rest timer fires — rest is
 * suppressed for every member except the last in a round. So the lifter has to
 * be able to say which lift closes the round.
 *
 * Stations move as a block. Shifting a single slot tore a group apart: nudging
 * the AB Triad down once would leave Back Extension sandwiched between two of
 * its movements. Returns the input unchanged when the move falls off an end, so
 * a disabled control and a stray call behave identically.
 */
export function moveStation(
  links: readonly SessionLink[],
  linkId: string,
  stationIndex: number,
  direction: -1 | 1,
  movements: readonly LinkableMovement[],
): SessionLink[] {
  return links.map((link) => {
    if (link.id !== linkId) return link;
    const stations = linkStations(link, movements);
    const target = stationIndex + direction;
    if (
      stationIndex < 0 ||
      stationIndex >= stations.length ||
      target < 0 ||
      target >= stations.length
    ) {
      return link;
    }
    const reordered = [...stations];
    const [moved] = reordered.splice(stationIndex, 1);
    reordered.splice(target, 0, moved!);
    return { ...link, members: reordered.flatMap((s) => s.slots) };
  });
}

