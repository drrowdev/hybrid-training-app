/**
 * Hybrid program engine — parity + shape test (ADR 0046; simplified Hybrid).
 *
 * Hybrid is a single, fixed generator: it ALWAYS runs the balanced concurrent
 * engine (`concurrent_hybrid`). There is no goal-preset / archetype picker. Its
 * only unique setup input is `focusMuscles` (wizard step 2 "Loadout"); the common
 * inputs — training days/week + start date — come from the shared wizard Schedule
 * step and are injected into `setup` by the deploy path (NOT Hybrid setup fields).
 *
 * Downstream prescription parity with the legacy path is STRUCTURAL: Hybrid's
 * `materializeNative` calls the exact same `buildBlockAssemblyContext` +
 * `assembleBlockSessions` the legacy `createBlock` used (covered by the planner
 * golden snapshot). So this file pins the only new surface:
 *   (a) `setup` always produces a `concurrent_hybrid` instance, carries the
 *       injected `daysPerWeek`, maps `focusMuscles`, and equals the shared
 *       `parseCreateBlockInput` output for the equivalent raw input; and
 *   (b) the pure `timeline` enumeration.
 */
import { describe, it, expect } from "vitest";
import {
  hybridProgramEngine,
  toContextInput,
  resolveHybridTmPercent,
} from "../engine";
import { parseCreateBlockInput } from "@/lib/planner/create-block-input";
import { ARCHETYPES, daysForFrequency } from "@/lib/planner/archetypes";
import { foldDualMainLifts } from "@/lib/planner/main-lift-folding";
import type { PlatformContext } from "@hta/program-core";

const CTX: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
const HYBRID_ARCHETYPE = "concurrent_hybrid";

