import { describe, it, expect } from "vitest";
import {
  REBUILD,
  STRENGTH_ANCHOR,
  buildPrescription,
  type DayTemplate,
} from "../archetypes";

/**
 * Verifies the prescription assembler attaches RIR / tempo / cue fields
 * to accessory + tendon items but never to main / warmup / cardio items.
 *
 * Black-box test: we drive `buildPrescription` directly (no DB), point it
 * at archetype days that exist in the library, and inspect the returned
 * PrescriptionItem[]. The picker path (which assembles items in
 * `actions.ts`) is exercised via its own e2e + integration coverage.
 */

const FAKE_MOVEMENT = {
  id: "fake-id",
  slug: "fake-slug",
  displayName: "Fake Movement",
};

describe("prescription assembler — RIR attachment", () => {
  it("attaches RIR + tempo + cue to tendon-day items", () => {
    const tendonDay = REBUILD.days.find((d) => d.kind === "tendon");
    expect(tendonDay).toBeTruthy();
    const items = buildPrescription(
      REBUILD,
      1, // week 2 (build) — baseline modifier
      tendonDay as DayTemplate,
      FAKE_MOVEMENT,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.kind).toBe("tendon");
      expect(it.targetRir).toBeTruthy();
      expect(it.tempoEccentricSec).toBe(3);
      expect(it.intensityCue).toBeTruthy();
      expect(it.intensityCue!.length).toBeLessThanOrEqual(80);
    }
  });

  it("does NOT attach RIR to main-lift items on a strength day", () => {
    const strengthDay = STRENGTH_ANCHOR.days.find((d) => d.kind === "strength");
    expect(strengthDay).toBeTruthy();
    const items = buildPrescription(
      STRENGTH_ANCHOR,
      1,
      strengthDay as DayTemplate,
      FAKE_MOVEMENT,
    );
    expect(items.length).toBeGreaterThan(0);
    for (const it of items) {
      expect(it.kind).toBe("main");
      // The RIR effort anchor is hypertrophy-only; strength uses AMRAP.
      expect(it.targetRir).toBeUndefined();
      expect(it.targetRpe).toBeUndefined();
      expect(it.tempoEccentricSec).toBeUndefined();
      expect(it.holdSec).toBeUndefined();
      // ADR 0007 — only the solicited AMRAP top set carries an intensity cue;
      // every other main set has none.
      if (it.isAmrap === true) {
        expect(it.intensityCue).toBeTruthy();
      } else {
        expect(it.intensityCue).toBeUndefined();
      }
      // Main items keep their %TM cue intact.
      expect(it.percentTm).toBeTypeOf("number");
    }
  });
});
