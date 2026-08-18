/**
 * Session-link editing logic.
 *
 * The web test environment is Node with no DOM, so interaction behaviour lives
 * in these pure helpers and is exercised directly; the component is covered by a
 * separate static-render test.
 */
import { describe, expect, it } from "vitest";
import type { SessionLink } from "@/lib/platform/session-links";
import {
  activationLinkableMovements,
  addLink,
  canCreateLink,
  linkHasMainLift,
  linkStations,
  linkedKeys,
  linksIncludeMainLift,
  moveStation,
  nextLinkId,
  pruneLinksToMovements,
  pruneMovementFromLinks,
  removeLink,
  selectableMovements,
  slotLabels,
  slotLinkBadges,
  slotsOf,
  toggleSelection,
  type LinkableMovement,
} from "./session-link-editing";

const MOVEMENTS: LinkableMovement[] = [
  { key: "squat", label: "Squat", isMain: true },
  { key: "bench", label: "Bench press", isMain: true },
  { key: "catalog:1", label: "Barbell curl" },
  { key: "catalog:2", label: "Triceps pushdown" },
];

const TRIAD_LOCK = "The AB Triad is already linked as a circuit.";
const WITH_TRIAD: LinkableMovement[] = [
  { key: "squat", label: "Squat", isMain: true },
  { key: "hanging-leg-raise", label: "Hanging leg raise", lockedReason: TRIAD_LOCK },
  { key: "hanging-knee-raise", label: "Hanging knee raise", lockedReason: TRIAD_LOCK },
  { key: "toes-to-bar", label: "Toes to bar", lockedReason: TRIAD_LOCK },
  { key: "catalog:1", label: "Barbell curl" },
];

const link = (id: string, members: string[], name = "Superset"): SessionLink => ({
  id,
  name,
  members,
});

describe("selectableMovements", () => {
  it("offers everything when nothing is linked", () => {
    expect(selectableMovements(MOVEMENTS, []).map((m) => m.key)).toEqual([
      "squat",
      "bench",
      "catalog:1",
      "catalog:2",
    ]);
  });

  it("hides movements already inside a link — circuit is singular", () => {
    const links = [link("link-1", ["catalog:1", "catalog:2"])];
    expect(selectableMovements(MOVEMENTS, links).map((m) => m.key)).toEqual([
      "squat",
      "bench",
    ]);
  });

  it("never offers a locked AB Triad movement", () => {
    expect(selectableMovements(WITH_TRIAD, []).map((m) => m.key)).toEqual([
      "squat",
      "catalog:1",
    ]);
  });

  it("linkedKeys collects every claimed member", () => {
    const links = [link("link-1", ["a", "b"]), link("link-2", ["c", "d"])];
    expect([...linkedKeys(links)].sort()).toEqual(["a", "b", "c", "d"]);
  });
});

describe("canCreateLink", () => {
  it("needs at least two members", () => {
    expect(canCreateLink([], [], MOVEMENTS)).toBe(false);
    expect(canCreateLink(["squat"], [], MOVEMENTS)).toBe(false);
    expect(canCreateLink(["squat", "bench"], [], MOVEMENTS)).toBe(true);
  });

  it("refuses a selection whose movements aren't in the slot", () => {
    expect(canCreateLink(["ghost-a", "ghost-b"], [], MOVEMENTS)).toBe(false);
  });

  it("refuses past the member cap", () => {
    const many: LinkableMovement[] = Array.from({ length: 9 }, (_, i) => ({
      key: `m${i}`,
      label: `M${i}`,
    }));
    expect(canCreateLink(many.map((m) => m.key), [], many)).toBe(false);
  });

  it("refuses past the per-slot link cap", () => {
    const six = Array.from({ length: 6 }, (_, i) => link(`link-${i}`, ["x", "y"]));
    expect(canCreateLink(["squat", "bench"], six, MOVEMENTS)).toBe(false);
  });
});

