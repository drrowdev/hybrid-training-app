import { describe, expect, it } from "vitest";
import { TRAINING_MAX_WARMUP, wendler531Engine } from "@hta/wendler";
import {
  PROGRAM_WARMUP_SCHEMES,
  TRAINING_MAX_ANCHORED_WARMUP_SCHEME,
  programIdFromJoinedBlock,
  programOwnsWarmupScheme,
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

describe("warmupSchemeForProgram", () => {
  it("a 5/3/1-family block uses the program's own fixed %-of-TM ramp, not the user ladder", () => {
    const scheme = warmupSchemeForProgram(wendler531Engine.meta.id, USER_SCHEME);
    expect(scheme).not.toEqual(USER_SCHEME);
    expect(scheme.percentLadder).toEqual([40, 50, 60]);
    expect(scheme.repLadder).toEqual([5, 5, 3]);
    expect(warmupAnchorOf(scheme)).toBe("training_max");
    expect(isWellFormedScheme(scheme)).toBe(true);
  });

  it("that ramp is flat across the wave — 200 kg TM warms up 80/100/120 kg every week", () => {
    const scheme = warmupSchemeForProgram(wendler531Engine.meta.id, USER_SCHEME);
    const kgForTopSet = (topWorkingPercent: number) =>
      generateWarmupItems("dl", topWorkingPercent, scheme).map(
        (item) => (200 * (item.percentTm ?? 0)) / 100,
      );

    expect(kgForTopSet(85)).toEqual([80, 100, 120]);
    expect(kgForTopSet(90)).toEqual([80, 100, 120]);
    expect(kgForTopSet(95)).toEqual([80, 100, 120]);
  });

  it("blocks with no program (native archetypes, quick sessions) keep the user's ladder", () => {
    expect(warmupSchemeForProgram(null, USER_SCHEME)).toBe(USER_SCHEME);
    expect(warmupSchemeForProgram(undefined, USER_SCHEME)).toBe(USER_SCHEME);
    expect(warmupSchemeForProgram("", USER_SCHEME)).toBe(USER_SCHEME);
  });

  it("a program with no published ramp keeps the user's ladder", () => {
    expect(warmupSchemeForProgram("some-other-program", USER_SCHEME)).toBe(
      USER_SCHEME,
    );
    expect(warmupSchemeForProgram("some-other-program", DEFAULT_WARMUP_SCHEME)).toBe(
      DEFAULT_WARMUP_SCHEME,
    );
    expect(programOwnsWarmupScheme("some-other-program")).toBe(false);
    expect(programOwnsWarmupScheme(wendler531Engine.meta.id)).toBe(true);
    expect(programOwnsWarmupScheme(null)).toBe(false);
  });

  it("is derived from the engine's own config, so the two can't drift (plan 6.9)", () => {
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
    // The registry key is the engine's own id — it can't drift either.
    expect(Object.keys(PROGRAM_WARMUP_SCHEMES)).toEqual([
      wendler531Engine.meta.id,
    ]);
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
