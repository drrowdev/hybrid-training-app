import { describe, it, expect } from "vitest";
import { buildExternalCardioItems } from "../external-cardio";

/**
 * Phase 1 "external cardio" — coverage for the placeholder cardio
 * prescription emitted when a block has `cardio_source: 'external'`.
 *
 * The materializer in `createBlock` swaps `assemblePrescriptionItems`
 * for `buildExternalCardioItems` on every `day.kind === 'cardio'`
 * row — same logic applies regardless of archetype (Strength Anchor /
 * Endurance Anchor / Concurrent Hybrid). The unit tests below pin the
 * shape of the placeholder so the session-page + stats consumers stay
 * in sync.
 */

describe("buildExternalCardioItems — placeholder shape", () => {
  it("returns a single cardio_external item with the program name as the label", () => {
    const items = buildExternalCardioItems("Runna");
    expect(items).toHaveLength(1);
    const item = items[0]!;
    expect(item.kind).toBe("cardio_external");
    expect(item.intensityLabel).toBe("Runna");
    // No movement / duration / HR-cap — the user logs via their external program.
    expect(item.movementId).toBe("");
    expect(item.durationMin).toBeUndefined();
    expect(item.hrCap).toBeUndefined();
    expect(item.sets).toBeUndefined();
    expect(item.reps).toBeUndefined();
  });

  it("carries the source name once, and no prose repeating it", () => {
    // "Logged via Runna." sat in protocolNote, a field for a protocol hint.
    // Surfaces rendered it under a heading already reading "Runna", and the
    // note parser treated it as a prescription to break into rows.
    for (const name of ["Runna", null, "   "]) {
      const item = buildExternalCardioItems(name)[0]!;
      expect(item.protocolNote, `protocolNote for ${JSON.stringify(name)}`).toBeUndefined();
    }
  });

  it("falls back to 'External program' when no program name is provided", () => {
    const items = buildExternalCardioItems(null);
    expect(items).toHaveLength(1);
    expect(items[0]!.intensityLabel).toBe("External program");
  });

  it("trims whitespace-only program names back to the fallback label", () => {
    const items = buildExternalCardioItems("   ");
    expect(items[0]!.intensityLabel).toBe("External program");
  });

  it("emits the same shape regardless of archetype (Strength Anchor / Endurance Anchor / Concurrent Hybrid parity)", () => {
    // The helper takes no archetype — that's the whole point. Verify the
    // shape stays identical across the three archetypes the user can
    // build via the wizard that have cardio days.
    const strength = buildExternalCardioItems("Garmin Coach");
    const endurance = buildExternalCardioItems("Garmin Coach");
    const hybrid = buildExternalCardioItems("Garmin Coach");
    expect(strength).toEqual(endurance);
    expect(strength).toEqual(hybrid);
    // And the shape is invariant: archetype-driven cardioKind / durationMin
    // / hrCap / finisher noise stays out entirely.
    for (const items of [strength, endurance, hybrid]) {
      expect(items).toHaveLength(1);
      expect(items[0]!.kind).toBe("cardio_external");
      expect(items[0]!.durationMin).toBeUndefined();
    }
  });
});
