/**
 * The single place a rehab protocol's CONTENT is resolved.
 *
 * Rehab protocols are authored in Settings and stored in `rehab_protocols`.
 * A program attaches one via a `program_rehab_bindings` row, which maps the
 * customization's own local protocol id (`protocol-1`, `protocol-2`, … or the
 * synthetic `protocol-1` that legacy V1/V2 blobs use) to a library row.
 *
 * The customization blob still carries the items it was deployed with. Those
 * are now a STALE COPY wherever a binding exists: the library is authoritative.
 * Every read path — the wizard's edit context, the deploy path, the live-sync
 * path — must funnel through `resolveRehabLibrary` so a stale copy can never
 * win. That is the "single home for derived state" rule in AGENTS.md §6.9.
 *
 * WITHOUT A BINDING NOTHING CHANGES. `resolveRehabLibrary` returns its input
 * untouched when a protocol has no binding, which is exactly today's behaviour.
 * That is what makes the feature safe to deploy BEFORE its migration runs —
 * this repo ships app-first, database-second, so the new build serves traffic
 * while `rehab_protocols` does not yet exist.
 */
import type { SessionLink } from "./session-links";
import type { RehabSchedule } from "./rehab-schedule";
import {
  LEGACY_REHAB_PROTOCOL_ID,
  isTbActivationCustomizationV3,
  type TbCustomization,
} from "./tb-customization";

/**
 * Everything a program carries about its rehab. A weekly block keeps it in the
 * `rehabSchedule` envelope; Activation keeps it in the customization; a block
 * deployed before the envelope existed keeps it in the customization's own
 * `rehab` field. All three resolve through the same functions here.
 */
export type RehabSource = {
  customization?: TbCustomization;
  rehabSchedule?: RehabSchedule;
};

/** A library protocol as the resolver needs it. */
export type LibraryProtocol = {
  id: string;
  name: string;
  items: RehabItemLike[];
  links: SessionLink[];
};

type RehabItemLike = {
  movementId: string;
  movementName: string;
  side?: "both" | "left" | "right";
  sets: number;
  reps?: number;
  holdSeconds?: number;
  targetWeightKg?: number;
  instructions?: string;
};

/** `local protocol id` → `library protocol id`, for ONE program instance. */
export type RehabBindingMap = Readonly<Record<string, string>>;

export type ResolvedRehab = {
  customization?: TbCustomization;
  /** The envelope with library content substituted in, when there is one. */
  rehabSchedule?: RehabSchedule;
  /** `rehab.<localId>` → links, merged over whatever the program carried. */
  linksBySeries: Record<string, SessionLink[]>;
  /** Local ids that are bound but whose library row is missing. */
  missing: string[];
};

export const REHAB_SERIES_PREFIX = "rehab.";

/**
 * The local protocol ids a program defines, in the order it defines them.
 * A weekly block names exactly one; V1/V2 blobs address their single unnamed
 * list by the synthetic legacy id.
 */
export function localProtocolIds(source: RehabSource): string[] {
  if (source.rehabSchedule) {
    return source.rehabSchedule.protocols.map((protocol) => protocol.id);
  }
  const customization = source.customization;
  if (!customization) return [];
  if (isTbActivationCustomizationV3(customization)) {
    return customization.rehabProtocols.map((protocol) => protocol.id);
  }
  return (customization.rehab?.items.length ?? 0) > 0
    ? [LEGACY_REHAB_PROTOCOL_ID]
    : [];
}

/**
 * Substitute library content into a customization + its session links.
 *
 * Returns a NEW object; the inputs are never mutated. A local id with no
 * binding, or one whose library row is absent, is left exactly as it was so the
 * program keeps running on the definition it was deployed with rather than
 * silently losing its rehab.
 */
