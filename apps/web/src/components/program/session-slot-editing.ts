/**
 * Pure editing rules for a Tactical Barbell session's movement list.
 *
 * Extracted from `ProgramPicker` so the parts that decide what a lift IS — which
 * template slot it fills, whether it is accessory work the user added, and what
 * gets written to the customization — are testable without a DOM. Two bugs
 * found in review lived here: mutating from an empty list wiped a session the
 * user hadn't seeded yet, and re-deriving the accessory role from a missing slot
 * demoted a legacy customization's lifts to 3×12.
 */
import { MAX_LINK_MEMBERS } from "@/lib/platform/session-links";

export type SlotKind = "barbell" | "weighted-bw" | "bodyweight" | "unanchored";

/** One movement the template prescribes in a repeating weekly strength slot. */
export interface TemplateSlot {
  sourceMovement: string;
  role: "main" | "supplemental";
  kind?: SlotKind;
  split?: "A" | "B";
}

/**
 * One editable row.
 *
 * `sourceMovement` is the template slot the row fills; `movement` is whatever
 * exercise currently fills it. They differ once the user swaps the exercise, and
 * the slot is what the engine matches its prescription rules against — so a
 * swapped supplemental keeps its supplemental sets, reps and percentage.
 * `role: "accessory"` marks a movement the user added themselves.
 */
export interface SeriesSlotDraft {
  sourceMovement?: string;
  movement: string;
  kind?: SlotKind;
  role?: "accessory";
}

/** What a customized session sends for one row. */
export interface SlotPayloadEntry {
  movement: string;
  sourceMovement?: string;
  role?: "accessory";
  kind?: SlotKind;
  movementId?: string;
  slug?: string;
  displayName?: string;
}

/**
 * The slot a row belongs to. Customizations written before slots were recorded
 * carry only a movement key, which for an unswapped row IS its slot — the same
 * fallback the engine applies.
 */
export function slotIdentity(draft: SeriesSlotDraft): string {
  return draft.sourceMovement ?? draft.movement;
}

/** The rows a template prescribes, as editable drafts. */
export function slotDraftsFor(
  slots: readonly TemplateSlot[],
): SeriesSlotDraft[] {
  return slots.map((slot) => ({
    sourceMovement: slot.sourceMovement,
    movement: slot.sourceMovement,
    ...(slot.kind ? { kind: slot.kind } : {}),
  }));
}

/** The template slot a row fills, or undefined for accessory work. */
export function slotOf(
  slots: readonly TemplateSlot[],
  draft: SeriesSlotDraft,
): TemplateSlot | undefined {
  if (draft.role === "accessory") return undefined;
  const identity = slotIdentity(draft);
  return slots.find((slot) => slot.sourceMovement === identity);
}

/**
 * The rows a session currently has, seeding from the template when the user has
 * not touched this session yet. Every mutator goes through this: starting from
 * an empty list would wipe the template's own lifts on the first edit.
 */
export function seededDrafts(
  existing: readonly SeriesSlotDraft[] | undefined,
  slots: readonly TemplateSlot[],
): SeriesSlotDraft[] {
  return existing ? [...existing] : slotDraftsFor(slots);
}

export function removeSlot(
  drafts: readonly SeriesSlotDraft[],
  identity: string,
): SeriesSlotDraft[] {
  return drafts.filter((draft) => slotIdentity(draft) !== identity);
}

/**
 * Put a removed template slot back, exactly as the template prescribes it.
 *
 * Restores the slot, not "a movement called X": the row comes back carrying its
 * canonical `sourceMovement` and `kind`, which is what the engine matches its
 * prescription rules against (ADR 0074). Rebuilding it as a bare movement would
 * hand a supplemental lift back as main work.
 *
 * The row is placed in template order rather than appended, so restoring the
 * first of two supplementals doesn't leave it sitting under the second.
 */
