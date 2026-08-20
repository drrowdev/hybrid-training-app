/**
 * Reproduces the reported Today card: a 4-movement giant set where the first
 * station has more sets than the rotation is deep.
 *
 * Before the collapse fix that rendered as
 *   "1 × 15 · 1 × 15 · 1 × 15 · 2 × 15"
 * because `circuit.round` differs on every set of a linked movement, and the
 * two sets past the rotation carry no circuit at all.
 */
import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { PrescriptionItem } from "@hta/db";
import { SessionPreviewBody } from "../SessionPreviewBody";
import { applyRehabLinks } from "@/lib/platform/rehab-links";
import { expandPrescriptionSets } from "@/lib/planner/expand-prescription-sets";

const movements = [
  { id: "m-adduction", name: "Standing Banded Hip Adduction", sets: 5, reps: 15 },
  { id: "m-flexion", name: "Standing Banded Hip Flexion", sets: 3, reps: 10 },
  { id: "m-abduction", name: "Standing Banded Hip Abduction", sets: 3, reps: 10 },
  { id: "m-extension", name: "Standing Banded Hip Extension", sets: 3, reps: 10 },
];

function rehabItems(): PrescriptionItem[] {
  const base = movements.map(
    (movement): PrescriptionItem =>
      ({
        movementId: movement.id,
        movementName: movement.name,
        kind: "tendon",
        sets: movement.sets,
        reps: movement.reps,
        meta: { rehab: true, rehabProtocolName: "Adductor tendon strain rehab" },
      }) as unknown as PrescriptionItem,
  );
  const expanded = expandPrescriptionSets({ items: base });
  return applyRehabLinks(
    expanded.items,
    [
      {
        id: "link-1",
        name: "Giant set",
        members: movements.map((movement) => movement.id),
      },
    ],
    "protocol-1",
  );
}

describe("a linked rehab station on the Today card", () => {
  it("summarises each movement as one line, not one per set", () => {
    const html = renderToStaticMarkup(
      <SessionPreviewBody
        variant="compact"
        session={{
          id: "planned-1",
          title: "Armor B2",
          eyebrow: "ARMOR · WK 2 · TUE",
          estDurationMin: 53,
          items: rehabItems(),
        }}
      />,
    );

    // The three equal-depth movements collapse to a single "3 × 10".
    expect(html).toContain("3 × 10");
    expect(html).not.toContain("1 × 10 · 1 × 10");

    // The deeper station keeps its rotation and its solo tail as two facts —
    // they are genuinely different work (in-circuit vs full rest).
    expect(html).toContain("3 × 15");
    expect(html).not.toContain("1 × 15 · 1 × 15");
  });
});
