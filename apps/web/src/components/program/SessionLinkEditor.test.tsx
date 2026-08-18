/**
 * SessionLinkEditor static render.
 *
 * Static markup only — the project test env is Node with no DOM, so the editing
 * behaviour is covered directly in `session-link-editing.test.ts` and the
 * click-through path by the Playwright program specs.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SessionLinkEditor } from "./SessionLinkEditor";
import type { LinkableMovement } from "./session-link-editing";

const MOVEMENTS: LinkableMovement[] = [
  { key: "squat", label: "Squat", isMain: true },
  { key: "bench", label: "Bench press", isMain: true },
  { key: "catalog:1", label: "Barbell curl" },
  { key: "catalog:2", label: "Triceps pushdown" },
];

function markup(
  links: Parameters<typeof SessionLinkEditor>[0]["links"],
  movements: LinkableMovement[] = MOVEMENTS,
) {
  return renderToStaticMarkup(
    <SessionLinkEditor
      seriesKey="slot-1"
      movements={movements}
      links={links}
      onChange={() => {}}
    />,
  );
}

describe("SessionLinkEditor", () => {
  it("renders nothing when a slot has fewer than two lifts", () => {
    expect(markup([], [MOVEMENTS[0]!])).toBe("");
  });

  it("offers the picker when nothing is linked yet, marked closed", () => {
    const html = markup([]);
    expect(html).toContain("Link lifts");
    expect(html).toContain("link-picker-toggle-slot-1");
    // Closed picker shows "+"; the open state swaps it for a minus so the
    // control says which way it will move.
    expect(html).toContain(">+</span>");
    expect(html).not.toContain("\u2212</span>");
    expect(html).toContain("link-pick-slot-1-squat");
    expect(html).toContain("link-create-slot-1");
  });

  it("renders a link with its members in performance order", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
    ]);
    expect(html).toContain("session-link-link-1");
    expect(html).toContain("Barbell curl");
    expect(html).toContain("Triceps pushdown");
    expect(html).toContain("Unlink Superset");
  });

  it("labels each member with its round position", () => {
    const html = markup([
      { id: "link-1", name: "Tri-set", members: ["squat", "catalog:1", "catalog:2"] },
    ]);
    expect(html).toContain("link-member-link-1-0");
    expect(html).toContain("link-member-link-1-1");
    expect(html).toContain("link-member-link-1-2");
    // React splits `A{index + 1}` into separate text nodes.
    expect(html.replace(/<!--.*?-->/g, "")).toContain("A3");
  });

  it("offers move controls, disabled at each end", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
    ]);
    expect(html).toContain("Move Barbell curl later");
    expect(html).toContain("Move Triceps pushdown earlier");
    // First member cannot move up; last cannot move down.
    expect(html).toMatch(
      /link-move-up-link-1-0"[^>]*disabled|disabled[^>]*link-move-up-link-1-0"/,
    );
    expect(html).toMatch(
      /link-move-down-link-1-1"[^>]*disabled|disabled[^>]*link-move-down-link-1-1"/,
    );
  });

  it("says which lift the rest follows, so order reads as consequential", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
    ]);
    expect(html).toContain("Rest after Triceps pushdown");
  });

  it("warns when a link contains a main lift, and still renders the link", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["squat", "bench"] },
    ]);
    expect(html).toContain("link-main-warning-slot-1");
    expect(html).toContain("Main lift in a superset.");
    expect(html).toContain("session-link-link-1");
  });

  it("does not warn for an accessory-only link", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
    ]);
    expect(html).not.toContain("link-main-warning-slot-1");
  });

  it("omits already-linked lifts from the picker", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
    ]);
    expect(html).not.toContain("link-pick-slot-1-catalog:1");
    expect(html).toContain("link-pick-slot-1-squat");
  });

  it("never offers a locked AB Triad movement, and explains why", () => {
    const lock = "The AB Triad is already linked as a circuit.";
    const html = markup([], [
      { key: "squat", label: "Squat", isMain: true },
      { key: "hanging-leg-raise", label: "Hanging leg raise", lockedReason: lock },
      { key: "toes-to-bar", label: "Toes to bar", lockedReason: lock },
      { key: "catalog:1", label: "Barbell curl" },
    ]);
    expect(html).not.toContain("link-pick-slot-1-hanging-leg-raise");
    expect(html).not.toContain("link-pick-slot-1-toes-to-bar");
    expect(html).toContain("link-locked-note-slot-1");
    expect(html).toContain("AB Triad is already linked");
  });

  it("hides the picker when fewer than two lifts remain selectable", () => {
    const html = markup([
      { id: "link-1", name: "Tri-set", members: ["squat", "bench", "catalog:1"] },
    ]);
    expect(html).not.toContain("link-create-slot-1");
    expect(html).toContain("session-link-link-1");
  });
});

describe("a group station is one pick, not three", () => {
  const TRIAD = ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"];
  const WITH_GROUP: LinkableMovement[] = [
    { key: "back-extension", label: "Back Extension" },
    {
      key: "group:tb-ab-triad",
      label: "AB Triad",
      expandsTo: [
        { key: TRIAD[0]!, label: "Hanging Leg Raise" },
        { key: TRIAD[1]!, label: "Hanging Knee Raise" },
        { key: TRIAD[2]!, label: "Toes-to-Bar" },
      ],
    },
  ];
  const linked = [
    {
      id: "link-1",
      name: "Superset",
      members: ["back-extension", ...TRIAD],
    },
  ];

  it("shows two A-rows for two picks, not four", () => {
    // The reported bug: picking Back Extension + AB Triad rendered A1-A4, so a
    // superset of two things read as a giant set of four.
    const html = markup(linked, WITH_GROUP);
    expect(html).toContain(">A1</span>");
    expect(html).toContain(">A2</span>");
    expect(html).not.toContain(">A3</span>");
    expect(html).not.toContain(">A4</span>");
    expect(html).toContain("link-member-link-1-0");
    expect(html).toContain("link-member-link-1-1");
    expect(html).not.toContain("link-member-link-1-2");
  });

  it("names the group, and still shows what is inside it", () => {
    const html = markup(linked, WITH_GROUP);
    expect(html).toContain("AB Triad");
    // The members stay visible as a sub-line so the lifter can see the work,
    // without them being mistaken for separate picks.
    expect(html).toContain("Hanging Leg Raise");
    expect(html).toContain("Toes-to-Bar");
  });

  it("rests after the group, not after its last movement", () => {
    expect(markup(linked, WITH_GROUP)).toContain("Rest after AB Triad");
  });

  it("labels the reorder controls with the station", () => {
    const html = markup(linked, WITH_GROUP);
    expect(html).toContain("Move AB Triad earlier");
    expect(html).not.toContain("Move Toes-to-Bar earlier");
  });
});