export function resolveRehabLibrary(
  source: RehabSource,
  linksBySeries: Readonly<Record<string, readonly SessionLink[]>> | undefined,
  bindings: RehabBindingMap,
  library: readonly LibraryProtocol[],
): ResolvedRehab {
  const { customization, rehabSchedule } = source;
  const byId = new Map(library.map((protocol) => [protocol.id, protocol]));
  const resolvedLinks: Record<string, SessionLink[]> = Object.fromEntries(
    Object.entries(linksBySeries ?? {}).map(([key, links]) => [key, [...links]]),
  );
  const missing: string[] = [];

  const lookup = (localId: string): LibraryProtocol | null => {
    const libraryId = bindings[localId];
    if (!libraryId) return null;
    const protocol = byId.get(libraryId);
    if (!protocol) {
      missing.push(localId);
      return null;
    }
    return protocol;
  };

  const applyLinks = (localId: string, protocol: LibraryProtocol) => {
    // The library owns a protocol's grouping, so its links REPLACE whatever the
    // program carried. Leaving the program's copy in place would let a superset
    // the user removed in Settings survive the edit.
    //
    // An empty list DELETES the key rather than writing `[]`:
    // `sessionLinksSchema` requires `.min(1)` per series, so an empty array is
    // not a valid "no links" value — the absent key is.
    const seriesKey = `${REHAB_SERIES_PREFIX}${localId}`;
    if (protocol.links.length === 0) {
      delete resolvedLinks[seriesKey];
      return;
    }
    resolvedLinks[seriesKey] = [...protocol.links];
  };

  // A weekly block's rehab lives in the envelope, which owns both its name and
  // its items — unlike the legacy shapes below, which have nowhere to keep a
  // name. Placement (`series` / `days`) is the PROGRAM's, so it is untouched.
  if (rehabSchedule) {
    const protocols = rehabSchedule.protocols.map((protocol) => {
      const bound = lookup(protocol.id);
      if (!bound) return protocol;
      applyLinks(protocol.id, bound);
      return {
        ...protocol,
        name: bound.name,
        items: bound.items as RehabSchedule["protocols"][number]["items"],
      };
    });
    return {
      customization,
      rehabSchedule: { ...rehabSchedule, protocols },
      linksBySeries: resolvedLinks,
      missing,
    };
  }

  if (!customization) {
    return { linksBySeries: resolvedLinks, missing };
  }

  if (isTbActivationCustomizationV3(customization)) {
    let changed = false;
    const rehabProtocols = customization.rehabProtocols.map((protocol) => {
      const bound = lookup(protocol.id);
      if (!bound) return protocol;
      applyLinks(protocol.id, bound);
      changed = true;
      return { ...protocol, name: bound.name, items: bound.items };
    });
    return {
      customization: changed ? { ...customization, rehabProtocols } : customization,
      linksBySeries: resolvedLinks,
      missing,
    };
  }

  // V1 / V2 — one unnamed list. Only its items are library-owned; these shapes
  // have nowhere to carry a name, and the program's own displayName is what the
  // UI shows for them.
  //
  // The items stay in the customization rather than being lifted into an
  // envelope: `tbCustomizationV1Schema` requires a `rehab` day type whenever it
  // sees a `rehab` field, so moving one without the other makes the blob
  // invalid. Converting a legacy block is the wizard's job, on the edit it
  // already re-writes both sides of.
  const bound = lookup(LEGACY_REHAB_PROTOCOL_ID);
  if (!bound || !customization.rehab) {
    return { customization, linksBySeries: resolvedLinks, missing };
  }
  applyLinks(LEGACY_REHAB_PROTOCOL_ID, bound);
  return {
    customization: { ...customization, rehab: { items: bound.items } },
    linksBySeries: resolvedLinks,
    missing,
  };
}

/**
 * Whether resolving would change anything. Used by the sync path to skip
 * programs a protocol edit cannot affect, so an unrelated program is never
 * rewritten.
 */
export function resolutionChangesProgram(
  source: RehabSource,
  linksBySeries: Readonly<Record<string, readonly SessionLink[]>> | undefined,
  bindings: RehabBindingMap,
  library: readonly LibraryProtocol[],
): boolean {
  const resolved = resolveRehabLibrary(source, linksBySeries, bindings, library);
  if (
    JSON.stringify(rehabFingerprint(resolved)) !==
    JSON.stringify(rehabFingerprint(source))
  ) {
    return true;
  }
  const before = JSON.stringify(sortedSeries(linksBySeries ?? {}));
  const after = JSON.stringify(sortedSeries(resolved.linksBySeries));
  return before !== after;
}

/**
 * Everything about a program's rehab that a user can change from Settings —
 * items AND names. The name matters: `rehabItemsForComparison` in
 * rehab-composition.ts deliberately strips `rehabProtocolName` before comparing
 * prescriptions, so a rename with identical movements is invisible to it and
 * would otherwise never reach the plan.
 */
export function rehabFingerprint(
  source: RehabSource,
): Array<{ id: string; name: string; items: RehabItemLike[] }> {
  if (source.rehabSchedule) {
    return source.rehabSchedule.protocols.map((protocol) => ({
      id: protocol.id,
      name: protocol.name,
      items: protocol.items,
    }));
  }
  const customization = source.customization;
  if (!customization) return [];
  if (isTbActivationCustomizationV3(customization)) {
    return customization.rehabProtocols.map((protocol) => ({
      id: protocol.id,
      name: protocol.name,
      items: protocol.items,
    }));
  }
  return customization.rehab
    ? [
        {
          id: LEGACY_REHAB_PROTOCOL_ID,
          name: customization.displayName ?? "Rehab",
          items: customization.rehab.items,
        },
      ]
    : [];
}

function sortedSeries(
  series: Readonly<Record<string, readonly SessionLink[]>>,
): Array<[string, readonly SessionLink[]]> {
  return Object.entries(series)
    .filter(([key, links]) => key.startsWith(REHAB_SERIES_PREFIX) && links.length > 0)
    .sort(([a], [b]) => a.localeCompare(b));
}