describe("addLink", () => {
  it("stores members in SLOT order, not selection order", () => {
    const linked = addLink([], MOVEMENTS, ["catalog:2", "squat"]);
    expect(linked[0]!.members).toEqual(["squat", "catalog:2"]);
  });

  it("names by size", () => {
    expect(addLink([], MOVEMENTS, ["squat", "bench"])[0]!.name).toBe("Superset");
    expect(
      addLink([], MOVEMENTS, ["squat", "bench", "catalog:1"])[0]!.name,
    ).toBe("Tri-set");
    expect(
      addLink([], MOVEMENTS, ["squat", "bench", "catalog:1", "catalog:2"])[0]!
        .name,
    ).toBe("Giant set");
  });

  it("refuses to include a locked movement", () => {
    const out = addLink([], WITH_TRIAD, ["squat", "toes-to-bar"]);
    // Only one usable member survives the filter, so no link is formed.
    expect(out).toEqual([]);
  });

  it("appends without disturbing existing links", () => {
    const existing = [link("link-1", ["catalog:1", "catalog:2"])];
    const out = addLink(existing, MOVEMENTS, ["squat", "bench"]);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual(existing[0]);
    expect(out[1]!.id).toBe("link-2");
  });

  it("returns the input when the selection is too small", () => {
    const existing = [link("link-1", ["a", "b"])];
    expect(addLink(existing, MOVEMENTS, ["squat"])).toEqual(existing);
  });
});

describe("nextLinkId", () => {
  it("starts at link-1", () => {
    expect(nextLinkId([])).toBe("link-1");
  });

  it("skips ids already in use", () => {
    expect(nextLinkId([link("link-1", ["a", "b"])])).toBe("link-2");
    expect(
      nextLinkId([link("link-2", ["a", "b"]), link("link-3", ["c", "d"])]),
    ).toBe("link-4");
  });
});

describe("removeLink", () => {
  it("drops only the named link", () => {
    const links = [link("link-1", ["a", "b"]), link("link-2", ["c", "d"])];
    expect(removeLink(links, "link-1")).toEqual([links[1]]);
    expect(removeLink(links, "nope")).toEqual(links);
  });
});

describe("toggleSelection", () => {
  it("adds and removes", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a"], "a")).toEqual([]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("stops at the member cap but still allows deselection", () => {
    const eight = Array.from({ length: 8 }, (_, i) => `m${i}`);
    expect(toggleSelection(eight, "m9")).toEqual(eight);
    expect(toggleSelection(eight, "m0")).toHaveLength(7);
  });
});

describe("main-lift detection (DC-K4)", () => {
  it("flags a link containing a main lift", () => {
    expect(
      linksIncludeMainLift([link("link-1", ["squat", "catalog:1"])], MOVEMENTS),
    ).toBe(true);
  });

  it("does not flag an accessory-only link", () => {
    expect(
      linksIncludeMainLift(
        [link("link-1", ["catalog:1", "catalog:2"])],
        MOVEMENTS,
      ),
    ).toBe(false);
  });

  it("flags per link", () => {
    const a = link("link-1", ["catalog:1", "catalog:2"]);
    const b = link("link-2", ["squat", "bench"]);
    expect(linkHasMainLift(a, MOVEMENTS)).toBe(false);
    expect(linkHasMainLift(b, MOVEMENTS)).toBe(true);
  });
});

