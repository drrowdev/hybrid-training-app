/**
 * Hybrid program engine — Phase 0 parity test (ADR 0046, step P0b-2).
 *
 * WHY THIS ISN'T A FULL ROW-LEVEL GOLDEN AGAINST A LIVE DB
 * --------------------------------------------------------
 * Hybrid's `materializeNative` calls the EXACT SAME shared functions the legacy
 * `createBlock` server action uses — `buildBlockAssemblyContext` (DB load +
 * movement resolution + day expansion) and `assembleBlockSessions` (the pure
 * week×day row builder). Those two functions are already pinned by the planner
 * golden snapshot suite (`src/lib/planner`, 120 files / 1689 tests). Because
 * Hybrid REUSES them verbatim, its downstream `planned_sessions` output is
 * parity-identical to `createBlock` BY CONSTRUCTION — re-asserting it here would
 * just duplicate the existing golden coverage behind a mock Supabase client.
 *
 * So the ONLY genuinely new surface Hybrid introduces is:
 *   (a) the wizard-values → `BuildBlockAssemblyContextInput` mapping
 *       (`setup` → `toContextInput`), and
 *   (b) the pure `timeline` calendar skeleton.
 * This file pins exactly those. For (a) we compare against `createBlock`'s REAL
 * mapper (`parseCreateBlockInput`, the shared single source of truth that
 * `createBlock` itself now calls) rather than a hand-copied literal, so the two
 * paths can never drift.
 */
import { describe, it, expect } from "vitest";
import {
  hybridProgramEngine,
  toContextInput,
  type HybridInstance,
} from "../engine";
import { parseCreateBlockInput } from "@/lib/planner/create-block-input";
import {
  ARCHETYPES,
  daysForFrequency,
  type ArchetypeId,
} from "@/lib/planner/archetypes";
import { foldDualMainLifts } from "@/lib/planner/main-lift-folding";
import type { PlatformContext } from "@hta/program-core";

const CTX: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };

const ARCHETYPE_IDS: ArchetypeId[] = [
  "strength_anchor",
  "endurance_anchor",
  "rebuild",
  "hypertrophy_anchor",
  "concurrent_hybrid",
  "maintenance",
];

/**
 * A single logical wizard submission expressed once, then projected into both
 * the Hybrid `setup` value shape and the equivalent `createBlock` raw shape.
 * The two mappers must produce the identical `BuildBlockAssemblyContextInput`.
 */
type Combo = {
  name: string;
  archetypeId: ArchetypeId;
  startedOn: string;
  daysPerWeek: number;
  focusMuscles?: string[];
  goal?: string;
  secondaryFocus?: string;
  accessoryVolume?: string;
  powerEmphasis?: boolean;
  cardioSource?: "internal" | "external";
  cardioSourceName?: string;
  /** Parsed-object form; the test stringifies it for the createBlock path. */
  dayIndexOverrides?: unknown;
};

function hybridValues(c: Combo): Record<string, unknown> {
  return {
    archetypeId: c.archetypeId,
    startedOn: c.startedOn,
    daysPerWeek: c.daysPerWeek,
    ...(c.focusMuscles !== undefined ? { focusMuscles: c.focusMuscles } : {}),
    ...(c.goal !== undefined ? { goal: c.goal } : {}),
    ...(c.secondaryFocus !== undefined ? { secondaryFocus: c.secondaryFocus } : {}),
    ...(c.accessoryVolume !== undefined ? { accessoryVolume: c.accessoryVolume } : {}),
    ...(c.powerEmphasis !== undefined ? { powerEmphasis: c.powerEmphasis } : {}),
    ...(c.cardioSource !== undefined ? { cardioSource: c.cardioSource } : {}),
    ...(c.cardioSourceName !== undefined ? { cardioSourceName: c.cardioSourceName } : {}),
    // Hybrid accepts the already-parsed object directly.
    ...(c.dayIndexOverrides !== undefined ? { dayIndexOverrides: c.dayIndexOverrides } : {}),
  };
}

function createBlockRaw(c: Combo): Record<string, unknown> {
  return {
    archetype: c.archetypeId,
    startedOn: c.startedOn,
    daysPerWeek: c.daysPerWeek,
    focusMuscles: c.focusMuscles ?? [],
    goal: c.goal,
    secondaryFocus: c.secondaryFocus,
    accessoryVolume: c.accessoryVolume,
    powerEmphasis: c.powerEmphasis,
    cardioSource: c.cardioSource,
    cardioSourceName: c.cardioSourceName,
    // createBlock receives the JSON-stringified payload (FormData channel).
    dayIndexOverrides:
      c.dayIndexOverrides !== undefined ? JSON.stringify(c.dayIndexOverrides) : undefined,
  };
}

