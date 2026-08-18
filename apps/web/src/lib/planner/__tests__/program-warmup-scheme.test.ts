import { describe, expect, it } from "vitest";
import { TRAINING_MAX_WARMUP, wendler531Engine } from "@hta/wendler";
import { tacticalBarbellEngine, zuluHtEngine } from "@hta/tacticalbarbell";
import { hyroxEngine } from "@hta/hyrox";
import { greenProtocolEngine } from "@hta/green";
import { GLOBAL_WARMUP_RAMP } from "@hta/program-core";
import {
  GLOBAL_ANCHORED_WARMUP_SCHEME,
  PROGRAM_WARMUP_SCHEMES,
  TRAINING_MAX_ANCHORED_WARMUP_SCHEME,
  activeProgramWithOwnWarmupRamp,
  programIdFromJoinedBlock,
  programOwnsWarmupScheme,
  programWarmupOptionLabel,
  warmupSchemeForProgram,
} from "../program-warmup-scheme";
import {
  DEFAULT_WARMUP_SCHEME,
  generateWarmupItems,
  isWellFormedScheme,
  warmupAnchorOf,
  type WarmupScheme,
} from "../warmups";

const USER_SCHEME: WarmupScheme = {
  setCount: 2,
  percentLadder: [50, 75],
  repLadder: [5, 3],
};

/** The lifter picked a ladder in settings. */
const CHOSE = { mode: "user", scheme: USER_SCHEME } as const;
/** The lifter has never touched the setting (`warmup_scheme IS NULL`). */
const NO_PREFERENCE = { mode: "program" } as const;

describe("warmupSchemeForProgram — an explicit ladder wins over a program's ramp", () => {
  it("DC-K4: a chosen ladder is honoured inside 5/3/1 rather than silently overruled", () => {
    // Owner decision: programs supply a DEFAULT, they do not overrule a choice.
    // The engine must not quietly substitute its own ramp for one the lifter
    // deliberately configured — that is the silent-overrule DC-K4 forbids.
    expect(warmupSchemeForProgram(wendler531Engine.meta.id, CHOSE)).toBe(
      USER_SCHEME,
    );
  });

  it('DC-K4: "skip warm-ups" is honoured inside every program', () => {
    // profiles.warmup_scheme documents `setCount = 0` as "disables auto-warmups
    // entirely". Before this contract a 5/3/1 block still emitted three sets.
    const skip: WarmupScheme = { setCount: 0, percentLadder: [], repLadder: [] };
    const choseSkip = { mode: "user", scheme: skip } as const;
    for (const programId of Object.keys(PROGRAM_WARMUP_SCHEMES)) {
      expect(warmupSchemeForProgram(programId, choseSkip).setCount).toBe(0);
    }
  });

  it("an explicit ladder also wins for programs that publish no ramp", () => {
    expect(warmupSchemeForProgram(tacticalBarbellEngine.meta.id, CHOSE)).toBe(
      USER_SCHEME,
    );
    expect(warmupSchemeForProgram(hyroxEngine.meta.id, CHOSE)).toBe(USER_SCHEME);
    expect(warmupSchemeForProgram("some-other-program", CHOSE)).toBe(USER_SCHEME);
  });
});

describe("warmupSchemeForProgram — no preference falls back to the program's ramp", () => {
  it("a 5/3/1 block keeps its own fixed %-of-TM ramp for a lifter who never chose", () => {
    const scheme = warmupSchemeForProgram(wendler531Engine.meta.id, NO_PREFERENCE);
    expect(scheme.percentLadder).toEqual([40, 50, 60]);
    expect(scheme.repLadder).toEqual([5, 5, 3]);
    expect(warmupAnchorOf(scheme)).toBe("training_max");
    expect(isWellFormedScheme(scheme)).toBe(true);
  });

  it("that ramp is flat across the wave — 200 kg TM warms up 80/100/120 kg every week", () => {
    const scheme = warmupSchemeForProgram(wendler531Engine.meta.id, NO_PREFERENCE);
    const kgForTopSet = (topWorkingPercent: number) =>
      generateWarmupItems("dl", topWorkingPercent, scheme).map(
        (item) => (200 * (item.percentTm ?? 0)) / 100,
      );

    expect(kgForTopSet(85)).toEqual([80, 100, 120]);
    expect(kgForTopSet(90)).toEqual([80, 100, 120]);
    expect(kgForTopSet(95)).toEqual([80, 100, 120]);
  });

  it("TB / Zulu-HT / HYROX / Green fall back to the SAME shared ramp their engines use", () => {
    // These four publish no ramp of their own — their engines default to
    // program-core's GLOBAL_WARMUP_RAMP. Registering the identical ladder here
    // is what stops a swap from rebuilding a movement differently from the way
    // the session was generated.
    for (const engine of [
      tacticalBarbellEngine,
      zuluHtEngine,
      hyroxEngine,
      greenProtocolEngine,
    ]) {
      const scheme = warmupSchemeForProgram(engine.meta.id, NO_PREFERENCE);
      expect(scheme).toEqual(GLOBAL_ANCHORED_WARMUP_SCHEME);
      expect(warmupAnchorOf(scheme)).toBe("top_set");
    }
  });

  it("blocks with no program (native archetypes, quick sessions) use the app default", () => {
    expect(warmupSchemeForProgram(null, NO_PREFERENCE)).toBe(DEFAULT_WARMUP_SCHEME);
    expect(warmupSchemeForProgram(undefined, NO_PREFERENCE)).toBe(
      DEFAULT_WARMUP_SCHEME,
    );
    expect(warmupSchemeForProgram("", NO_PREFERENCE)).toBe(DEFAULT_WARMUP_SCHEME);
  });

  it("an unknown program id uses the app default", () => {
    expect(warmupSchemeForProgram("some-other-program", NO_PREFERENCE)).toBe(
      DEFAULT_WARMUP_SCHEME,
    );
    expect(programOwnsWarmupScheme("some-other-program")).toBe(false);
    expect(programOwnsWarmupScheme(wendler531Engine.meta.id)).toBe(true);
    expect(programOwnsWarmupScheme(null)).toBe(false);
  });
});

