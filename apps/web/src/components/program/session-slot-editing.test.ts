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
  addMovement,
  canRemoveRows,
  collapseGroup,
  hasWholeGroup,
  isGroupReplaced,
  orderBySection,
  removeSlot,
  replaceLinkMembers,
  replaceSlot,
  restoreGroup,
  restoreSlot,
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

describe("restoreSlot — putting a removed template lift back", () => {
  // Zulu B: two main lifts and two supplementals. TB3 allows a day to run one
  // supplemental, so dropping to one and back must both be reachable.
  const ZULU_B: TemplateSlot[] = [
    { sourceMovement: "deadlift", role: "main" },
    { sourceMovement: "weighted-pullup", role: "main", kind: "weighted-bw" },
    { sourceMovement: "barbell-row", role: "supplemental" },
    { sourceMovement: "back-extension", role: "supplemental", kind: "unanchored" },
  ];

  it("restores the lift as SUPPLEMENTAL work, not as a main lift", () => {
    const afterRemove = removeSlot(slotDraftsFor(ZULU_B), "back-extension");
    const restored = restoreSlot(afterRemove, ZULU_B, "back-extension");
    const row = restored.find((d) => slotIdentity(d) === "back-extension")!;
    // Slot identity is what the engine matches its prescription rules against:
    // without it the row is a bare movement and gets the main-lift scheme.
    expect(row.sourceMovement).toBe("back-extension");
    expect(sectionOf(ZULU_B, row)).toBe("supplemental");
  });

  it("brings back the slot's own kind", () => {
    const afterRemove = removeSlot(slotDraftsFor(ZULU_B), "weighted-pullup");
    const restored = restoreSlot(afterRemove, ZULU_B, "weighted-pullup");
    expect(restored.find((d) => slotIdentity(d) === "weighted-pullup")).toEqual({
      sourceMovement: "weighted-pullup",
      movement: "weighted-pullup",
      kind: "weighted-bw",
    });
  });

  it("round-trips to exactly the template", () => {
    const start = slotDraftsFor(ZULU_B);
    const restored = restoreSlot(
      removeSlot(start, "barbell-row"),
      ZULU_B,
      "barbell-row",
    );
    expect(restored).toEqual(start);
  });

  it("puts the lift back in template order, not on the end", () => {
    const afterRemove = removeSlot(slotDraftsFor(ZULU_B), "barbell-row");
    const restored = restoreSlot(afterRemove, ZULU_B, "barbell-row");
    expect(restored.map(slotIdentity)).toEqual([
      "deadlift",
      "weighted-pullup",
      "barbell-row",
      "back-extension",
    ]);
  });

  it("keeps a swapped exercise in its slot while restoring a different one", () => {
    const swapped = replaceSlot(slotDraftsFor(ZULU_B), "barbell-row", CURL);
    const restored = restoreSlot(
      removeSlot(swapped, "back-extension"),
      ZULU_B,
      "back-extension",
    );
    expect(restored.find((d) => slotIdentity(d) === "barbell-row")?.movement).toBe(CURL);
  });

  it("leaves work the user added after the template's own lifts", () => {
    const withAccessory = addAccessory(slotDraftsFor(ZULU_B), CURL);
    const restored = restoreSlot(
      removeSlot(withAccessory, "back-extension"),
      ZULU_B,
      "back-extension",
    );
    expect(restored[restored.length - 1]).toEqual({ movement: CURL, role: "accessory" });
  });

  it("is a no-op when the lift is already there", () => {
    const start = slotDraftsFor(ZULU_B);
    expect(restoreSlot(start, ZULU_B, "barbell-row")).toEqual(start);
  });

  it("is a no-op for a movement the template never had", () => {
    const start = slotDraftsFor(ZULU_B);
    expect(restoreSlot(start, ZULU_B, "front-squat")).toEqual(start);
  });

  it("restores a slot whose exercise had been swapped, as the template lift", () => {
    // Swap then remove then restore: the slot comes back canonical, because the
    // template is what a restore restores.
    const swapped = replaceSlot(slotDraftsFor(ZULU_B), "back-extension", CURL);
    const restored = restoreSlot(
      removeSlot(swapped, "back-extension"),
      ZULU_B,
      "back-extension",
    );
    expect(restored.find((d) => slotIdentity(d) === "back-extension")?.movement).toBe(
      "back-extension",
    );
  });
});

