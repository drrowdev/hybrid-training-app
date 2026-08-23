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