export function restoreSlot(
  drafts: readonly SeriesSlotDraft[],
  slots: readonly TemplateSlot[],
  sourceMovement: string,
): SeriesSlotDraft[] {
  const slot = slots.find((s) => s.sourceMovement === sourceMovement);
  if (!slot) return [...drafts];
  if (drafts.some((draft) => slotIdentity(draft) === sourceMovement)) {
    return [...drafts];
  }

  const restored: SeriesSlotDraft = {
    sourceMovement: slot.sourceMovement,
    movement: slot.sourceMovement,
    ...(slot.kind ? { kind: slot.kind } : {}),
  };

  // Template rows keep template order; anything the user added stays after them.
  const order = new Map(slots.map((s, index) => [s.sourceMovement, index]));
  const templateRows: SeriesSlotDraft[] = [];
  const addedRows: SeriesSlotDraft[] = [];
  for (const draft of [...drafts, restored]) {
    if (order.has(slotIdentity(draft)) && draft.role !== "accessory") {
      templateRows.push(draft);
    } else {
      addedRows.push(draft);
    }
  }
  templateRows.sort(
    (a, b) =>
      (order.get(slotIdentity(a)) ?? 0) - (order.get(slotIdentity(b)) ?? 0),
  );
  return [...templateRows, ...addedRows];
}

/**
 * Put a different exercise in a slot. The slot itself is untouched, so links
 * keyed by it survive and the engine keeps prescribing it the same way.
 */
export function replaceSlot(
  drafts: readonly SeriesSlotDraft[],
  identity: string,
  movement: string,
  kind?: SlotKind,
): SeriesSlotDraft[] {
  return drafts.map((draft) =>
    slotIdentity(draft) === identity
      ? { sourceMovement: identity, movement, ...(kind ? { kind } : {}) }
      : draft,
  );
}

/** Append a movement the user chose; it is prescribed as accessory work. */
export function addAccessory(
  drafts: readonly SeriesSlotDraft[],
  movement: string,
): SeriesSlotDraft[] {
  if (drafts.some((draft) => draft.movement === movement)) return [...drafts];
  return [...drafts, { movement, role: "accessory" }];
}

/**
 * What one row sends to the engine.
 *
 * The accessory role is CARRIED from the draft, never re-derived from a missing
 * slot: a customization written before slots existed has no slot on ANY entry,
 * so deriving would demote its lifts to accessory work on the next edit.
 */
export function slotPayloadEntry(
  draft: SeriesSlotDraft,
  slot: TemplateSlot | undefined,
  catalog?: { id: string; slug: string; name: string },
): SlotPayloadEntry {
  const kind =
    draft.kind ??
    slot?.kind ??
    (draft.movement === "weighted-pullup"
      ? ("weighted-bw" as const)
      : draft.movement === "pullup"
        ? ("bodyweight" as const)
        : undefined);
  return {
    movement: draft.movement,
    ...(draft.role === "accessory"
      ? { role: "accessory" as const }
      : slot
        ? { sourceMovement: slot.sourceMovement }
        : {}),
    ...(catalog
      ? { movementId: catalog.id, slug: catalog.slug, displayName: catalog.name }
      : {}),
    ...(kind ? { kind } : {}),
  };
}

/** Whether a click that drops `removedRows` may proceed without emptying the session. */
export function canRemoveRows(totalRows: number, removedRows: number): boolean {
  return totalRows - removedRows >= 1;
}

/** The three groups a session's rows are shown in, in the order they are run. */
export type SlotSection = "main" | "supplemental" | "accessory";

export const SLOT_SECTIONS: readonly SlotSection[] = [
  "main",
  "supplemental",
  "accessory",
];

export function sectionOf(
  slots: readonly TemplateSlot[],
  draft: SeriesSlotDraft,
): SlotSection {
  if (draft.role === "accessory") return "accessory";
  return slotOf(slots, draft)?.role === "supplemental"
    ? "supplemental"
    : "main";
}

/**
 * Group the rows the way they are shown: main work, then the template's
 * supplemental work, then anything the user added. The session is prescribed in
 * this order too, so the screen and the workout can't disagree. A canonical
 * template is already in this order, so ordering it changes nothing.
 */
export function orderBySection(
  drafts: readonly SeriesSlotDraft[],
  slots: readonly TemplateSlot[],
): SeriesSlotDraft[] {
  return SLOT_SECTIONS.flatMap((section) =>
    drafts.filter((draft) => sectionOf(slots, draft) === section),
  );
}

