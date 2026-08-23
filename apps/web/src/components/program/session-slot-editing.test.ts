/**
 * Editing rules for a Tactical Barbell session's movement list.
 *
 * Every case here is a bug that reached review. The two that mattered most:
 * mutating a session the user hadn't touched wiped the template's own lifts,
 * and re-deriving "this is accessory work" from a missing slot demoted a
 * pre-slot customization's main lifts to 3×12.
 */
import { describe, it, expect } from "vitest";
import {
  addAccessory,
  canRemoveRows,
  collapseGroup,
  hasWholeGroup,
  isGroupReplaced,
  orderBySection,
  removeSlot,
  replaceLinkMembers,
  replaceSlot,
  restoreGroup,
  sectionOf,
  seededDrafts,
  slotDraftsFor,
  slotIdentity,
  slotOf,
  slotPayloadEntry,
  slotsEdited,
  type SeriesSlotDraft,
  type TemplateSlot,
} from "./session-slot-editing";

// Zulu day A: two main lifts plus a supplemental press.
const SLOTS: TemplateSlot[] = [
  { sourceMovement: "bench", role: "main" },
  { sourceMovement: "squat", role: "main" },
  { sourceMovement: "overhead-press", role: "supplemental" },
];

const CURL = "catalog:00000000-0000-4000-8000-0000000000c1";

describe("slotDraftsFor / slotIdentity / slotOf", () => {
  it("turns a template's slots into rows that each fill their own slot", () => {
    expect(slotDraftsFor(SLOTS)).toEqual([
      { sourceMovement: "bench", movement: "bench" },
      { sourceMovement: "squat", movement: "squat" },
      { sourceMovement: "overhead-press", movement: "overhead-press" },
    ]);
  });

  it("reads a row with no slot as filling the slot of its own movement", () => {
    // How a customization written before slots existed has to be read.
    expect(slotIdentity({ movement: "squat" })).toBe("squat");
    expect(slotOf(SLOTS, { movement: "squat" })?.role).toBe("main");
  });

  it("keeps the slot through a swap", () => {
    const swapped: SeriesSlotDraft = {
      sourceMovement: "overhead-press",
      movement: CURL,
    };
    expect(slotIdentity(swapped)).toBe("overhead-press");
    expect(slotOf(SLOTS, swapped)?.role).toBe("supplemental");
  });

  it("never matches accessory work to a slot", () => {
    // Even when the movement key happens to be a template lift.
    expect(slotOf(SLOTS, { movement: "squat", role: "accessory" })).toBeUndefined();
  });
});

describe("seededDrafts", () => {
  it("falls back to the template when the session has not been touched", () => {
    expect(seededDrafts(undefined, SLOTS)).toEqual(slotDraftsFor(SLOTS));
  });

  it("treats an emptied session as emptied, not untouched", () => {
    expect(seededDrafts([], SLOTS)).toEqual([]);
  });
});

describe("editing a session that has not been seeded", () => {
  // The first Remove or Change used to start from an empty list, which deleted
  // every lift in the session and left the wizard unable to deploy.
  it("removing one lift keeps the rest of the template's lifts", () => {
    const next = removeSlot(seededDrafts(undefined, SLOTS), "overhead-press");
    expect(next.map((draft) => draft.movement)).toEqual(["bench", "squat"]);
  });

  it("changing one lift keeps the rest of the template's lifts", () => {
    const next = replaceSlot(
      seededDrafts(undefined, SLOTS),
      "overhead-press",
      CURL,
    );
    expect(next.map((draft) => draft.movement)).toEqual([
      "bench",
      "squat",
      CURL,
    ]);
    expect(next[2]).toMatchObject({ sourceMovement: "overhead-press" });
  });

  it("adding an accessory keeps the rest of the template's lifts", () => {
    const next = addAccessory(seededDrafts(undefined, SLOTS), CURL);
    expect(next.map((draft) => draft.movement)).toEqual([
      "bench",
      "squat",
      "overhead-press",
      CURL,
    ]);
    expect(next[3]).toMatchObject({ role: "accessory" });
  });

  it("does not add the same movement twice", () => {
    const once = addAccessory(slotDraftsFor(SLOTS), CURL);
    expect(addAccessory(once, CURL)).toEqual(once);
  });
});

