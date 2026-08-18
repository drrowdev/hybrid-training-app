import { describe, expect, it } from "vitest";
import { GLOBAL_WARMUP_PERCENTS, GLOBAL_WARMUP_REPS } from "@hta/program-core";
import {
  DEFAULT_WARMUP_SCHEME,
  LEGACY_DEFAULT_WARMUP_SCHEME,
  fractionToPercent,
  generateWarmupItems,
  isLegacyDefaultWarmupScheme,
  isWellFormedScheme,
  roundWarmupLoadKg,
  resolveWarmupPreference,
  resolveWarmupScheme,
  warmupAnchorOf,
  warmupSchemeToRamp,
  type WarmupScheme,
} from "../warmups";

describe("resolveWarmupPreference — 'never chose' is not 'chose the default'", () => {
  it("NULL means no preference, so a program's own ramp still applies", () => {
    // Migration 0039 added warmup_scheme with no backfill and the settings
    // editor is its only writer, so NULL provably means "never touched".
    expect(resolveWarmupPreference(null)).toEqual({ mode: "program" });
    expect(resolveWarmupPreference(undefined)).toEqual({ mode: "program" });
  });

  it("a stored ladder is an explicit choice, even when it equals the default", () => {
    // The distinction resolveWarmupScheme cannot make: this payload is
    // byte-identical to the app default but was deliberately written.
    const preference = resolveWarmupPreference({ ...DEFAULT_WARMUP_SCHEME });
    expect(preference.mode).toBe("user");
    expect(preference).toMatchObject({ scheme: DEFAULT_WARMUP_SCHEME });
  });

  it("setCount 0 is a real preference, not an absent one", () => {
    expect(
      resolveWarmupPreference({ setCount: 0, percentLadder: [], repLadder: [] }),
    ).toEqual({
      mode: "user",
      scheme: { setCount: 0, percentLadder: [], repLadder: [] },
    });
  });

  it("the 0039-era payload counts as a choice, upgraded to the current default", () => {
    expect(resolveWarmupPreference({ ...LEGACY_DEFAULT_WARMUP_SCHEME })).toEqual({
      mode: "user",
      scheme: DEFAULT_WARMUP_SCHEME,
    });
  });

  it("a malformed blob is not a preference", () => {
    // Conservative reading: an unreadable payload should not defeat a
    // program's published ramp.
    expect(resolveWarmupPreference({ setCount: 3, percentLadder: [40] })).toEqual({
      mode: "program",
    });
    expect(resolveWarmupPreference("nonsense")).toEqual({ mode: "program" });
  });

  it("agrees with resolveWarmupScheme on the resulting ladder whenever one is chosen", () => {
    for (const stored of [
      { ...DEFAULT_WARMUP_SCHEME },
      { ...LEGACY_DEFAULT_WARMUP_SCHEME },
      { setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] },
    ]) {
      const preference = resolveWarmupPreference(stored);
      expect(preference.mode).toBe("user");
      if (preference.mode === "user") {
        expect(preference.scheme).toEqual(resolveWarmupScheme(stored));
      }
    }
  });
});

describe("warmupSchemeToRamp — app percent space → engine fraction space", () => {
  it("converts percents to fractions and carries the anchor", () => {
    expect(
      warmupSchemeToRamp({ setCount: 2, percentLadder: [50, 75], repLadder: [5, 3] }),
    ).toEqual({ percents: [0.5, 0.75], reps: [5, 3], anchor: "top_set" });
  });

  it("setCount 0 becomes an EMPTY ramp — how 'skip warm-ups' reaches an engine", () => {
    expect(
      warmupSchemeToRamp({ setCount: 0, percentLadder: [], repLadder: [] }),
    ).toEqual({ percents: [], reps: [], anchor: "top_set" });
  });

  it("round-trips the app default back to the shared global ramp", () => {
    const ramp = warmupSchemeToRamp(DEFAULT_WARMUP_SCHEME);
    expect(ramp.percents).toEqual([...GLOBAL_WARMUP_PERCENTS]);
    expect(ramp.reps).toEqual([...GLOBAL_WARMUP_REPS]);
  });

  it("never emits more rungs than setCount, even if a ladder carries junk", () => {
    expect(
      warmupSchemeToRamp({
        setCount: 2,
        percentLadder: [40, 60, 80],
        repLadder: [5, 5, 3],
      } as WarmupScheme),
    ).toEqual({ percents: [0.4, 0.6], reps: [5, 5], anchor: "top_set" });
  });
});

