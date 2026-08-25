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
  /** What the template prescribes this slot across the block, for display. */
  dose?: { sets: string; reps: string; load: string | null };
}

/** Sets, reps and load as one line: `3–5 × 8–10 · 65–75% TM`. */
export function doseLabel(
  dose: { sets: string; reps: string; load: string | null } | undefined,
): string | null {
  if (!dose || !dose.sets || !dose.reps) return null;
  const head = `${dose.sets} \u00D7 ${dose.reps}`;
  return dose.load ? `${head} \u00B7 ${dose.load}` : head;
}

/** The dose a movement the lifter added is prescribed at. */
export function addedDose(
  role: AddedRole,
  supplementalDose: { sets: string; reps: string; load: string | null } | undefined,
): { sets: string; reps: string; load: string | null } {
  return role === "supplemental" && supplementalDose
    ? supplementalDose
    : { sets: "3", reps: "8–15", load: null };
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
  role?: AddedRole;
}

/**
 * How a movement the user added is dosed.
 *
 * `"supplemental"` takes the dose the session's own supplemental work gets —
 * same percentage, sets and reps. `"accessory"` takes the accessory dose
 * (3×8–15 near failure) and no percentage. The distinction is real
 * methodology, not a label, so both stay expressible.
 */
export type AddedRole = "accessory" | "supplemental";

/** What a customized session sends for one row. */
export interface SlotPayloadEntry {
  movement: string;
  sourceMovement?: string;
  role?: AddedRole;
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

/** The template slot a row fills, or undefined for work the user added. */
export function slotOf(
  slots: readonly TemplateSlot[],
  draft: SeriesSlotDraft,
): TemplateSlot | undefined {
  if (draft.role) return undefined;
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
    if (order.has(slotIdentity(draft)) && draft.role == null) {
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

/**
 * Append a movement the user chose, at the dose they asked for.
 *
 * TB3 leaves supplemental volume to the lifter, so a day may carry more
 * supplemental work than the book lists.
 */
export function addMovement(
  drafts: readonly SeriesSlotDraft[],
  movement: string,
  role: AddedRole,
): SeriesSlotDraft[] {
  if (drafts.some((draft) => draft.movement === movement)) return [...drafts];
  return [...drafts, { movement, role }];
}

/** Append a movement prescribed as accessory work. */
export function addAccessory(
  drafts: readonly SeriesSlotDraft[],
  movement: string,
): SeriesSlotDraft[] {
  return addMovement(drafts, movement, "accessory");
}

/**
 * Add a built-in circuit the template didn't prescribe.
 *
 * All of it or none: the AB Triad is three rounds across three movements, so a
 * partial add would be three loose ab exercises wearing the circuit's name. A
 * session already holding any member is left alone — one triad per day.
 */
export function addGroup(
  drafts: readonly SeriesSlotDraft[],
  group: readonly string[],
  role: AddedRole,
): SeriesSlotDraft[] {
  if (group.length === 0) return [...drafts];
  const present = new Set(drafts.map(slotIdentity));
  if (group.some((movement) => present.has(movement))) return [...drafts];
  return [
    ...drafts,
    ...group.map((movement) => ({ movement, role })),
  ];
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
    ...(draft.role
      ? { role: draft.role }
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
  // The role the user picked wins: a lift they added is shown, and prescribed,
  // at the dose they asked for.
  if (draft.role === "accessory") return "accessory";
  if (draft.role === "supplemental") return "supplemental";
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
    if (identity !== head) return dropped.has(identity) ? [] : [draft];
    // Keep the head's identity either way, so the circuit can still be restored
    // into the row that replaced it. For a circuit the LIFTER added, keep the
    // role too: it fills no template slot, and `slotPayloadEntry` drops the
    // identity for a roled row, so only the wizard ever sees it. Without the
    // role the engine would prescribe the replacement as main work at the
    // main-lift scheme, against a max the lifter has never set.
    return draft.role
      ? [{ sourceMovement: head, movement, role: draft.role }]
      : [{ sourceMovement: head, movement }];
  });
}

/**
 * Put a built-in circuit back.
 *
 * Two ways it can be gone: swapped for a single movement (the head row is still
 * there, holding a different exercise), or removed outright. Restoring means the
 * whole circuit either way — `AB_TRIAD_RULE` prescribes the AB Triad as one
 * unit, so half a triad would print the circuit's instructions against one lift.
 *
 * A circuit restores to the shape it came from: template slots when the template
 * prescribes it, added rows carrying their role when the lifter added it.
 */
export function restoreGroup(
  drafts: readonly SeriesSlotDraft[],
  group: readonly string[],
  slots: readonly TemplateSlot[] = [],
): SeriesSlotDraft[] {
  const [head] = group;
  if (!head) return [...drafts];
  const isTemplateGroup = slots.some((slot) => group.includes(slot.sourceMovement));
  const headRow = drafts.find((draft) => slotIdentity(draft) === head);
  if (headRow) {
    const role = isTemplateGroup ? undefined : headRow.role;
    return drafts.flatMap((draft) =>
      slotIdentity(draft) === head
        ? group.map((source) =>
            role
              ? { movement: source, role }
              : { sourceMovement: source, movement: source },
          )
        : [draft],
    );
  }
  // Removed outright: no row to expand. Only a template circuit can be put back
  // from nothing — an added one has no slot to restore, and is re-added instead.
  if (!isTemplateGroup) return [...drafts];
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
