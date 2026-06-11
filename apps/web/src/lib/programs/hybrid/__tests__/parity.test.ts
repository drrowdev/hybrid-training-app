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
import { hybridProgramEngine, toContextInput } from "../engine";
import { parseCreateBlockInput } from "@/lib/planner/create-block-input";
import { ARCHETYPES, daysForFrequency } from "@/lib/planner/archetypes";
import { foldDualMainLifts } from "@/lib/planner/main-lift-folding";
import type { PlatformContext } from "@hta/program-core";

const CTX: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };
const HYBRID_ARCHETYPE = "concurrent_hybrid";

describe("Hybrid engine — setup shape", () => {
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