describe("activationLinkableMovements", () => {
  // Activation has fixed program slots rather than a movement list, so its
  // linkable set is derived differently — but the members are still canonical
  // slot ids, which is what lets a link survive swapping the exercise.
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const label = (key: string) => `LBL:${key}`;

  const build = (
    slots: Array<string | { sourceMovement: string; role: "main" | "supplemental" }>,
    selected: Record<string, string | null>,
  ) =>
    activationLinkableMovements({
      slots: slots.map((slot) =>
        typeof slot === "string" ? { sourceMovement: slot } : slot,
      ),
      selected,
      labelOf: label,
      builtinCircuitSources: TRIAD,
      builtinCircuitLabel: "AB Triad",
      builtinCircuitKey: "group:tb-ab-triad",
    });

  it("keys members by the canonical slot, not the movement filling it", () => {
    const out = build(["bench", "barbell-row"], {
      bench: "catalog:99",
      "barbell-row": "barbell-row",
    });
    expect(out.map((m) => m.key)).toEqual(["bench", "barbell-row"]);
    // Label follows the CURRENT exercise; identity does not.
    expect(out[0]!.label).toBe("LBL:catalog:99");
  });

  it("omits a removed slot", () => {
    const out = build(["bench", "barbell-row", "pullup"], {
      bench: "bench",
      "barbell-row": null,
      pullup: "pullup",
    });
    expect(out.map((m) => m.key)).toEqual(["bench", "pullup"]);
  });

  it("takes main-vs-supplemental from the slot's role, not the phase", () => {
    // Activation's Armor days mix both: bench is tested, the overhead press and
    // pull-ups are supplemental. Assuming every Activation slot is a main lift
    // warned about supersets that carry no main lift at all.
    const out = build(
      [
        { sourceMovement: "bench", role: "main" },
        { sourceMovement: "overhead-press", role: "supplemental" },
        { sourceMovement: "pullup", role: "supplemental" },
      ],
      { bench: "bench", "overhead-press": "overhead-press", pullup: "pullup" },
    );
    expect(out.map((m) => m.isMain)).toEqual([true, false, false]);
    const link = addLink([], out, ["overhead-press", "pullup"]);
    expect(linksIncludeMainLift(link, out)).toBe(false);
  });

  it("treats a slot with no stated role as a main lift", () => {
    const out = build(["bench"], { bench: "bench" });
    expect(out[0]!.isMain).toBe(true);
  });

  it("does not warn for the AB Triad — it is accessory core work", () => {
    const slots = ["back-extension", ...TRIAD];
    const selected = Object.fromEntries(slots.map((s) => [s, s]));
    const out = build(
      slots.map((sourceMovement) => ({
        sourceMovement,
        role: "supplemental" as const,
      })),
      selected,
    );
    const link = addLink([], out, ["back-extension", "group:tb-ab-triad"]);
    expect(link[0]!.members).toHaveLength(4);
    expect(linksIncludeMainLift(link, out)).toBe(false);
  });

  it("offers the complete AB Triad as ONE entry, not three", () => {
    // Supersetting "with the AB Triad" means a circuit that includes all three
    // of its stations, so it is picked as a unit.
    const slots = ["back-extension", ...TRIAD];
    const selected = Object.fromEntries(slots.map((s) => [s, s]));
    const out = build(slots, selected);
    expect(out.map((m) => m.label)).toEqual(["LBL:back-extension", "AB Triad"]);
    const triadEntry = out[1]!;
    expect(triadEntry.expandsTo?.map((slot) => slot.key)).toEqual(TRIAD);
    expect(triadEntry.lockedReason).toBeUndefined();
  });

  it("gives every expanded triad slot its own name", () => {
    // The link is displayed member by member, so a slot without a label shows
    // its raw id ("toes-to-bar") next to a sibling wearing the group's name.
    const slots = ["back-extension", ...TRIAD];
    const selected = Object.fromEntries(slots.map((s) => [s, s]));
    const out = build(slots, selected);
    expect(slotLabels(out)).toEqual(
      new Map([
        ["back-extension", "LBL:back-extension"],
        ["hanging-leg-raise", "LBL:hanging-leg-raise"],
        ["hanging-knee-raise", "LBL:hanging-knee-raise"],
        ["toes-to-bar", "LBL:toes-to-bar"],
      ]),
    );
  });

  it("labels a triad slot by the movement now filling it", () => {
    const slots = ["back-extension", ...TRIAD];
    const selected: Record<string, string | null> = Object.fromEntries(
      slots.map((s) => [s, s]),
    );
    selected["toes-to-bar"] = "catalog:77";
    const out = build(slots, selected);
    expect(slotLabels(out).get("toes-to-bar")).toBe("LBL:catalog:77");
  });

  it("lists the triad's movements individually when it is incomplete", () => {
    const slots = ["squat", "hanging-leg-raise", "toes-to-bar"];
    const selected = Object.fromEntries(slots.map((s) => [s, s]));
    const out = build(slots, selected);
    expect(out.map((m) => m.key)).toEqual(slots);
    expect(out.every((m) => m.expandsTo == null)).toBe(true);
  });

  it("breaks the triad up once one of its slots is removed", () => {
    const slots = ["squat", ...TRIAD];
    const selected: Record<string, string | null> = Object.fromEntries(
      slots.map((s) => [s, s]),
    );
    selected["toes-to-bar"] = null;
    const out = build(slots, selected);
    expect(out.map((m) => m.key)).toEqual([
      "squat",
      "hanging-leg-raise",
      "hanging-knee-raise",
    ]);
    expect(out.every((m) => m.expandsTo == null)).toBe(true);
  });

  it("preserves session order", () => {
    const out = build(["c", "a", "b"], { a: "a", b: "b", c: "c" });
    expect(out.map((m) => m.key)).toEqual(["c", "a", "b"]);
  });

  it("returns nothing when every slot is removed", () => {
    expect(build(["a", "b"], { a: null, b: null })).toEqual([]);
  });
});