describe("generateWarmupItems", () => {
  it("default scheme + 85% top set → 3 warmups at 34/51/68% × 5/5/3", () => {
    const items = generateWarmupItems("sq", 85, DEFAULT_WARMUP_SCHEME);
    expect(items).toHaveLength(3);
    expect(items.map((i) => i.percentTm)).toEqual([34, 51, 68]);
    expect(items.map((i) => i.reps)).toEqual([5, 5, 3]);
    expect(items.every((i) => i.kind === "warmup")).toBe(true);
    expect(items.every((i) => i.movementId === "sq")).toBe(true);
  });

  it("setCount: 0 returns empty array", () => {
    const skip: WarmupScheme = { setCount: 0, percentLadder: [], repLadder: [] };
    expect(generateWarmupItems("sq", 85, skip)).toEqual([]);
  });

  it("malformed length mismatch falls back to default", () => {
    const bad = {
      setCount: 3,
      percentLadder: [40, 50],
      repLadder: [5, 3, 2],
    } as WarmupScheme;
    const items = generateWarmupItems("sq", 85, bad);
    expect(items.map((i) => i.percentTm)).toEqual([34, 51, 68]);
    expect(items.map((i) => i.reps)).toEqual([5, 5, 3]);
  });

  it("100% TM top set → 40/60/80 × 5/5/3 with default scheme", () => {
    const items = generateWarmupItems("dl", 100, DEFAULT_WARMUP_SCHEME);
    expect(items.map((i) => i.percentTm)).toEqual([40, 60, 80]);
    expect(items.map((i) => i.reps)).toEqual([5, 5, 3]);
  });

  it("warmup ladder gives loadable rounded examples for a 140 kg TM deadlift and 60 kg TM press", () => {
    const items = generateWarmupItems("dl", 85, DEFAULT_WARMUP_SCHEME);
    const pressItems = generateWarmupItems("ohp", 85, DEFAULT_WARMUP_SCHEME);
    const roundToPlate = (kg: number) => Math.round(kg / 2.5) * 2.5;

    expect(items.map((i) => roundToPlate((140 * (i.percentTm ?? 0)) / 100))).toEqual([
      47.5,
      72.5,
      95,
    ]);
    expect(pressItems.map((i) => roundToPlate((60 * (i.percentTm ?? 0)) / 100))).toEqual([
      20,
      30,
      40,
    ]);
  });

  it("keeps a small barbell warmup at or above the empty bar and uses the available plate increment", () => {
    expect(
      roundWarmupLoadKg(60 * 34 / 100, {
        barWeightKg: 20,
        availablePlateWeightsKg: [5, 10, 20],
      }),
    ).toBe(20);
    expect(
      roundWarmupLoadKg(26, {
        barWeightKg: 20,
        availablePlateWeightsKg: [5, 10, 20],
      }),
    ).toBe(30);
    expect(
      roundWarmupLoadKg(18, {
        barWeightKg: 20,
        availablePlateWeightsKg: [1.25, 2.5, 5],
      }),
    ).toBe(20);
  });

  it("does not impose a barbell floor when no bar weight is supplied", () => {
    // Dumbbell, machine, and bodyweight callers omit barWeightKg; only the
    // optional rounding increment applies, never a 20 kg minimum.
    expect(
      roundWarmupLoadKg(8, { availablePlateWeightsKg: [1] }),
    ).toBe(8);
    expect(roundWarmupLoadKg(8)).toBe(7.5);
  });

  it("rounds to nearest 0.5%: top 73%, ladder entry 50% → 36.5%", () => {
    const scheme: WarmupScheme = {
      setCount: 1,
      percentLadder: [50],
      repLadder: [5],
    };
    const items = generateWarmupItems("bp", 73, scheme);
    // 73 * 0.50 = 36.5 — exact half, no rounding artifact.
    expect(items[0]!.percentTm).toBe(36.5);
  });

  it("rounds 33.3333… down to 33.5 (nearest half)", () => {
    // 66.6666… * 50% = 33.3333…, nearest 0.5 is 33.5.
    const scheme: WarmupScheme = {
      setCount: 1,
      percentLadder: [50],
      repLadder: [5],
    };
    const items = generateWarmupItems("bp", 200 / 3, scheme);
    expect(items[0]!.percentTm).toBe(33.5);
  });

  it("copies movementSlug + movementName onto each warmup", () => {
    const items = generateWarmupItems("sq", 85, DEFAULT_WARMUP_SCHEME, {
      movementSlug: "back_squat",
      movementName: "Back Squat",
    });
    expect(items.every((i) => i.movementSlug === "back_squat")).toBe(true);
    expect(items.every((i) => i.movementName === "Back Squat")).toBe(true);
  });

  it("intensityLabel matches the rounded percentTm", () => {
    const items = generateWarmupItems("sq", 85, DEFAULT_WARMUP_SCHEME);
    expect(items.map((i) => i.intensityLabel)).toEqual([
      "34% TM",
      "51% TM",
      "68% TM",
    ]);
  });

  it("returns [] when topWorkingPercent is 0 or negative", () => {
    expect(generateWarmupItems("sq", 0, DEFAULT_WARMUP_SCHEME)).toEqual([]);
    expect(generateWarmupItems("sq", -10, DEFAULT_WARMUP_SCHEME)).toEqual([]);
  });
});

