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
  removeSlot,
  replaceSlot,
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
