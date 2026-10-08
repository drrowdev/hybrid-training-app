/** Upper bound on members in one link — a giant set beyond this is a workout. */
export const MAX_LINK_MEMBERS = 8;

/** Human name for a link of `stationCount` stations. */
export function defaultLinkName(stationCount: number): string {
  if (stationCount <= 2) return "Superset";
  if (stationCount === 3) return "Tri-set";
  return "Giant set";
}

type LinkablePart = { id: string; kind: string; linkNext?: boolean };

/**
 * Runs of adjacent exercise parts joined by `linkNext`. A flag pointing at a
 * non-exercise part, past the end, or beyond the member cap is ignored, so a
 * stale flag can never produce a half-bracket.
 */
export function authoredLinkGroups<T extends LinkablePart>(parts: readonly T[]): T[][] {
  const groups: T[][] = [];
  let index = 0;
  while (index < parts.length) {
    const group = [parts[index]!];
    while (
      group.length < MAX_LINK_MEMBERS && group[group.length - 1]!.kind === "movement" && group[group.length - 1]!.linkNext
      && parts[index + group.length]?.kind === "movement"
    ) group.push(parts[index + group.length]!);
    groups.push(group);
    index += group.length;
  }
  return groups;
}

/** Drops link flags that no longer join two adjacent exercises. */
export function normalizeAuthoredLinks<T extends LinkablePart>(parts: readonly T[]): T[] {
  const joined = new Set(authoredLinkGroups(parts).flatMap((group) => group.slice(0, -1).map((part) => part.id)));
  return parts.map((part) => {
    if (!part.linkNext || joined.has(part.id)) return part;
    const { linkNext: _linkNext, ...rest } = part;
    return rest as T;
  });
}

export function canLinkAuthoredPart(parts: readonly LinkablePart[], index: number): boolean {
  const part = parts[index], next = parts[index + 1];
  if (part?.kind !== "movement" || next?.kind !== "movement" || part.linkNext) return false;
  const group = authoredLinkGroups(parts).find((entry) => entry.some((member) => member.id === part.id))!;
  const following = authoredLinkGroups(parts).find((entry) => entry[0]!.id === next.id)!;
  return group.length + following.length <= MAX_LINK_MEMBERS;
}

export function setAuthoredPartLinked<T extends LinkablePart>(parts: readonly T[], index: number, linked: boolean): T[] {
  if (linked && !canLinkAuthoredPart(parts, index)) return [...parts];
  return normalizeAuthoredLinks(parts.map((part, i) => {
    if (i !== index) return part;
    if (linked) return { ...part, linkNext: true };
    const { linkNext: _linkNext, ...rest } = part;
    return rest as T;
  }));
}

/** Removes one part; the neighbours stay linked to each other only if the removed part was a middle member. */
export function removeAuthoredPart<T extends LinkablePart>(parts: readonly T[], id: string): T[] {
  const index = parts.findIndex((part) => part.id === id);
  if (index < 0) return [...parts];
  const removed = parts[index]!;
  const next = parts.filter((part) => part.id !== id);
  const before = next[index - 1];
  if (before?.linkNext && !removed.linkNext) return normalizeAuthoredLinks(next.map((part) => {
    if (part.id !== before.id) return part;
    const { linkNext: _linkNext, ...rest } = part;
    return rest as T;
  }));
  return normalizeAuthoredLinks(next);
}

/**
 * Moves a part one step. Inside a link it reorders the members; at a link's edge,
 * or for a solo part, the whole unit hops past the neighbouring link or exercise,
 * so a move never splits or merges groups.
 */
export function moveAuthoredPart<T extends LinkablePart>(parts: readonly T[], index: number, delta: -1 | 1): T[] {
  const target = index + delta;
  if (target < 0 || target >= parts.length) return [...parts];
  const groups = authoredLinkGroups(parts);
  const from = groups.findIndex((group) => group.some((part) => part.id === parts[index]!.id));
  const group = groups[from]!;
  const position = group.findIndex((part) => part.id === parts[index]!.id);
  const inside = position + delta >= 0 && position + delta < group.length;
  if (inside) {
    const next = [...parts];
    const flags = [parts[index]!.linkNext, parts[target]!.linkNext];
    [next[index], next[target]] = [next[target]!, next[index]!];
    const place = (part: T, linked: boolean | undefined): T => {
      const { linkNext: _linkNext, ...rest } = part;
      return (linked ? { ...rest, linkNext: true } : rest) as T;
    };
    const lower = Math.min(index, target);
    next[lower] = place(next[lower]!, flags[delta < 0 ? 1 : 0]);
    next[lower + 1] = place(next[lower + 1]!, flags[delta < 0 ? 0 : 1]);
    return next;
  }
  const neighbour = groups[from + delta];
  if (!neighbour) return [...parts];
  const reordered = delta < 0 ? [...groups.slice(0, from - 1), group, neighbour, ...groups.slice(from + 1)]
    : [...groups.slice(0, from), neighbour, group, ...groups.slice(from + 2)];
  return normalizeAuthoredLinks(reordered.flat());
}