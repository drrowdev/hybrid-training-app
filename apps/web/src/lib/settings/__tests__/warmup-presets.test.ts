import { describe, expect, it } from "vitest";
import {
  WARMUP_PRESETS,
  presetByKey,
  presetKeyForScheme,
} from "../warmup-presets";
import { DEFAULT_WARMUP_SCHEME } from "@/lib/planner/warmups";

describe("warmup presets", () => {
  it("standard preset equals the engine default scheme", () => {
    expect(presetByKey("standard").scheme).toEqual(DEFAULT_WARMUP_SCHEME);
  });

  it("skip preset is setCount: 0 with empty ladders", () => {
    const skip = presetByKey("skip").scheme;
    expect(skip.setCount).toBe(0);
    expect(skip.percentLadder).toEqual([]);
    expect(skip.repLadder).toEqual([]);
  });

  it("long preset is 4 sets, quick is 2 sets", () => {
    expect(presetByKey("long").scheme.setCount).toBe(4);
    expect(presetByKey("quick").scheme.setCount).toBe(2);
  });

  it("each non-custom preset has matching ladder lengths", () => {
    for (const p of WARMUP_PRESETS) {
      if (p.key === "custom") continue;
      expect(p.scheme.percentLadder.length).toBe(p.scheme.setCount);
      expect(p.scheme.repLadder.length).toBe(p.scheme.setCount);
    }
  });
});

describe("presetKeyForScheme", () => {
  it("maps the default scheme to 'standard'", () => {
    expect(presetKeyForScheme(DEFAULT_WARMUP_SCHEME)).toBe("standard");
  });

  it("maps each preset's own scheme back to its key", () => {
    for (const p of WARMUP_PRESETS) {
      if (p.key === "custom") continue;
      expect(presetKeyForScheme(p.scheme)).toBe(p.key);
    }
  });

  it("falls back to 'custom' for a unique scheme", () => {
    expect(
      presetKeyForScheme({
        setCount: 3,
        percentLadder: [42, 55, 70],
        repLadder: [5, 3, 2],
      }),
    ).toBe("custom");
  });

  it("falls back to 'custom' when ladder lengths differ from any preset", () => {
    expect(
      presetKeyForScheme({
        setCount: 1,
        percentLadder: [60],
        repLadder: [3],
      }),
    ).toBe("custom");
  });
});