describe("group entries expand into their slots", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const GROUP_KEY = "group:tb-ab-triad";
  const WITH_GROUP: LinkableMovement[] = [
    { key: "back-extension", label: "Back Extension", isMain: true },
    {
      key: GROUP_KEY,
      label: "AB Triad",
      expandsTo: [
        { key: TRIAD[0]!, label: "Hanging Leg Raise" },
        { key: TRIAD[1]!, label: "Hanging Knee Raise" },
        { key: TRIAD[2]!, label: "Toes to Bar" },
      ],
    },
    { key: "catalog:1", label: "Barbell curl" },
  ];

  it("keys the group row separately from its members", () => {
    // Reusing a member's id as the row id made that member render as "AB Triad"
    // while its siblings fell back to raw slugs.
    expect(slotsOf(WITH_GROUP[1]!)).toEqual(TRIAD);
    expect(slotsOf(WITH_GROUP[1]!)).not.toContain(GROUP_KEY);
    expect(slotLabels(WITH_GROUP).get(TRIAD[0]!)).toBe("Hanging Leg Raise");
    expect(slotLabels(WITH_GROUP).has(GROUP_KEY)).toBe(false);
  });

  it("links a lift with the whole triad as one circuit", () => {
    const out = addLink([], WITH_GROUP, ["back-extension", GROUP_KEY]);
    expect(out[0]!.members).toEqual(["back-extension", ...TRIAD]);
    // Two STATIONS, four slots: the triad is one thing to the lifter, so this
    // is a superset — calling it a giant set describes the engine, not the work.
    expect(out[0]!.name).toBe("Superset");
  });

  it("names a link by stations, counting a group as one", () => {
    const withCurl = addLink([], WITH_GROUP, [
      "back-extension",
      GROUP_KEY,
      "catalog:1",
    ]);
    // Three stations (five slots) -> tri-set.
    expect(withCurl[0]!.name).toBe("Tri-set");
    expect(withCurl[0]!.members).toHaveLength(5);
  });

  it("counts expanded slots against the member cap", () => {
    // Two picks, four resulting stations — still valid.
    expect(canCreateLink(["back-extension", GROUP_KEY], [], WITH_GROUP)).toBe(
      true,
    );
    // A single pick is never a link, even when it expands to three.
    expect(canCreateLink([GROUP_KEY], [], WITH_GROUP)).toBe(false);
  });

  it("withholds the group once any of its slots is linked", () => {
    const links = [link("link-1", ["back-extension", ...TRIAD], "Giant set")];
    expect(selectableMovements(WITH_GROUP, links).map((m) => m.key)).toEqual([
      "catalog:1",
    ]);
  });

  it("keeps a link whose members live inside a group row", () => {
    // Pruning matches SLOTS; matching row keys would have dissolved every link
    // that contains the triad the moment the movement list was re-derived.
    const links = [link("link-1", ["back-extension", ...TRIAD], "Giant set")];
    expect(pruneLinksToMovements(links, WITH_GROUP)).toEqual(links);
  });

  it("expands in slot order regardless of pick order", () => {
    const out = addLink([], WITH_GROUP, [GROUP_KEY, "back-extension"]);
    expect(out[0]!.members).toEqual(["back-extension", ...TRIAD]);
  });
});

describe("pruning links when lifts leave the slot", () => {
  // Without this a link keeps a member the session no longer has. The engine
  // requires every member to be present, so it would drop the whole link at
  // materialisation and the superset would vanish with nothing having said so.
  const links = [
    link("link-1", ["squat", "bench", "catalog:1"], "Tri-set"),
    link("link-2", ["catalog:2", "catalog:3"]),
  ];

  it("removes the lift but keeps a link that still has two members", () => {
    const out = pruneMovementFromLinks(links, "bench");
    expect(out).toHaveLength(2);
    expect(out[0]!.members).toEqual(["squat", "catalog:1"]);
  });

  it("dissolves a link left with a single member", () => {
    const out = pruneMovementFromLinks(links, "catalog:2");
    expect(out.map((l) => l.id)).toEqual(["link-1"]);
  });

  it("leaves links untouched when the lift is in none of them", () => {
    expect(pruneMovementFromLinks(links, "deadlift")).toEqual(links);
  });

  it("prunes to whatever the slot still offers", () => {
    const remaining: LinkableMovement[] = [
      { key: "squat", label: "Squat", isMain: true },
      { key: "catalog:1", label: "Barbell curl" },
    ];
    const out = pruneLinksToMovements(links, remaining);
    // link-2 loses both members and dissolves; link-1 keeps the two that remain.
    expect(out).toHaveLength(1);
    expect(out[0]!.members).toEqual(["squat", "catalog:1"]);
  });

  it("dissolves everything when the slot is emptied", () => {
    expect(pruneLinksToMovements(links, [])).toEqual([]);
  });

  it("preserves member order while pruning", () => {
    const ordered = [link("link-1", ["c", "a", "b"], "Tri-set")];
    expect(pruneMovementFromLinks(ordered, "a")[0]!.members).toEqual(["c", "b"]);
  });
});

