import { describe, it, expect } from "vitest";
import {
  ENDURANCE_ANCHOR,
  STRENGTH_ANCHOR,
  CONCURRENT_HYBRID,
  formatPrescriptionItem,
} from "../archetypes";
import type { PrescriptionItem } from "@hta/db";

/**
 * Smoke-tests for the plain-language rewrite of cardio `protocolNote`
 * strings. We don't snapshot the entire archetype tree — just assert
 * the human-readable replacements are present (and the old shorthand
 * is gone) wherever a cardio day or finisher carries a note.
 */

const allCardioNotes = (() => {
  const notes: string[] = [];
  for (const arch of [STRENGTH_ANCHOR, ENDURANCE_ANCHOR, CONCURRENT_HYBRID]) {
    const days = [...arch.days, ...(arch.twoADayDays ?? [])];
    for (const d of days) {
      if (d.kind !== "cardio") continue;
      if (d.protocolNote) notes.push(d.protocolNote);
      if (d.finisher?.protocolNote) notes.push(d.finisher.protocolNote);
    }
  }
  return notes;
})();

describe("cardio protocol notes — plain-language copy", () => {
  it("never contains the old shorthand strings", () => {
    for (const n of allCardioNotes) {
      expect(n).not.toMatch(/1:10 rest/);
      expect(n).not.toMatch(/walk-down recovery/);
      // Normalized form drops the no-space "4×4 min" shorthand.
      expect(n).not.toMatch(/4×4 min @ 90–95% HRmax, 3 min easy between/);
    }
  });

  it("uses plain-language phrasing for sprint / VO2 finishers", () => {
    expect(allCardioNotes).toContain(
      "6–8 × 10–15s near-max efforts, ~100–150s easy spin between reps",
    );
    expect(allCardioNotes).toContain(
      "6–10 × 10–15s near-max hill sprints, walk back down for recovery (~90–120s)",
    );
    expect(allCardioNotes).toContain(
      "4 × 4 min hard @ 90–95% HRmax, with 3 min easy recovery between intervals",
    );
  });

  it("renders the new note on a formatted cardio prescription item", () => {
    const item: PrescriptionItem = {
      movementId: "mov-bike",
      movementSlug: "bike-indoor-z2",
      movementName: "Indoor Bike — Z2",
      kind: "cardio_alactic",
      durationMin: 10,
      protocolNote:
        "6–8 × 10–15s near-max efforts, ~100–150s easy spin between reps",
      intensityLabel: "Alactic finisher",
    };
    const formatted = formatPrescriptionItem(item);
    expect(formatted).toContain("10 min");
    expect(formatted).toContain("easy spin between reps");
  });
});