describe("slotPayloadEntry", () => {
  it("claims the slot a row fills", () => {
    const [bench] = slotDraftsFor(SLOTS);
    expect(slotPayloadEntry(bench!, slotOf(SLOTS, bench!))).toEqual({
      movement: "bench",
      sourceMovement: "bench",
    });
  });

  it("keeps the slot when the exercise was swapped", () => {
    const swapped = replaceSlot(slotDraftsFor(SLOTS), "overhead-press", CURL)[2]!;
    expect(
      slotPayloadEntry(swapped, slotOf(SLOTS, swapped), {
        id: "00000000-0000-4000-8000-0000000000c1",
        slug: "bb-curl",
        name: "Barbell Curl",
      }),
    ).toMatchObject({
      movement: CURL,
      sourceMovement: "overhead-press",
      movementId: "00000000-0000-4000-8000-0000000000c1",
    });
  });

  it("marks a movement the user added as accessory work", () => {
    const added = addAccessory(slotDraftsFor(SLOTS), CURL)[3]!;
    const entry = slotPayloadEntry(added, slotOf(SLOTS, added));
    expect(entry.role).toBe("accessory");
    expect(entry.sourceMovement).toBeUndefined();
  });

  it("leaves a pre-slot customization's own lift as main work", () => {
    // The critical regression: a lift swapped under the OLD flow has no slot and
    // no role, and its movement key is a catalog id that matches no slot. It must
    // stay unclaimed — deriving "accessory" from the missing slot turned a
    // loaded main lift into an unloaded 3×12 on the next edit.
    const legacy: SeriesSlotDraft = { movement: CURL };
    const entry = slotPayloadEntry(legacy, slotOf(SLOTS, legacy));
    expect(entry.role).toBeUndefined();
    expect(entry.sourceMovement).toBeUndefined();
  });

  it("carries the bodyweight loading a pull-up needs", () => {
    expect(
      slotPayloadEntry({ movement: "weighted-pullup" }, undefined).kind,
    ).toBe("weighted-bw");
    expect(slotPayloadEntry({ movement: "pullup" }, undefined).kind).toBe(
      "bodyweight",
    );
  });
});

describe("canRemoveRows", () => {
  it("allows a removal that leaves at least one lift", () => {
    expect(canRemoveRows(3, 1)).toBe(true);
    expect(canRemoveRows(2, 1)).toBe(true);
  });

  it("refuses a removal that would empty the session", () => {
    expect(canRemoveRows(1, 1)).toBe(false);
  });

  it("counts every row a single click drops", () => {
    // The AB Triad renders as one row but removes three. Counting rows on
    // screen let a session with only the triad left be emptied in one click,
    // which then blocked deploy with nothing on screen to explain it.
    expect(canRemoveRows(3, 3)).toBe(false);
    expect(canRemoveRows(4, 3)).toBe(true);
  });
});

describe("sections", () => {
  const TRIAD_SLOTS: TemplateSlot[] = [
    ...SLOTS,
    { sourceMovement: "hanging-leg-raise", role: "supplemental" },
    { sourceMovement: "hanging-knee-raise", role: "supplemental" },
    { sourceMovement: "toes-to-bar", role: "supplemental" },
  ];

  it("sorts a row into the section it is run in", () => {
    expect(sectionOf(SLOTS, { movement: "bench" })).toBe("main");
    expect(sectionOf(SLOTS, { movement: "overhead-press" })).toBe(
      "supplemental",
    );
    expect(sectionOf(SLOTS, { movement: CURL, role: "accessory" })).toBe(
      "accessory",
    );
  });

  it("treats a pre-slot row it cannot place as main work, matching the engine", () => {
    expect(sectionOf(SLOTS, { movement: CURL })).toBe("main");
  });

  it("orders main, then supplemental, then what the user added", () => {
    const drafts = addAccessory(
      [
        { sourceMovement: "overhead-press", movement: "overhead-press" },
        { sourceMovement: "bench", movement: "bench" },
      ],
      CURL,
    );
    expect(
      orderBySection(drafts, SLOTS).map((draft) => draft.movement),
    ).toEqual(["bench", "overhead-press", CURL]);
  });

  it("leaves a template that is already in that order untouched", () => {
    const canonical = slotDraftsFor(TRIAD_SLOTS);
    expect(orderBySection(canonical, TRIAD_SLOTS)).toEqual(canonical);
  });
});

