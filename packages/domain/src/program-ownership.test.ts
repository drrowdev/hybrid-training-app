import { describe, expect, it } from "vitest";
import { PROGRAM_KINDS, programKindAllowsActivity, reviewProgramActivation, type ActiveBlockIdentity, type BlockProgramKind } from "./program-ownership";

function permutations<T>(values: readonly T[]): T[][] {
  return values.length === 0 ? [[]] : values.flatMap((value, index) =>
    permutations(values.filter((_, i) => i !== index)).map((tail) => [value, ...tail]));
}

describe("DC-R5/DC-K4/DC-SW7 independent program ownership", () => {
  it.each(permutations<BlockProgramKind>(["strength", "running", "hybrid"]))(
    "allows every non-swim creation order: %s, %s, %s",
    (...order) => {
      const active: ActiveBlockIdentity[] = [];
      for (const kind of order) {
        expect(reviewProgramActivation(kind, active)).toEqual({ ok: true, replaceBlockId: null });
        active.push({ id: kind, programKind: kind });
      }
      expect(active).toHaveLength(3);
    },
  );
  it("requires the exact same-kind replacement without changing the other slots", () => {
    const active: ActiveBlockIdentity[] = [{ id: "s", programKind: "strength" }, { id: "r", programKind: "running" }];
    const original = structuredClone(active);
    expect(reviewProgramActivation("strength", active)).toEqual({ ok: false, reason: "replacement-required" });
    expect(reviewProgramActivation("strength", active, "r")).toEqual({ ok: false, reason: "replacement-mismatch" });
    expect(reviewProgramActivation("strength", active, "s")).toEqual({ ok: true, replaceBlockId: "s" });
    expect(reviewProgramActivation("hybrid", active, "s")).toEqual({ ok: false, reason: "replacement-mismatch" });
    expect(active).toEqual(original);
  });
  it("refuses legacy coexistence even with replacement consent", () => {
    for (const kind of ["strength", "running", "hybrid"] as const) {
      expect(reviewProgramActivation(kind, [{ id: "legacy", programKind: null }], "legacy"))
        .toEqual({ ok: false, reason: "legacy-active" });
    }
  });
  it("never resolves a duplicate kind by choosing the newest program", () => {
    expect(reviewProgramActivation("strength", [{ id: "a", programKind: "strength" }, { id: "b", programKind: "strength" }], "b"))
      .toEqual({ ok: false, reason: "duplicate-kind" });
  });
  it("allows owned rehab in all four types but reserves mixed ordinary work for Hybrid", () => {
    for (const kind of PROGRAM_KINDS) expect(programKindAllowsActivity(kind, "rehab")).toBe(true);
    for (const activity of ["strength", "run", "bike", "row", "ski"] as const) {
      expect(programKindAllowsActivity("hybrid", activity)).toBe(true);
      expect(programKindAllowsActivity("strength", activity)).toBe(activity === "strength");
      expect(programKindAllowsActivity("running", activity)).toBe(activity === "run");
      expect(programKindAllowsActivity("swimming", activity)).toBe(false);
    }
  });
});