describe("registry derivation (plan §6.9 — no restated constants)", () => {
  it("the 5/3/1 scheme is derived from the engine's own config, so the two can't drift", () => {
    expect(TRAINING_MAX_ANCHORED_WARMUP_SCHEME.percentLadder).toEqual(
      TRAINING_MAX_WARMUP.percents.map((fraction) => fraction * 100),
    );
    expect(TRAINING_MAX_ANCHORED_WARMUP_SCHEME.repLadder).toEqual([
      ...TRAINING_MAX_WARMUP.reps,
    ]);
    expect(TRAINING_MAX_ANCHORED_WARMUP_SCHEME.setCount).toBe(
      TRAINING_MAX_WARMUP.percents.length,
    );
    expect(TRAINING_MAX_ANCHORED_WARMUP_SCHEME.anchor).toBe(
      TRAINING_MAX_WARMUP.anchor,
    );
  });

  it("the shared scheme is derived from program-core's GLOBAL_WARMUP_RAMP", () => {
    expect(GLOBAL_ANCHORED_WARMUP_SCHEME.percentLadder).toEqual(
      GLOBAL_WARMUP_RAMP.percents.map((fraction) => fraction * 100),
    );
    expect(GLOBAL_ANCHORED_WARMUP_SCHEME.repLadder).toEqual([
      ...GLOBAL_WARMUP_RAMP.reps,
    ]);
    expect(GLOBAL_ANCHORED_WARMUP_SCHEME.setCount).toBe(
      GLOBAL_WARMUP_RAMP.percents.length,
    );
  });

  it("every registry key is an engine's own meta.id, so a key can't drift", () => {
    expect(Object.keys(PROGRAM_WARMUP_SCHEMES).sort()).toEqual(
      [
        wendler531Engine.meta.id,
        tacticalBarbellEngine.meta.id,
        zuluHtEngine.meta.id,
        hyroxEngine.meta.id,
        greenProtocolEngine.meta.id,
      ].sort(),
    );
  });
});

describe("activeProgramWithOwnWarmupRamp", () => {
  it("resolves 5/3/1 — the only program that publishes its own ramp", () => {
    const active = activeProgramWithOwnWarmupRamp(wendler531Engine.meta.id);
    expect(active?.id).toBe(wendler531Engine.meta.id);
    expect(active?.scheme).toEqual(TRAINING_MAX_ANCHORED_WARMUP_SCHEME);
  });

  it("resolves null for programs that merely inherit the shared ramp", () => {
    // These are registered so the swap path agrees with generation, but none
    // of them prescribes a warm-up as part of its method — so there is nothing
    // for a chosen ladder to override, and no reason to name them in the UI.
    for (const engine of [
      tacticalBarbellEngine,
      zuluHtEngine,
      hyroxEngine,
      greenProtocolEngine,
    ]) {
      expect(activeProgramWithOwnWarmupRamp(engine.meta.id)).toBeNull();
    }
  });

  it("resolves null with no active block, or a block with no program", () => {
    // A native archetype block carries no program_id, and a lifter between
    // blocks has none at all.
    expect(activeProgramWithOwnWarmupRamp(null)).toBeNull();
    expect(activeProgramWithOwnWarmupRamp(undefined)).toBeNull();
    expect(activeProgramWithOwnWarmupRamp("")).toBeNull();
    expect(activeProgramWithOwnWarmupRamp("some-other-program")).toBeNull();
  });
});

describe("programWarmupOptionLabel", () => {
  it("names the option after the single method that publishes a ramp", () => {
    // Derived from the registry, so it cannot drift from the program it
    // actually follows.
    expect(programWarmupOptionLabel()).toBe(`${wendler531Engine.meta.name} Warmup`);
    expect(programWarmupOptionLabel()).toBe("5/3/1 Warmup");
  });
});

describe("programIdFromJoinedBlock", () => {
  it("reads the embedded training_blocks row in either PostgREST shape", () => {
    expect(
      programIdFromJoinedBlock({ id: "p1", training_blocks: { program_id: "x" } }),
    ).toBe("x");
    expect(
      programIdFromJoinedBlock({ id: "p1", training_blocks: [{ program_id: "x" }] }),
    ).toBe("x");
  });

  it("returns null for an archetype block, a missing embed, or junk", () => {
    expect(
      programIdFromJoinedBlock({ id: "p1", training_blocks: { program_id: null } }),
    ).toBeNull();
    expect(programIdFromJoinedBlock({ id: "p1", training_blocks: [] })).toBeNull();
    expect(programIdFromJoinedBlock({ id: "p1" })).toBeNull();
    expect(programIdFromJoinedBlock(null)).toBeNull();
    expect(programIdFromJoinedBlock("nope")).toBeNull();
  });
});