describe("moveStation — plain lifts (one slot per station)", () => {
  const links = [
    link("link-1", ["squat", "bench", "catalog:1"], "Tri-set"),
    link("link-2", ["catalog:2", "catalog:3"]),
  ];
  const rows: LinkableMovement[] = [
    { key: "squat", label: "Squat" },
    { key: "bench", label: "Bench" },
    { key: "catalog:1", label: "Curl" },
    { key: "catalog:2", label: "Pushdown" },
    { key: "catalog:3", label: "Raise" },
  ];
  const move = (id: string, index: number, dir: -1 | 1) =>
    moveStation(links, id, index, dir, rows);

  it("moves a station earlier", () => {
    expect(move("link-1", 1, -1)[0]!.members).toEqual([
      "bench",
      "squat",
      "catalog:1",
    ]);
  });

  it("moves a station later", () => {
    expect(move("link-1", 0, 1)[0]!.members).toEqual([
      "bench",
      "squat",
      "catalog:1",
    ]);
  });

  it("moves across the whole group, not just by swapping neighbours", () => {
    // Last -> first, one step at a time, ends up fully reversed at the front.
    let out = moveStation(links, "link-1", 2, -1, rows);
    out = moveStation(out, "link-1", 1, -1, rows);
    expect(out[0]!.members).toEqual(["catalog:1", "squat", "bench"]);
  });

  it("refuses to move the first station earlier", () => {
    expect(move("link-1", 0, -1)[0]!.members).toEqual(links[0]!.members);
  });

  it("refuses to move the last station later", () => {
    expect(move("link-1", 2, 1)[0]!.members).toEqual(links[0]!.members);
  });

  it("ignores an out-of-range index", () => {
    expect(move("link-1", 9, -1)[0]!.members).toEqual(links[0]!.members);
    expect(move("link-1", -1, 1)[0]!.members).toEqual(links[0]!.members);
  });

  it("leaves other links untouched", () => {
    expect(move("link-1", 0, 1)[1]).toEqual(links[1]);
  });

  it("is a no-op for an unknown link id", () => {
    expect(move("nope", 0, 1)).toEqual(links);
  });

  it("never drops or duplicates a member", () => {
    const out = move("link-1", 1, -1);
    expect([...out[0]!.members].sort()).toEqual([...links[0]!.members].sort());
    expect(new Set(out[0]!.members).size).toBe(out[0]!.members.length);
  });
});
describe("stations — what the lifter picked, not what the engine stores", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const GROUP_KEY = "group:tb-ab-triad";
  const ROWS: LinkableMovement[] = [
    { key: "back-extension", label: "Back Extension" },
    {
      key: GROUP_KEY,
      label: "AB Triad",
      expandsTo: [
        { key: TRIAD[0]!, label: "Hanging Leg Raise" },
        { key: TRIAD[1]!, label: "Hanging Knee Raise" },
        { key: TRIAD[2]!, label: "Toes to Bar" },
      ],
    },
    { key: "catalog:1", label: "Barbell curl" },
  ];

  it("collapses a group's slots back into the one row that was picked", () => {
    // The reported bug: picking two things rendered A1-A4 and read as a giant
    // set. Two picks must display as two stations.
    const [linked] = addLink([], ROWS, ["back-extension", GROUP_KEY]);
    const stations = linkStations(linked!, ROWS);
    expect(stations.map((s) => s.label)).toEqual(["Back Extension", "AB Triad"]);
    expect(stations).toHaveLength(2);
    // The stored members are untouched — the engine still gets four slots.
    expect(linked!.members).toEqual(["back-extension", ...TRIAD]);
  });

  it("keeps one station per plain lift", () => {
    const [linked] = addLink([], ROWS, ["back-extension", "catalog:1"]);
    expect(linkStations(linked!, ROWS).map((s) => s.slots)).toEqual([
      ["back-extension"],
      ["catalog:1"],
    ]);
  });

  it("does not fold a group whose slots got separated", () => {
    // Folding non-contiguous slots would claim a running order the engine will
    // not actually use.
    const split = link("link-1", [
      TRIAD[0]!,
      "back-extension",
      TRIAD[1]!,
      TRIAD[2]!,
    ]);
    expect(linkStations(split, ROWS).map((s) => s.label)).toEqual([
      "AB Triad",
      "Back Extension",
      "AB Triad",
    ]);
  });

  it("falls back to the raw slot when no row owns it", () => {
    const orphan = link("link-1", ["back-extension", "ghost-slot"]);
    expect(linkStations(orphan, ROWS).map((s) => s.label)).toEqual([
      "Back Extension",
      "ghost-slot",
    ]);
  });
});

