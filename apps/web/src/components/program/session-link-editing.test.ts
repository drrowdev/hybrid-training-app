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
  linkedKeys,
  linksIncludeMainLift,
  moveMember,
  nextLinkId,
  pruneLinksToMovements,
  pruneMovementFromLinks,
  removeLink,
  selectableMovements,
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
    expect(canCreateLink([], [])).toBe(false);
    expect(canCreateLink(["a"], [])).toBe(false);
    expect(canCreateLink(["a", "b"], [])).toBe(true);
  });

  it("refuses past the member cap", () => {
    const nine = Array.from({ length: 9 }, (_, i) => `m${i}`);
    expect(canCreateLink(nine, [])).toBe(false);
  });

  it("refuses past the per-slot link cap", () => {
    const six = Array.from({ length: 6 }, (_, i) => link(`link-${i}`, ["x", "y"]));
    expect(canCreateLink(["a", "b"], six)).toBe(false);
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
  const LOCK = "The AB Triad is already linked as a circuit.";
  const label = (key: string) => `LBL:${key}`;

  const build = (
    slots: string[],
    selected: Record<string, string | null>,
  ) =>
    activationLinkableMovements({
      slots: slots.map((sourceMovement) => ({ sourceMovement })),
      selected,
      labelOf: label,
      builtinCircuitSources: TRIAD,
      lockedReason: LOCK,
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

  it("treats every Activation slot as a main lift, so linking one warns", () => {
    const out = build(["bench"], { bench: "bench" });
    expect(out[0]!.isMain).toBe(true);
  });

  it("locks the AB Triad while the whole triad is present", () => {
    const slots = ["squat", ...TRIAD];
    const selected = Object.fromEntries(slots.map((s) => [s, s]));
    const out = build(slots, selected);
    expect(out.find((m) => m.key === "squat")!.lockedReason).toBeUndefined();
    for (const source of TRIAD) {
      expect(out.find((m) => m.key === source)!.lockedReason).toBe(LOCK);
    }
  });

  it("leaves triad movements linkable when the triad is incomplete", () => {
    const slots = ["squat", "hanging-leg-raise", "toes-to-bar"];
    const selected = Object.fromEntries(slots.map((s) => [s, s]));
    const out = build(slots, selected);
    expect(out.every((m) => m.lockedReason == null)).toBe(true);
  });

  it("preserves session order", () => {
    const out = build(["c", "a", "b"], { a: "a", b: "b", c: "c" });
    expect(out.map((m) => m.key)).toEqual(["c", "a", "b"]);
  });

  it("returns nothing when every slot is removed", () => {
    expect(build(["a", "b"], { a: null, b: null })).toEqual([]);
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

describe("moveMember", () => {
  const links = [
    link("link-1", ["squat", "bench", "catalog:1"], "Tri-set"),
    link("link-2", ["catalog:2", "catalog:3"]),
  ];

  it("moves a member earlier", () => {
    const out = moveMember(links, "link-1", 1, -1);
    expect(out[0]!.members).toEqual(["bench", "squat", "catalog:1"]);
  });

  it("moves a member later", () => {
    const out = moveMember(links, "link-1", 0, 1);
    expect(out[0]!.members).toEqual(["bench", "squat", "catalog:1"]);
  });

  it("moves across the whole group, not just by swapping neighbours", () => {
    // Last -> first, one step at a time, ends up fully reversed at the front.
    let out = moveMember(links, "link-1", 2, -1);
    out = moveMember(out, "link-1", 1, -1);
    expect(out[0]!.members).toEqual(["catalog:1", "squat", "bench"]);
  });

  it("refuses to move the first member earlier", () => {
    expect(moveMember(links, "link-1", 0, -1)[0]!.members).toEqual(
      links[0]!.members,
    );
  });

  it("refuses to move the last member later", () => {
    expect(moveMember(links, "link-1", 2, 1)[0]!.members).toEqual(
      links[0]!.members,
    );
  });

  it("ignores an out-of-range index", () => {
    expect(moveMember(links, "link-1", 9, -1)[0]!.members).toEqual(
      links[0]!.members,
    );
    expect(moveMember(links, "link-1", -1, 1)[0]!.members).toEqual(
      links[0]!.members,
    );
  });

  it("leaves other links untouched", () => {
    const out = moveMember(links, "link-1", 0, 1);
    expect(out[1]).toEqual(links[1]);
  });

  it("is a no-op for an unknown link id", () => {
    expect(moveMember(links, "nope", 0, 1)).toEqual(links);
  });

  it("never drops or duplicates a member", () => {
    const out = moveMember(links, "link-1", 1, -1);
    expect([...out[0]!.members].sort()).toEqual([...links[0]!.members].sort());
    expect(new Set(out[0]!.members).size).toBe(out[0]!.members.length);
  });
});
