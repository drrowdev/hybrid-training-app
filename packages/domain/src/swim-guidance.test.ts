import { describe, expect, it } from "vitest";
import { swimItemGuidance } from "./swim-guidance";
import type { SwimItem, SwimWorkout, SwimStroke } from "./swimming";

const workout = { focus: "technique_base", snapshot: { strokes: ["freestyle"] } } as SwimWorkout;
const item: SwimItem = { repeats: 2, lengths: 2, stroke: "freestyle", effort: "easy", equipment: [], optional: false };
describe("DC-SW2/DC-SW3/DC-SW5 snapshot-only guidance", () => {
  it.each(["single_arm", "kick_with_board", "pull_count_strokes"])("explains generated drill %s without inventing pace or changing targets", (drill) => {
    const issued = { ...item, drill, targetMsPerRepeat: 123456 };
    const before = JSON.stringify(issued);
    const result = swimItemGuidance(workout, issued);
    expect(result.drillLabel).not.toBe("Technique drill");
    expect(result.instruction.length).toBeGreaterThan(60);
    expect(result.effort).toContain("breathing");
    expect(JSON.stringify(issued)).toBe(before);
    expect(JSON.stringify(result)).not.toMatch(/123456|\/100|seconds|underwater/);
  });
  it.each(["freestyle", "backstroke", "breaststroke", "butterfly"] as SwimStroke[])("uses stroke-specific single-arm instructions for %s", (stroke) => {
    const result = swimItemGuidance(workout, { ...item, stroke, drill: "single_arm" });
    expect(result.instruction).toMatch(/[Ss]witch arms/);
    if (stroke !== "freestyle") expect(result.instruction).not.toContain("Breathe to the working side");
  });
  it("uses the snapshot stroke for kickboard technique", () => {
    const result = swimItemGuidance({ ...workout, snapshot: { ...workout.snapshot, strokes: ["breaststroke", "kick"] } }, { ...item, stroke: "kick", drill: "kick_with_board" });
    expect(result.instruction).toContain("breaststroke kick");
    expect(result.instruction).not.toContain("Alternate");
  });
  it("does not guess unknown historical drill instructions or reveal slugs", () => {
    const result = swimItemGuidance(workout, { ...item, drill: "old_secret_drill" });
    expect(result.drillLabel).toBe("Technique drill");
    expect(result.instruction).toContain("coach");
    expect(JSON.stringify(result)).not.toContain("old_secret_drill");
  });
  it("gives distinct qualitative effort and focus cues without numeric pacing", () => {
    const cues = ["easy", "steady", "brisk", "threshold", "sprint"].map((effort) =>
      swimItemGuidance(workout, { ...item, effort: effort as SwimItem["effort"] }).effort);
    expect(new Set(cues).size).toBe(5);
    expect(cues.every((cue) => cue.length > 40 && !/\d/.test(cue))).toBe(true);
    const focuses = ["technique_base", "endurance", "event_specific"].map((focus) =>
      swimItemGuidance({ ...workout, focus: focus as SwimWorkout["focus"] }, item).focus);
    expect(new Set(focuses).size).toBe(3);
  });
});