describe("slotLinkBadges — showing the link on the program-slot rows", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const GROUP_KEY = "group:tb-ab-triad";
  const ROWS: LinkableMovement[] = [
    { key: "back-extension", label: "Back Extension" },
    {
      key: GROUP_KEY,
      label: "AB Triad",
      expandsTo: TRIAD.map((k) => ({ key: k, label: k })),
    },
  ];

  it("gives every slot of a group the SAME station number", () => {
    // A panel underneath made two linked lifts look unrelated. The rows carry
    // the link now, and all three triad slots are station 2 — not 2, 3, 4.
    const [linked] = addLink([], ROWS, ["back-extension", GROUP_KEY]);
    const badges = slotLinkBadges([linked!], ROWS);
    expect(badges.get("back-extension")!.station).toBe(1);
    for (const slot of TRIAD) expect(badges.get(slot)!.station).toBe(2);
    expect(badges.get("back-extension")!.stationCount).toBe(2);
  });

  it("marks only the first slot of a station as its start", () => {
    const [linked] = addLink([], ROWS, ["back-extension", GROUP_KEY]);
    const badges = slotLinkBadges([linked!], ROWS);
    expect(badges.get(TRIAD[0]!)!.isStationStart).toBe(true);
    expect(badges.get(TRIAD[1]!)!.isStationStart).toBe(false);
  });

  it("marks the final slot as the link end — rest follows it", () => {
    const [linked] = addLink([], ROWS, ["back-extension", GROUP_KEY]);
    const badges = slotLinkBadges([linked!], ROWS);
    expect(badges.get(TRIAD[2]!)!.isLinkEnd).toBe(true);
    expect(badges.get("back-extension")!.isLinkEnd).toBe(false);
  });

  it("leaves unlinked slots out entirely", () => {
    const [linked] = addLink([], ROWS, ["back-extension", GROUP_KEY]);
    expect(slotLinkBadges([linked!], ROWS).has("squat")).toBe(false);
  });
});

describe("moveStation", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const GROUP_KEY = "group:tb-ab-triad";
  const ROWS: LinkableMovement[] = [
    { key: "back-extension", label: "Back Extension" },
    {
      key: GROUP_KEY,
      label: "AB Triad",
      expandsTo: TRIAD.map((k) => ({ key: k, label: k })),
    },
  ];
  const links = [link("link-1", ["back-extension", ...TRIAD])];

  it("moves a group as a block instead of tearing it apart", () => {
    // moveMember would leave Back Extension sandwiched inside the triad.
    const out = moveStation(links, "link-1", 1, -1, ROWS);
    expect(out[0]!.members).toEqual([...TRIAD, "back-extension"]);
  });

  it("is a no-op past either end", () => {
    expect(moveStation(links, "link-1", 0, -1, ROWS)).toEqual(links);
    expect(moveStation(links, "link-1", 1, 1, ROWS)).toEqual(links);
  });

  it("leaves other links alone", () => {
    const two = [...links, link("link-2", ["a", "b"])];
    expect(moveStation(two, "link-1", 1, -1, ROWS)[1]).toEqual(two[1]);
  });

  it("still moves one slot per station for plain lifts", () => {
    const plain = [link("link-1", ["a", "b", "c"])];
    const rows: LinkableMovement[] = [
      { key: "a", label: "A" },
      { key: "b", label: "B" },
      { key: "c", label: "C" },
    ];
    expect(moveStation(plain, "link-1", 2, -1, rows)[0]!.members).toEqual([
      "a",
      "c",
      "b",
    ]);
  });
});