describe("Hybrid engine — setup shape", () => {
  it("exposes focus muscles + a training-intensity (TM%) select, defaulting to 90", () => {
    const fields = hybridProgramEngine.describeSetup().fields;
    const tm = fields.find((f) => f.key === "tmPercent");
    expect(tm).toBeDefined();
    expect(tm?.type).toBe("select");
    expect(tm?.defaultValue).toBe("90");
    expect(fields.some((f) => f.key === "focusMuscles")).toBe(true);
  });

  it("exposes accessory volume as a per-block choice defaulting to medium (ADR 0024)", () => {
    const field = hybridProgramEngine
      .describeSetup()
      .fields.find((f) => f.key === "accessoryVolume");
    expect(field).toBeDefined();
    expect(field?.type).toBe("select");
    expect(field?.defaultValue).toBe("medium");
    expect(field?.options?.map((o) => o.value)).toEqual(["low", "medium", "high"]);
  });

  it("maps accessoryVolume through to the instance, and omits it when unset", () => {
    for (const level of ["low", "medium", "high"] as const) {
      const instance = hybridProgramEngine.setup(
        { values: { daysPerWeek: 4, startedOn: "2026-01-05", accessoryVolume: level } },
        CTX,
      );
      expect(instance.accessoryVolume).toBe(level);
    }

    // No wizard value (legacy instance / Season deploy predating the field):
    // the key stays absent so the engine falls back to its byte-identical
    // `medium` default rather than being pinned by an explicit write.
    const unset = hybridProgramEngine.setup(
      { values: { daysPerWeek: 4, startedOn: "2026-01-05" } },
      CTX,
    );
    expect(unset.accessoryVolume).toBeUndefined();
  });

  it("rejects an out-of-range accessoryVolume rather than silently coercing it", () => {
    expect(() =>
      hybridProgramEngine.setup(
        { values: { daysPerWeek: 4, startedOn: "2026-01-05", accessoryVolume: "maximum" } },
        CTX,
      ),
    ).toThrow();
  });

  it("keeps tmPercent OUT of the instance/context input (parity is preserved)", () => {
    // tmPercent is read at DEPLOY time (to seed training_maxes.tm_percent), not
    // threaded through the shared assembly input — so the instance is identical
    // whether or not the user picked an intensity.
    const withTm = hybridProgramEngine.setup(
      { values: { daysPerWeek: 4, startedOn: "2026-01-05", tmPercent: "95" } },
      CTX,
    );
    const withoutTm = hybridProgramEngine.setup(
      { values: { daysPerWeek: 4, startedOn: "2026-01-05" } },
      CTX,
    );
    expect(toContextInput(withTm)).toEqual(toContextInput(withoutTm));
    expect("tmPercent" in (withTm as Record<string, unknown>)).toBe(false);
  });

  it("resolveHybridTmPercent clamps + defaults out-of-range / junk to 90", () => {
    expect(resolveHybridTmPercent("85")).toBe(85);
    expect(resolveHybridTmPercent("92.5")).toBe(92.5);
    expect(resolveHybridTmPercent(95)).toBe(95);
    expect(resolveHybridTmPercent(undefined)).toBe(90);
    expect(resolveHybridTmPercent("")).toBe(90);
    expect(resolveHybridTmPercent("nope")).toBe(90);
    expect(resolveHybridTmPercent(40)).toBe(90); // below floor
    expect(resolveHybridTmPercent(120)).toBe(90); // above ceiling
  });

  it("always hardwires the concurrent_hybrid archetype, ignoring any stray input", () => {
    const instance = hybridProgramEngine.setup(
      // Even if a legacy `archetypeId` leaks in, it must be ignored.
      { values: { archetypeId: "strength_anchor", daysPerWeek: 4, startedOn: "2026-01-05" } },
      CTX,
    );
    expect(instance.archetypeId).toBe(HYBRID_ARCHETYPE);
  });

  it("carries the injected daysPerWeek (from the Schedule step) onto the instance", () => {
    for (const days of [2, 3, 4, 5, 6]) {
      const instance = hybridProgramEngine.setup(
        { values: { daysPerWeek: days, startedOn: "2026-01-05" } },
        CTX,
      );
      expect(instance.daysPerWeek).toBe(days);
    }
  });

  it("maps focusMuscles (0–2) through to the instance", () => {
    const none = hybridProgramEngine.setup(
      { values: { daysPerWeek: 4, startedOn: "2026-01-05" } },
      CTX,
    );
    expect(none.focusMuscles).toEqual([]);

    const two = hybridProgramEngine.setup(
      { values: { daysPerWeek: 4, startedOn: "2026-01-05", focusMuscles: ["biceps", "triceps"] } },
      CTX,
    );
    expect(two.focusMuscles).toEqual(["biceps", "triceps"]);
  });

  it("produces the identical input the shared parseCreateBlockInput would for concurrent_hybrid", () => {
    const instance = hybridProgramEngine.setup(
      { values: { daysPerWeek: 5, startedOn: "2026-02-02", focusMuscles: ["calves"] } },
      CTX,
    );
    const expected = parseCreateBlockInput({
      archetype: HYBRID_ARCHETYPE,
      startedOn: "2026-02-02",
      daysPerWeek: 5,
      focusMuscles: ["calves"],
    });
    expect(expected.ok).toBe(true);
    if (!expected.ok) return;
    expect(toContextInput(instance)).toEqual(expected.input);
  });

  it("throws on invalid input (the platform catches)", () => {
    // daysPerWeek out of range.
    expect(() =>
      hybridProgramEngine.setup({ values: { daysPerWeek: 9, startedOn: "2026-01-05" } }, CTX),
    ).toThrow();
    // bad start date.
    expect(() =>
      hybridProgramEngine.setup({ values: { daysPerWeek: 4, startedOn: "not-a-date" } }, CTX),
    ).toThrow();
  });
});

describe("Hybrid engine — pure timeline enumeration", () => {
  const daysPerWeek = 4;
  const instance = hybridProgramEngine.setup(
    { values: { daysPerWeek, startedOn: "2026-01-05" } },
    CTX,
  );
  const archetype = ARCHETYPES[HYBRID_ARCHETYPE];
  const activeDays = foldDualMainLifts(
    archetype,
    daysForFrequency(archetype, daysPerWeek, false),
  );

  it("produces one spec per active day per week", () => {
    const specs = hybridProgramEngine.timeline(instance);
    expect(specs).toHaveLength(archetype.weeks * activeDays.length);
  });

  it("emits unique refs and a monotonic 0-based index", () => {
    const specs = hybridProgramEngine.timeline(instance);
    const refs = specs.map((s) => s.ref);
    expect(new Set(refs).size).toBe(specs.length);
    specs.forEach((s, i) => expect(s.index).toBe(i));
  });

  it("tags deload weeks with kind='deload' and others 'training'", () => {
    const specs = hybridProgramEngine.timeline(instance);
    expect(specs.some((s) => s.kind === "training")).toBe(true);
    for (const spec of specs) {
      const week = Number(/^w(\d+)-/.exec(spec.ref)?.[1]);
      const weekProfile = archetype.weekProfiles.find((w) => w.weekIndex === week);
      const expectedKind = weekProfile?.intensityLabel === "Deload" ? "deload" : "training";
      expect(spec.kind).toBe(expectedKind);
    }
  });
});