describe("restoreGroup — a circuit comes back whole", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"] as const;
  const ZULU_A: TemplateSlot[] = [
    { sourceMovement: "bench", role: "main" },
    { sourceMovement: "squat", role: "main" },
    { sourceMovement: "overhead-press", role: "supplemental" },
    { sourceMovement: "hanging-leg-raise", role: "supplemental" },
    { sourceMovement: "hanging-knee-raise", role: "supplemental" },
    { sourceMovement: "toes-to-bar", role: "supplemental" },
  ];

  it("restores a circuit that was REMOVED, not just one that was swapped", () => {
    // Removal leaves no row to expand, so the swap-only path returned the
    // session unchanged and the circuit was unreachable.
    const withoutTriad = TRIAD.reduce<SeriesSlotDraft[]>(
      (rows, movement) => removeSlot(rows, movement),
      slotDraftsFor(ZULU_A),
    );
    expect(hasWholeGroup(withoutTriad, TRIAD)).toBe(false);
    const restored = restoreGroup(withoutTriad, TRIAD, ZULU_A);
    expect(hasWholeGroup(restored, TRIAD)).toBe(true);
    expect(restored).toEqual(slotDraftsFor(ZULU_A));
  });

  it("still restores a circuit that was swapped for one movement", () => {
    const swapped = collapseGroup(slotDraftsFor(ZULU_A), TRIAD, CURL);
    const restored = restoreGroup(swapped, TRIAD, ZULU_A);
    expect(hasWholeGroup(restored, TRIAD)).toBe(true);
  });

  it("brings the whole circuit back, never part of it", () => {
    // `abRule` prescribes three rounds across all three lifts, so a half
    // restore would state the circuit against one movement.
    const partial = removeSlot(
      removeSlot(slotDraftsFor(ZULU_A), "hanging-knee-raise"),
      "toes-to-bar",
    );
    const restored = restoreGroup(partial, TRIAD, ZULU_A);
    expect(restored.filter((d) => TRIAD.includes(slotIdentity(d) as never))).toHaveLength(3);
  });

  it("puts the circuit back in template order", () => {
    const withoutTriad = TRIAD.reduce<SeriesSlotDraft[]>(
      (rows, movement) => removeSlot(rows, movement),
      slotDraftsFor(ZULU_A),
    );
    expect(restoreGroup(withoutTriad, TRIAD, ZULU_A).map(slotIdentity)).toEqual([
      "bench",
      "squat",
      "overhead-press",
      ...TRIAD,
    ]);
  });

  it("keeps user-added work after the circuit it restores", () => {
    const withAccessory = addAccessory(
      TRIAD.reduce<SeriesSlotDraft[]>(
        (rows, movement) => removeSlot(rows, movement),
        slotDraftsFor(ZULU_A),
      ),
      CURL,
    );
    const restored = restoreGroup(withAccessory, TRIAD, ZULU_A);
    expect(restored[restored.length - 1]).toEqual({ movement: CURL, role: "accessory" });
  });
});

describe("restoreSlot — user-added work never sorts into template order", () => {
  it("keeps an accessory row last even when its movement matches a template slot", () => {
    // A hand-written payload can name a template movement as accessory work.
    // Sorting it into template order would move it out of the accessory section.
    const drafts: SeriesSlotDraft[] = [
      { sourceMovement: "bench", movement: "bench" },
      { movement: "overhead-press", role: "accessory" },
    ];
    const restored = restoreSlot(drafts, SLOTS, "squat");
    expect(restored[restored.length - 1]).toEqual({
      movement: "overhead-press",
      role: "accessory",
    });
    expect(restored.map(slotIdentity)).toEqual(["bench", "squat", "overhead-press"]);
  });
});

describe("addMovement — the dose the user asked for", () => {
  const ZULU_B: TemplateSlot[] = [
    { sourceMovement: "deadlift", role: "main" },
    { sourceMovement: "barbell-row", role: "supplemental" },
  ];

  it("records supplemental work as supplemental, not as accessory", () => {
    const [added] = addMovement([], CURL, "supplemental").slice(-1);
    expect(added).toEqual({ movement: CURL, role: "supplemental" });
  });

  it("shows added supplemental work in the supplemental section", () => {
    const drafts = addMovement(slotDraftsFor(ZULU_B), CURL, "supplemental");
    const added = drafts.find((d) => d.movement === CURL)!;
    expect(sectionOf(ZULU_B, added)).toBe("supplemental");
  });

  it("shows added accessory work in the accessory section", () => {
    const drafts = addMovement(slotDraftsFor(ZULU_B), CURL, "accessory");
    expect(sectionOf(ZULU_B, drafts.find((d) => d.movement === CURL)!)).toBe("accessory");
  });

  it("sends the role to the engine so the dose survives deploy", () => {
    const supplemental = addMovement([], CURL, "supplemental")[0]!;
    expect(slotPayloadEntry(supplemental, undefined)).toMatchObject({
      movement: CURL,
      role: "supplemental",
    });
  });

  it("never lets added work claim a template slot", () => {
    // `slotOf` returning a slot would give the row that slot's prescription and
    // let it be promoted into a peak attempt.
    const added = addMovement([], "barbell-row", "supplemental")[0]!;
    expect(slotOf(ZULU_B, added)).toBeUndefined();
    expect(slotPayloadEntry(added, undefined).sourceMovement).toBeUndefined();
  });

  it("lets a day carry more supplemental work than the template lists", () => {
    // TB3 leaves supplemental volume to the lifter.
    const drafts = addMovement(
      addMovement(slotDraftsFor(ZULU_B), CURL, "supplemental"),
      "catalog:00000000-0000-4000-8000-0000000000c2",
      "supplemental",
    );
    expect(
      drafts.filter((d) => sectionOf(ZULU_B, d) === "supplemental"),
    ).toHaveLength(3);
  });

  it("does not add the same movement twice", () => {
    const once = addMovement(slotDraftsFor(ZULU_B), CURL, "supplemental");
    expect(addMovement(once, CURL, "accessory")).toEqual(once);
  });

  it("keeps added supplemental work after the template's own rows on restore", () => {
    const withAdded = addMovement(slotDraftsFor(ZULU_B), CURL, "supplemental");
    const restored = restoreSlot(
      removeSlot(withAdded, "barbell-row"),
      ZULU_B,
      "barbell-row",
    );
    expect(restored.map((d) => d.movement)).toEqual(["deadlift", "barbell-row", CURL]);
  });
});