describe("isWellFormedScheme / resolveWarmupScheme", () => {
  it("accepts the default scheme", () => {
    expect(isWellFormedScheme(DEFAULT_WARMUP_SCHEME)).toBe(true);
  });

  it("accepts skip-warmups (setCount 0 + empty ladders)", () => {
    expect(
      isWellFormedScheme({ setCount: 0, percentLadder: [], repLadder: [] }),
    ).toBe(true);
  });

  it("rejects mismatched ladder lengths", () => {
    expect(
      isWellFormedScheme({ setCount: 3, percentLadder: [40, 50], repLadder: [5, 3, 2] }),
    ).toBe(false);
  });

  it("rejects out-of-range setCount", () => {
    expect(
      isWellFormedScheme({ setCount: 6, percentLadder: [10, 20, 30, 40, 50, 60], repLadder: [5, 5, 5, 5, 5, 5] }),
    ).toBe(false);
    expect(
      isWellFormedScheme({ setCount: -1, percentLadder: [], repLadder: [] }),
    ).toBe(false);
  });

  it("resolveWarmupScheme falls back on null/undefined/malformed", () => {
    expect(resolveWarmupScheme(null)).toEqual(DEFAULT_WARMUP_SCHEME);
    expect(resolveWarmupScheme(undefined)).toEqual(DEFAULT_WARMUP_SCHEME);
    expect(resolveWarmupScheme({ foo: "bar" })).toEqual(DEFAULT_WARMUP_SCHEME);
    expect(
      resolveWarmupScheme({ setCount: 2, percentLadder: [50], repLadder: [5] }),
    ).toEqual(DEFAULT_WARMUP_SCHEME);
  });

  it("resolveWarmupScheme preserves a valid custom scheme", () => {
    const custom: WarmupScheme = {
      setCount: 2,
      percentLadder: [50, 65],
      repLadder: [5, 3],
    };
    expect(resolveWarmupScheme(custom)).toEqual(custom);
  });

  it("upgrades the exact migration-0039 default without changing other valid schemes", () => {
    expect(isLegacyDefaultWarmupScheme(LEGACY_DEFAULT_WARMUP_SCHEME)).toBe(true);
    expect(resolveWarmupScheme(LEGACY_DEFAULT_WARMUP_SCHEME)).toEqual(
      DEFAULT_WARMUP_SCHEME,
    );
    // The upgrade is a read-boundary concern: callers that resolve first get
    // the new ladder...
    expect(
      generateWarmupItems(
        "sq",
        85,
        resolveWarmupScheme(LEGACY_DEFAULT_WARMUP_SCHEME),
      ).map((item) => item.percentTm),
    ).toEqual([34, 51, 68]);
  });

  it("generateWarmupItems is faithful to the scheme it is handed", () => {
    // ...but generation itself never rewrites its input, so a preview of an
    // in-flight scheme can't contradict the inputs the user just typed.
    const items = generateWarmupItems("sq", 85, LEGACY_DEFAULT_WARMUP_SCHEME);
    expect(items.map((item) => item.percentTm)).toEqual([34, 42.5, 51]);
    expect(items.map((item) => item.reps)).toEqual([5, 3, 2]);

    const custom: WarmupScheme = {
      setCount: 3,
      percentLadder: [40, 50, 65],
      repLadder: [5, 3, 2],
    };
    expect(generateWarmupItems("sq", 85, custom).map((i) => i.percentTm)).toEqual(
      [34, 42.5, 55.5],
    );
  });
});