/**
 * Swap a whole built-in circuit for one movement.
 *
 * The replacement keeps the circuit's FIRST slot, so the row still knows which
 * circuit it stands in for and can be restored. The other slots are dropped —
 * a circuit runs whole or not at all.
 */
export function collapseGroup(
  drafts: readonly SeriesSlotDraft[],
  group: readonly string[],
  movement: string,
): SeriesSlotDraft[] {
  const [head, ...rest] = group;
  if (!head) return [...drafts];
  const dropped = new Set(rest);
  return drafts.flatMap((draft) => {
    const identity = slotIdentity(draft);
    if (identity === head) return [{ sourceMovement: head, movement }];
    return dropped.has(identity) ? [] : [draft];
  });
}

/** Put a collapsed circuit back, in place. */
/**
 * Put a built-in circuit back.
 *
 * Two ways it can be gone: swapped for a single movement (the head row is still
 * there, holding a different exercise), or removed outright. Restoring means the
 * whole circuit either way — `abRule` prescribes the AB Triad as one unit, so
 * half a triad would print the circuit's instructions against one lift.
 */
export function restoreGroup(
  drafts: readonly SeriesSlotDraft[],
  group: readonly string[],
  slots: readonly TemplateSlot[] = [],
): SeriesSlotDraft[] {
  const [head] = group;
  if (!head) return [...drafts];
  const hasHead = drafts.some((draft) => slotIdentity(draft) === head);
  if (hasHead) {
    return drafts.flatMap((draft) =>
      slotIdentity(draft) === head
        ? group.map((source) => ({ sourceMovement: source, movement: source }))
        : [draft],
    );
  }
  // Removed outright: no row to expand, so re-insert each slot in template order.
  return group.reduce<SeriesSlotDraft[]>(
    (rows, source) => restoreSlot(rows, slots, source),
    [...drafts],
  );
}

/** Whether a built-in circuit is present whole. */
export function hasWholeGroup(
  drafts: readonly SeriesSlotDraft[],
  group: readonly string[],
): boolean {
  const present = new Set(drafts.map(slotIdentity));
  return group.every((source) => present.has(source));
}

/** Whether a circuit was swapped for a single movement rather than removed. */
export function isGroupReplaced(
  drafts: readonly SeriesSlotDraft[],
  group: readonly string[],
): boolean {
  const [head] = group;
  if (!head) return false;
  const row = drafts.find((draft) => slotIdentity(draft) === head);
  return row != null && row.movement !== head && !hasWholeGroup(drafts, group);
}

/**
 * Rewrite the members of every link that contains `from`, in place.
 *
 * A link names the canonical slots it runs, so collapsing a circuit into one
 * movement leaves any link that ran it naming two slots the session no longer
 * has. The engine refuses a link with a missing member, so the whole superset
 * would disappear without a word.
 *
 * The result obeys the same size rules as every other link edit: a link that
 * cannot be rewritten within them is dissolved rather than left naming slots
 * that no longer line up. A link too full to take the circuit back would still
 * name only its first slot, and the engine drops a link that claims part of a
 * circuit — so leaving it would promise a superset that never runs.
 */
export function replaceLinkMembers<T extends { members: string[] }>(
  links: readonly T[],
  from: readonly string[],
  to: readonly string[],
  maxMembers = MAX_LINK_MEMBERS,
): T[] {
  const dropped = new Set(from);
  return links
    .map((link) => {
      if (!from.every((member) => link.members.includes(member))) return link;
      let emitted = false;
      const members = link.members.flatMap((member) => {
        if (!dropped.has(member)) return [member];
        if (emitted) return [];
        emitted = true;
        return [...to];
      });
      return { ...link, members };
    })
    .filter(
      (link) =>
        link.members.length >= 2 && link.members.length <= maxMembers,
    );
}

/** Whether any session row differs from what the template prescribes. */
export function slotsEdited(
  existing: readonly SeriesSlotDraft[] | undefined,
  slots: readonly TemplateSlot[],
): boolean {
  if (!existing) return false;
  const canonical = slotDraftsFor(slots);
  if (existing.length !== canonical.length) return true;
  return existing.some((draft, index) => {
    const base = canonical[index]!;
    return (
      draft.movement !== base.movement ||
      draft.sourceMovement !== base.sourceMovement ||
      draft.role != null
    );
  });
}
