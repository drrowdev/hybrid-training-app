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
    expect(item.protocolNote).toBe("Logged via Runna.");
    // No movement / duration / HR-cap — the user logs via their external program.
    expect(item.movementId).toBe("");
    expect(item.durationMin).toBeUndefined();
    expect(item.hrCap).toBeUndefined();
    expect(item.sets).toBeUndefined();
    expect(item.reps).toBeUndefined();
  });

  it("falls back to 'External program' when no program name is provided", () => {
    const items = buildExternalCardioItems(null);
    expect(items).toHaveLength(1);
    expect(items[0]!.intensityLabel).toBe("External program");
    expect(items[0]!.protocolNote).toBe("Logged via your external program.");
  });

  it("trims whitespace-only program names back to the fallback label", () => {
    const items = buildExternalCardioItems("   ");
    expect(items[0]!.intensityLabel).toBe("External program");
    expect(items[0]!.protocolNote).toBe("Logged via your external program.");
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
