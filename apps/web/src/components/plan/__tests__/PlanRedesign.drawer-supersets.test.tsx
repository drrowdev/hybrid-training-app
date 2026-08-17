/**
 * The plan drawer's movement cards must bracket user-authored links.
 *
 * The drawer only opens through interaction and had no test at all, which is
 * how it shipped rendering a link the user created as plain, unrelated cards —
 * the surface they check before training said nothing about the superset.
 *
 * Static HTML render only; the web test environment is Node with no DOM.
 */
import React from "react";
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import { DrawerMovementSections } from "../PlanRedesign";
import { groupByMovementThenKind } from "@/lib/plan/prescription-grouping";

const item = (
  movementId: string,
  movementName: string,
  over: Partial<PrescriptionItem> = {},
): PrescriptionItem =>
  ({
    kind: "main",
    movementId,
    movementName,
    percentTm: 85,
    reps: 3,
    sets: 1,
    ...over,
  }) as unknown as PrescriptionItem;

const linked = (
  movementId: string,
  movementName: string,
  position: number,
  circuit: { id: string; name: string; size: number },
): PrescriptionItem =>
  item(movementId, movementName, {
    // Supplemental work materialises as `back_off`, which is what puts it in a
    // movement section rather than the accessory rows.
    kind: "back_off",
    circuit: { ...circuit, position },
  } as Partial<PrescriptionItem>);

function render(items: PrescriptionItem[]) {
  const sections = groupByMovementThenKind(items).movements;
  return renderToStaticMarkup(<DrawerMovementSections sections={sections} />);
}

describe("plan drawer — movement sections", () => {
  it("groups by role so main lifts read at a glance", () => {
    const html = render([
      item("m-bench", "Bench Press"),
      item("m-row", "Barbell Row"),
      linked("m-pullup", "Pull-up", 0, {
        id: "link-1",
        name: "Superset",
        size: 2,
      }),
      linked("m-press", "Overhead Press", 1, {
        id: "link-1",
        name: "Superset",
        size: 2,
      }),
    ]);
    expect(html).toContain('data-testid="plan-drawer-section-main"');
    expect(html).toContain('data-testid="plan-drawer-section-supplemental"');
    expect(html).toContain("Main lifts");
    expect(html).toContain("Supplemental lifts");
    // Role is stated once per group, not repeated inside every movement card.
    expect(html).not.toContain(">Main lift<");
    expect(html).not.toContain(">Supplemental lift<");
    // Main lifts come first, so the answer to "what am I lifting today" is at
    // the top rather than interleaved with accessory work.
    expect(html.indexOf("Main lifts")).toBeLessThan(
      html.indexOf("Supplemental lifts"),
    );
  });

  it("omits the headings when only one role is present", () => {
    const html = render([
      item("m-bench", "Bench Press"),
      item("m-row", "Barbell Row"),
    ]);
    expect(html).toContain("Bench Press");
    expect(html).not.toContain("Main lifts");
  });

  it("brackets two linked supplemental lifts", () => {
    const html = render([
      item("m-bench", "Bench Press"),
      item("m-row", "Barbell Row"),
      linked("m-pullup", "Pull-up", 0, {
        id: "link-1",
        name: "Superset",
        size: 2,
      }),
      linked("m-press", "Overhead Press", 1, {
        id: "link-1",
        name: "Superset",
        size: 2,
      }),
    ]);
    expect(html).toContain('data-superset-group="link-1"');
    expect(html).toContain("Superset");
    expect(html).toContain("Pull-up");
    expect(html).toContain("Overhead Press");
  });

  it("uses the link's own name rather than always saying superset", () => {
    const circuit = { id: "link-2", name: "Giant set", size: 4 };
    const html = render([
      linked("m-a", "Back Extension", 0, circuit),
      linked("m-b", "Hanging Leg Raise", 1, circuit),
      linked("m-c", "Hanging Knee Raise", 2, circuit),
      linked("m-d", "Toes-to-Bar", 3, circuit),
    ]);
    expect(html).toContain("Giant set");
  });

  it("leaves unlinked movements unbracketed", () => {
    const html = render([
      item("m-bench", "Bench Press"),
      item("m-row", "Barbell Row"),
    ]);
    // Assert the cards actually rendered, so this can't pass on empty output.
    expect(html).toContain("Bench Press");
    expect(html).toContain("Barbell Row");
    expect(html).not.toContain("data-superset-group");
  });
});
