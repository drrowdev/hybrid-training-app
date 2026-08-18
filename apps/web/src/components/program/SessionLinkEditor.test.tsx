/**
 * SessionLinkEditor static render.
 *
 * This component creates links; it no longer draws them. The drawing moved onto
 * the program-slot rows, so the assertions about members / order / rest live in
 * `session-link-editing.test.ts` (`linkStations`, `slotLinkBadges`) and the
 * click-through path in the Playwright program specs. What is left here is the
 * picker, the locked-movement rule, and the main-lift warning.
 *
 * Static markup only — the project test env is Node with no DOM.
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

  it("invites more lifts into an existing link", () => {
    expect(markup([
      { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
    ])).toContain("Link more lifts");
  });

  it("names the button after what the picked count would make", () => {
    // Nothing picked yet, so the button states its precondition rather than
    // pretending it is ready.
    expect(markup([])).toContain("Select 2 or more");
  });

  it("warns when a link contains a main lift", () => {
    const html = markup([
      { id: "link-1", name: "Superset", members: ["squat", "bench"] },
    ]);
    expect(html).toContain("link-main-warning-slot-1");
    expect(html).toContain("Main lift in a superset.");
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
    expect(html).not.toContain("link-picker-toggle-slot-1");
  });
});

describe("the link is stated once, on the rows — not again down here", () => {
  // The reported bug: every link appeared twice, as a row badge AND as a member
  // list in this panel. The panel version also listed stored members, so a
  // two-pick superset containing the AB Triad read as a giant set of four.
  const linked = [
    { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
  ];

  it("does not re-list the members", () => {
    const html = markup(linked);
    expect(html).not.toContain("session-link-link-1");
    expect(html).not.toContain("link-member-link-1-0");
    // The linked lifts are absent from the picker (covered above), so their
    // names should not appear anywhere in this panel at all.
    expect(html).not.toContain("Barbell curl");
    expect(html).not.toContain("Triceps pushdown");
  });

  it("does not repeat the round positions", () => {
    const html = markup([
      { id: "link-1", name: "Tri-set", members: ["squat", "catalog:1", "catalog:2"] },
    ]);
    expect(html).not.toContain(">A1</span>");
    expect(html).not.toContain(">A2</span>");
  });

  it("carries no Unlink or reorder controls", () => {
    const html = markup(linked);
    expect(html).not.toContain("Unlink");
    expect(html).not.toContain("link-move-up-link-1-0");
    expect(html).not.toContain("link-move-down-link-1-0");
  });

  it("drops the rest-after line entirely", () => {
    expect(markup(linked)).not.toContain("Rest after");
  });
});