describe("warmup anchor (top_set vs training_max)", () => {
  const TM_ANCHORED: WarmupScheme = {
    setCount: 3,
    percentLadder: [40, 50, 60],
    repLadder: [5, 5, 3],
    anchor: "training_max",
  };

  it("a training_max-anchored ladder is FLAT across the 5s / 3s / 5-3-1 weeks (DC-R3)", () => {
    // The defining property of a fixed %-of-TM ramp: the warm-up does not
    // climb as the top set climbs. Same bar loads every week of the wave.
    const fives = generateWarmupItems("dl", 85, TM_ANCHORED);
    const threes = generateWarmupItems("dl", 90, TM_ANCHORED);
    const oneRepMaxWeek = generateWarmupItems("dl", 95, TM_ANCHORED);

    expect(fives.map((i) => i.percentTm)).toEqual([40, 50, 60]);
    expect(threes.map((i) => i.percentTm)).toEqual([40, 50, 60]);
    expect(oneRepMaxWeek.map((i) => i.percentTm)).toEqual([40, 50, 60]);
    expect(threes).toEqual(fives);
    expect(oneRepMaxWeek).toEqual(fives);

    // Worked in kilograms for a 200 kg training max: 80 / 100 / 120 every week.
    const kgFor = (items: typeof fives) =>
      items.map((i) => (200 * (i.percentTm ?? 0)) / 100);
    expect(kgFor(fives)).toEqual([80, 100, 120]);
    expect(kgFor(threes)).toEqual([80, 100, 120]);
    expect(kgFor(oneRepMaxWeek)).toEqual([80, 100, 120]);

    expect(fives.map((i) => i.reps)).toEqual([5, 5, 3]);
    expect(fives.map((i) => i.intensityLabel)).toEqual([
      "40% TM",
      "50% TM",
      "60% TM",
    ]);
  });

  it("a top_set-anchored ladder still climbs with the top set (regression guard)", () => {
    // The app-wide default is unchanged: percentages OF THE WORK SET.
    const explicit: WarmupScheme = { ...DEFAULT_WARMUP_SCHEME, anchor: "top_set" };
    expect(generateWarmupItems("dl", 85, explicit).map((i) => i.percentTm)).toEqual(
      [34, 51, 68],
    );
    expect(generateWarmupItems("dl", 90, explicit).map((i) => i.percentTm)).toEqual(
      [36, 54, 72],
    );
    expect(generateWarmupItems("dl", 95, explicit).map((i) => i.percentTm)).toEqual(
      [38, 57, 76],
    );
    // ...and an explicit "top_set" is identical to omitting the field.
    expect(generateWarmupItems("dl", 85, explicit)).toEqual(
      generateWarmupItems("dl", 85, DEFAULT_WARMUP_SCHEME),
    );
  });

  it("back-compat: a stored scheme with no anchor is well-formed and means top_set", () => {
    // Every profiles.warmup_scheme blob written before the field existed.
    const stored = JSON.parse(
      '{"setCount":3,"percentLadder":[40,60,80],"repLadder":[5,5,3]}',
    ) as unknown;
    expect(isWellFormedScheme(stored)).toBe(true);
    const resolved = resolveWarmupScheme(stored);
    expect(resolved.anchor).toBeUndefined();
    expect(warmupAnchorOf(resolved)).toBe("top_set");
    expect(generateWarmupItems("dl", 85, resolved).map((i) => i.percentTm)).toEqual(
      [34, 51, 68],
    );
  });

  it("the default scheme never persists an anchor field", () => {
    // Keeps newly written blobs byte-identical to the pre-anchor shape.
    expect("anchor" in DEFAULT_WARMUP_SCHEME).toBe(false);
    expect(warmupAnchorOf(DEFAULT_WARMUP_SCHEME)).toBe("top_set");
  });

  it("an unknown anchor value is rejected", () => {
    expect(
      isWellFormedScheme({
        setCount: 1,
        percentLadder: [40],
        repLadder: [5],
        anchor: "bodyweight",
      }),
    ).toBe(false);
    expect(
      isWellFormedScheme({
        setCount: 1,
        percentLadder: [40],
        repLadder: [5],
        anchor: "training_max",
      }),
    ).toBe(true);
  });

  it("a malformed TM-anchored scheme falls back to the app default (top_set)", () => {
    const bad = {
      setCount: 3,
      percentLadder: [40, 50],
      repLadder: [5, 5, 3],
      anchor: "training_max",
    } as WarmupScheme;
    expect(generateWarmupItems("dl", 85, bad).map((i) => i.percentTm)).toEqual([
      34, 51, 68,
    ]);
  });

  it("setCount 0 and an unloaded movement still short-circuit under either anchor", () => {
    expect(
      generateWarmupItems("dl", 85, {
        setCount: 0,
        percentLadder: [],
        repLadder: [],
        anchor: "training_max",
      }),
    ).toEqual([]);
    expect(generateWarmupItems("dl", 0, TM_ANCHORED)).toEqual([]);
  });
});

