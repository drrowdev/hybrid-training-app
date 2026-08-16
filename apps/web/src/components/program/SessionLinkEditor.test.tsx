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

  it("offers the picker when nothing is linked yet", () => {
    const html = markup([]);
    expect(html).toContain("+ Link lifts");
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