const PLACEMENTS_PAYLOAD = {
  days: [0, 2, 4],
  twoADay: false,
  placements: [
    { dayIndex: 0, slot: "single", kind: "strength", weightKey: "squat" },
    { dayIndex: 2, slot: "single", kind: "cardio", weightKey: "z2" },
  ],
};

const COMBOS: Combo[] = [
  // (1) Every one of the 6 archetype presets, minimal options.
  ...ARCHETYPE_IDS.map(
    (id): Combo => ({
      name: `preset:${id}`,
      archetypeId: id,
      startedOn: "2026-01-05",
      daysPerWeek: 4,
    }),
  ),
  // (2) Representative option combos.
  {
    name: "focusMuscles",
    archetypeId: "hypertrophy_anchor",
    startedOn: "2026-02-02",
    daysPerWeek: 5,
    focusMuscles: ["biceps", "triceps"],
  },
  {
    name: "secondaryFocus",
    archetypeId: "concurrent_hybrid",
    startedOn: "2026-03-09",
    daysPerWeek: 4,
    goal: "strength",
    secondaryFocus: "cardio",
  },
  {
    name: "accessoryVolume:high",
    archetypeId: "strength_anchor",
    startedOn: "2026-04-06",
    daysPerWeek: 3,
    accessoryVolume: "high",
  },
  {
    name: "powerEmphasis",
    archetypeId: "strength_anchor",
    startedOn: "2026-05-04",
    daysPerWeek: 4,
    powerEmphasis: true,
  },
  {
    name: "dayIndexOverrides",
    archetypeId: "concurrent_hybrid",
    startedOn: "2026-06-01",
    daysPerWeek: 3,
    dayIndexOverrides: PLACEMENTS_PAYLOAD,
  },
  {
    name: "cardioSource:external",
    archetypeId: "endurance_anchor",
    startedOn: "2026-07-06",
    daysPerWeek: 4,
    cardioSource: "external",
    cardioSourceName: "Runna",
  },
];

describe("Hybrid engine — input-mapping parity with createBlock", () => {
  it.each(COMBOS.map((c) => [c.name, c] as const))(
    "%s maps to the identical BuildBlockAssemblyContextInput",
    (_name, combo) => {
      const expected = parseCreateBlockInput(createBlockRaw(combo));
      expect(expected.ok).toBe(true);
      if (!expected.ok) return;

      const instance = hybridProgramEngine.setup({ values: hybridValues(combo) }, CTX);
      const actual = toContextInput(instance);

      expect(actual).toEqual(expected.input);
    },
  );

  it("throws on invalid input (the platform catches)", () => {
    expect(() =>
      hybridProgramEngine.setup(
        { values: { archetypeId: "not_a_real_archetype", startedOn: "2026-01-05", daysPerWeek: 4 } },
        CTX,
      ),
    ).toThrow();
    expect(() =>
      hybridProgramEngine.setup(
        { values: { archetypeId: "strength_anchor", startedOn: "2026-01-05", daysPerWeek: 9 } },
        CTX,
      ),
    ).toThrow();
  });
});

describe("Hybrid engine — pure timeline enumeration", () => {
  const archetypeId: ArchetypeId = "concurrent_hybrid";
  const daysPerWeek = 4;
  const instance: HybridInstance = hybridProgramEngine.setup(
    { values: { archetypeId, startedOn: "2026-01-05", daysPerWeek } },
    CTX,
  );
  const archetype = ARCHETYPES[archetypeId];
  // The skeleton mirrors createBlock's grid with allowsTwoADays = false.
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
    // There is at least one non-deload week in any real archetype.
    expect(specs.some((s) => s.kind === "training")).toBe(true);
    for (const spec of specs) {
      // Recover the week from the ref (`w{week}-d{day}-{slot}`).
      const week = Number(/^w(\d+)-/.exec(spec.ref)?.[1]);
      const weekProfile = archetype.weekProfiles.find((w) => w.weekIndex === week);
      const expectedKind =
        weekProfile?.intensityLabel === "Deload" ? "deload" : "training";
      expect(spec.kind).toBe(expectedKind);
    }
  });
});
