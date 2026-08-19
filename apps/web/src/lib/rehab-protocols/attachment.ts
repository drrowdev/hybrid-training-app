/**
 * Deciding the LOCAL protocol id a program uses for a library protocol.
 *
 * The customization addresses its rehab protocols by a local id, and three
 * other things are keyed off that id:
 *
 *   - `sessionLinks.bySeries["rehab.<localId>"]` — the protocol's supersets,
 *   - `phases.*.rehabAssignments[].protocolId` — which weekday it runs on,
 *   - `rehabSourceRef` (`rehab-<localId>-w<week>-d<day>`) written into every
 *     materialised prescription, which `removedEmbeddedRehabSourceRefs`
 *     tombstones reference when the user deletes a day's rehab section.
 *
 * Historically those ids were ordinals (`protocol-1`, `protocol-2`) handed out
 * by position. actions.ts already warns that "ids are reused as ordinals", so a
 * stale link can attach to whatever protocol later takes that id. With a
 * library the same hazard reaches tombstones: swap protocol-1 for a different
 * protocol and a day the user had cleared stays cleared for the newcomer.
 *
 * So a NEW attachment takes the library row's uuid as its local id — unique per
 * protocol, stable across re-selection, and a legal id (the schema allows
 * `^[a-z0-9][a-z0-9-]{0,63}$`, which a lowercase uuid satisfies).
 *
 * An attachment that ALREADY EXISTS keeps the local id it has. That is what
 * stops a deployed program shifting underneath its own links, assignments and
 * tombstones the first time it is edited after this change.
 */

/** `libraryProtocolId` → the local id that program already uses for it. */
export type ExistingBindings = Readonly<Record<string, string>>;

/**
 * Invert the binding map the database stores (`localId → libraryId`) into the
 * lookup the wizard needs (`libraryId → localId`).
 */
export function bindingsByLibraryId(
  byLocalId: Readonly<Record<string, string>>,
): ExistingBindings {
  const inverted: Record<string, string> = {};
  for (const [localId, libraryId] of Object.entries(byLocalId)) {
    // A program cannot use one library protocol in two slots — the wizard
    // selects each protocol at most once — but if it somehow did, the first
    // wins so the result is deterministic.
    if (!(libraryId in inverted)) inverted[libraryId] = localId;
  }
  return inverted;
}

export function localProtocolIdFor(
  libraryProtocolId: string,
  existing: ExistingBindings,
): string {
  return existing[libraryProtocolId] ?? libraryProtocolId;
}

export type SelectedProtocol = {
  /** The library row id. */
  libraryId: string;
  name: string;
  items: unknown[];
};

export type AttachedProtocol = {
  localId: string;
  libraryId: string;
  name: string;
  items: unknown[];
};

/**
 * Resolve the selected library protocols into the shape the customization
 * stores, preserving local ids for protocols the program already had.
 */
export function attachProtocols(
  selected: readonly SelectedProtocol[],
  existing: ExistingBindings,
): AttachedProtocol[] {
  return selected.map((protocol) => ({
    localId: localProtocolIdFor(protocol.libraryId, existing),
    libraryId: protocol.libraryId,
    name: protocol.name,
    items: protocol.items,
  }));
}

/**
 * Day assignments that point at a protocol which is no longer attached must be
 * dropped: the customization cross-validates that every assignment names an
 * existing protocol, so leaving one behind makes the whole deploy invalid.
 */
export function pruneAssignments<T extends { protocolId: string }>(
  assignments: readonly T[],
  attached: readonly AttachedProtocol[],
): T[] {
  const live = new Set(attached.map((protocol) => protocol.localId));
  return assignments.filter((assignment) => live.has(assignment.protocolId));
}

/**
 * Drop `rehab.*` link entries whose protocol is no longer attached, leaving
 * every non-rehab series untouched. A leftover rehab series key is rejected at
 * deploy ("a linked superset belongs to a rehab protocol that no longer
 * exists"), and would otherwise be adopted by a protocol reusing that id.
 */
export function pruneRehabLinks<T>(
  bySeries: Readonly<Record<string, T>>,
  attached: readonly AttachedProtocol[],
): Record<string, T> {
  const live = new Set(attached.map((protocol) => `rehab.${protocol.localId}`));
  return Object.fromEntries(
    Object.entries(bySeries).filter(
      ([key]) => !key.startsWith("rehab.") || live.has(key),
    ),
  );
}