describe("DEFAULT_WARMUP_SCHEME is derived, not restated (plan 6.9)", () => {
  it("stays in lockstep with the @hta/program-core global ramp", () => {
    // One home for the ladder: apps/web converts the engine's 0..1 fractions
    // into percent space. If GLOBAL_WARMUP_PERCENTS changes, this default
    // moves with it instead of silently drifting.
    expect(DEFAULT_WARMUP_SCHEME.percentLadder).toEqual(
      GLOBAL_WARMUP_PERCENTS.map((fraction) => fraction * 100),
    );
    expect(DEFAULT_WARMUP_SCHEME.repLadder).toEqual([...GLOBAL_WARMUP_REPS]);
    expect(DEFAULT_WARMUP_SCHEME.setCount).toBe(GLOBAL_WARMUP_PERCENTS.length);
    expect(GLOBAL_WARMUP_PERCENTS.length).toBe(GLOBAL_WARMUP_REPS.length);
    // Pinned literal so a change to either side is a deliberate, reviewed edit.
    expect(DEFAULT_WARMUP_SCHEME.percentLadder).toEqual([40, 60, 80]);
  });

  it("fractionToPercent keeps float noise out of persisted ladders", () => {
    expect(fractionToPercent(0.4)).toBe(40);
    expect(fractionToPercent(0.575)).toBe(57.5);
    expect([0.1, 0.2, 0.3].map(fractionToPercent)).toEqual([10, 20, 30]);
  });
});
