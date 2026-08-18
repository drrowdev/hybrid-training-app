/**
 * The link badge as it is actually assembled onto a program-slot row.
 *
 * This markup previously lived inside ProgramPicker's 5,000 lines, behind
 * customise mode and an expanded phase — interactive state a Node-env static
 * render cannot reach, so the JSX went untested while only its inputs
 * (`slotLinkBadges`) and its CSS names were verified. Extracting it made the
 * assembly itself testable, which is the part that had been assumed.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { LinkBadge, rowLinkClass } from "./LinkBadge";
import type { LinkableMovement, SlotLinkBadge } from "./session-link-editing";

const STYLES: Record<string, string> = {
  activationMovementRow: "row",
  linkedRow: "linked",
  linkedRowWarn: "linkedWarn",
  linkedRowStart: "linkedStart",
  linkedRowEnd: "linkedEnd",
  linkBadge: "badge",
  linkBadgeWarn: "badgeWarn",
  linkContinuation: "cont",
  linkRowActions: "actions",
  linkUnlink: "unlink",
};

function badge(overrides: Partial<SlotLinkBadge> = {}): SlotLinkBadge {
  return {
    linkId: "link-1",
    linkName: "Superset",
    station: 1,
    stationCount: 2,
    isStationStart: true,
    isLinkEnd: false,
    hasMainLift: false,
    ...overrides,
  };
}

const MOVEMENTS: LinkableMovement[] = [
  { key: "catalog:1", label: "Barbell curl" },
  { key: "catalog:2", label: "Triceps pushdown" },
];
const LINKS = [
  { id: "link-1", name: "Superset", members: ["catalog:1", "catalog:2"] },
];

function render(props: Parameters<typeof LinkBadge>[0]) {
  return renderToStaticMarkup(<LinkBadge {...props} />);
}

/** The badge with its four control props supplied. */
function editable(b: SlotLinkBadge) {
  return render({
    styles: STYLES,
    badge: b,
    links: LINKS,
    movements: MOVEMENTS,
    seriesKey: "slot-1",
    onChange: () => {},
  });
}

describe("LinkBadge", () => {
  it("renders nothing for an unlinked row", () => {
    expect(render({ styles: STYLES, badge: undefined })).toBe("");
  });

  it("states the link and its station on the row", () => {
    const html = editable(badge());
    expect(html).toContain("row-link-badge-link-1-1");
    expect(html).toContain("A1");
    expect(html).toContain("Superset");
  });

  it("labels only the first slot of a station", () => {
    // The AB Triad occupies three slots but is ONE pick. Numbering its trailing
    // slots A2/A3 is exactly what made a two-station superset read as a giant
    // set of four.
    const html = editable(badge({ isStationStart: false, station: 2 }));
    expect(html).toContain("same station");
    expect(html).not.toContain("row-link-badge-");
    expect(html).not.toContain("Unlink");
  });

  it("is read-only when the control props are absent", () => {
    const html = render({ styles: STYLES, badge: badge() });
    expect(html).toContain("Superset");
    expect(html).not.toContain("row-link-up-link-1-1");
    expect(html).not.toContain("Unlink");
  });

  it("carries reorder controls, disabled at each end", () => {
    const first = editable(badge({ station: 1, stationCount: 2 }));
    expect(first).toMatch(
      /row-link-up-link-1-1"[^>]*disabled|disabled[^>]*row-link-up-link-1-1"/,
    );
    expect(first).not.toMatch(
      /row-link-down-link-1-1"[^>]*disabled|disabled[^>]*row-link-down-link-1-1"/,
    );

    const last = editable(badge({ station: 2, stationCount: 2 }));
    expect(last).toMatch(
      /row-link-down-link-1-2"[^>]*disabled|disabled[^>]*row-link-down-link-1-2"/,
    );
  });

  it("names the reorder controls by station, for screen readers", () => {
    const html = editable(badge({ station: 2, stationCount: 2 }));
    expect(html).toContain("Move Superset station 2 earlier");
    expect(html).toContain("Move Superset station 2 later");
  });

  it("offers Unlink once per link, on its first station only", () => {
    expect(editable(badge({ station: 1 }))).toContain("row-link-unlink-link-1");
    // Repeating it on every member would imply each row could be detached on
    // its own; a link is unlinked as a whole.
    expect(editable(badge({ station: 2, stationCount: 2 }))).not.toContain(
      "row-link-unlink-link-1",
    );
  });

  it("marks a link that contains a main lift (DC-K4 — warn, never block)", () => {
    const html = editable(badge({ hasMainLift: true }));
    expect(html).toContain("badgeWarn");
    // Still fully operable — the warning is advice, not a gate.
    expect(html).toContain("row-link-unlink-link-1");
  });

  it("binds every class name it references", () => {
    // CSS-module misses resolve to `undefined` silently, which typecheck will
    // not catch. Nothing here should render the literal string.
    const html = editable(badge({ hasMainLift: true }));
    expect(html).not.toContain("undefined");
  });
});

describe("rowLinkClass", () => {
  it("leaves an unlinked row with just its base class", () => {
    expect(rowLinkClass(STYLES, undefined)).toBe("row");
  });

  it("takes a caller-supplied base, for rows styled by a descendant selector", () => {
    // Custom-builder rows carry no class of their own; passing the Activation
    // grid class there would impose the wrong layout.
    expect(rowLinkClass(STYLES, undefined, "")).toBe("");
    expect(rowLinkClass(STYLES, badge(), "")).toBe(
      "linked linkedStart",
    );
  });

  it("adds the rail to a linked row", () => {
    expect(rowLinkClass(STYLES, badge({ isStationStart: false }))).toBe(
      "row linked",
    );
  });

  it("caps the rail at the first and last slot of the link", () => {
    expect(rowLinkClass(STYLES, badge({ station: 1, isStationStart: true }))).toContain(
      "linkedStart",
    );
    expect(rowLinkClass(STYLES, badge({ isLinkEnd: true }))).toContain("linkedEnd");
    // A middle slot gets neither cap.
    const middle = rowLinkClass(
      STYLES,
      badge({ station: 2, isStationStart: true, isLinkEnd: false }),
    );
    expect(middle).not.toContain("linkedStart");
    expect(middle).not.toContain("linkedEnd");
  });

  it("only opens the rail on station 1, not on every station start", () => {
    expect(
      rowLinkClass(STYLES, badge({ station: 2, isStationStart: true })),
    ).not.toContain("linkedStart");
  });

  it("tints the whole row when the link holds a main lift", () => {
    expect(rowLinkClass(STYLES, badge({ hasMainLift: true }))).toContain(
      "linkedWarn",
    );
  });

  it("never emits an undefined class", () => {
    expect(
      rowLinkClass(STYLES, badge({ hasMainLift: true, isLinkEnd: true })),
    ).not.toContain("undefined");
  });
});