describe("swapping a built-in circuit", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const withTriad = (): SeriesSlotDraft[] => [
    { sourceMovement: "bench", movement: "bench" },
    ...TRIAD.map((source) => ({ sourceMovement: source, movement: source })),
  ];

  it("replaces the whole circuit with one movement, keeping its place", () => {
    const next = collapseGroup(withTriad(), TRIAD, CURL);
    expect(next.map((draft) => draft.movement)).toEqual(["bench", CURL]);
    expect(next[1]).toMatchObject({ sourceMovement: "hanging-leg-raise" });
  });

  it("puts the circuit back where it was", () => {
    const collapsed = collapseGroup(withTriad(), TRIAD, CURL);
    expect(restoreGroup(collapsed, TRIAD)).toEqual(withTriad());
  });

  it("knows when the circuit is whole, swapped, or gone", () => {
    const whole = withTriad();
    const collapsed = collapseGroup(whole, TRIAD, CURL);
    const removed = TRIAD.reduce(
      (drafts, source) => removeSlot(drafts, source),
      whole as SeriesSlotDraft[],
    );

    expect(hasWholeGroup(whole, TRIAD)).toBe(true);
    expect(isGroupReplaced(whole, TRIAD)).toBe(false);
    expect(hasWholeGroup(collapsed, TRIAD)).toBe(false);
    expect(isGroupReplaced(collapsed, TRIAD)).toBe(true);
    expect(isGroupReplaced(removed, TRIAD)).toBe(false);
  });
});

describe("replaceLinkMembers", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];

  it("moves a link off a circuit that was swapped for one movement", () => {
    // Left alone, the link would name two lifts the session no longer has, and
    // the engine drops a link with a missing member — the superset would vanish.
    const links = [{ id: "l1", name: "Superset", members: ["bench", ...TRIAD] }];
    expect(replaceLinkMembers(links, TRIAD, [TRIAD[0]!])).toEqual([
      { id: "l1", name: "Superset", members: ["bench", "hanging-leg-raise"] },
    ]);
  });

  it("puts the circuit's members back when it is restored", () => {
    const links = [
      { id: "l1", name: "Superset", members: ["bench", "hanging-leg-raise"] },
    ];
    expect(replaceLinkMembers(links, [TRIAD[0]!], TRIAD)).toEqual([
      { id: "l1", name: "Superset", members: ["bench", ...TRIAD] },
    ]);
  });

  it("leaves a link that never ran the circuit alone", () => {
    const links = [{ id: "l1", name: "Superset", members: ["bench", "squat"] }];
    expect(replaceLinkMembers(links, TRIAD, [TRIAD[0]!])).toEqual(links);
  });

  it("keeps the position the circuit held in the order", () => {
    const links = [
      { id: "l1", name: "Tri-set", members: [...TRIAD, "bench", "squat"] },
    ];
    expect(replaceLinkMembers(links, TRIAD, [TRIAD[0]!])[0]!.members).toEqual([
      "hanging-leg-raise",
      "bench",
      "squat",
    ]);
  });

  it("dissolves a link the swap would leave with one lift", () => {
    // Reachable: superset the press with the triad, remove the press, then
    // change the triad. Left as-is the link becomes a single member, which the
    // deploy schema rejects outright — failing the whole submission with a
    // message that names neither the link nor the session.
    const links = [{ id: "l1", name: "Superset", members: [...TRIAD] }];
    expect(replaceLinkMembers(links, TRIAD, [TRIAD[0]!])).toEqual([]);
  });

  it("dissolves a link too full to take the circuit back", () => {
    const members = ["hanging-leg-raise", "a", "b", "c", "d", "e", "f"];
    const links = [{ id: "l1", name: "Giant set", members }];
    // 7 + 2 = 9 > 8. Left in place it would name only the circuit's first slot
    // while the session ran all three, and the engine drops a link that claims
    // part of a circuit — so it would promise a superset that never runs.
    expect(replaceLinkMembers(links, [TRIAD[0]!], TRIAD)).toEqual([]);
    // One fewer member and the restore fits.
    const fits = [{ id: "l1", name: "Giant set", members: members.slice(0, 6) }];
    expect(replaceLinkMembers(fits, [TRIAD[0]!], TRIAD)[0]!.members).toHaveLength(
      8,
    );
  });
});

describe("slotsEdited", () => {
  it("is false for an untouched session", () => {
    expect(slotsEdited(undefined, SLOTS)).toBe(false);
    expect(slotsEdited(slotDraftsFor(SLOTS), SLOTS)).toBe(false);
  });

  it("is true once a lift is swapped, removed or added", () => {
    expect(
      slotsEdited(replaceSlot(slotDraftsFor(SLOTS), "squat", CURL), SLOTS),
    ).toBe(true);
    expect(slotsEdited(removeSlot(slotDraftsFor(SLOTS), "squat"), SLOTS)).toBe(
      true,
    );
    expect(slotsEdited(addAccessory(slotDraftsFor(SLOTS), CURL), SLOTS)).toBe(
      true,
    );
  });

  it("is true when two lifts change places", () => {
    const swapped: SeriesSlotDraft[] = [
      { sourceMovement: "bench", movement: "squat" },
      { sourceMovement: "squat", movement: "bench" },
      { sourceMovement: "overhead-press", movement: "overhead-press" },
    ];
    expect(slotsEdited(swapped, SLOTS)).toBe(true);
  });
});
