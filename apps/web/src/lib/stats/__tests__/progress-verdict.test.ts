import { describe, it, expect } from "vitest";
import { getProgressVerdict } from "../progress-verdict";
import type { StrengthProgress, StrengthDirection } from "../strength-progress";
import type { EnduranceProgress, EnduranceDirection } from "../endurance-progress";
import type { HrZoneState } from "../hr-zones";

const NO_ZONES: HrZoneState = { kind: "no-zones" };

function strength(direction: StrengthDirection, opts?: { topSlope?: number; label?: string }): StrengthProgress {
  const slope = opts?.topSlope ?? (direction === "up" ? 1.2 : direction === "down" ? -1.2 : 0);
  return {
    direction,
    perLift:
      direction === "building"
        ? []
        : [
            {
              movementId: "m1",
              slug: "m1",
              label: opts?.label ?? "Bench",
              pointCount: 5,
              slopePerWeek: slope,
              direction,
              points: [],
            },
          ],
    windowDays: 56,
    detail: `strength ${direction}`,
  };
}

function endurance(direction: EnduranceDirection, opts?: { slope?: number; totalRuns?: number }): EnduranceProgress {
  const slope = opts?.slope ?? (direction === "up" ? -8 : direction === "down" ? 8 : 0);
  return {
    direction,
    easyPaceSecPerKm: direction === "no-run-data" ? null : 340,
    slopeSecPerKmPerWeek: direction === "no-run-data" || direction === "building" ? null : slope,
    sampleRuns: direction === "no-run-data" ? 0 : 8,
    droppedRuns: 0,
    totalRuns: opts?.totalRuns ?? (direction === "no-run-data" ? 0 : 8),
    timeInZone: NO_ZONES,
    weeklyPace: direction === "no-run-data" ? [] : [345, 342, 340, 338],
    detail: `endurance ${direction}`,
    windowDays: 56,
  };
}

describe("getProgressVerdict — pure verdict matrix", () => {
  it("up — strength up + endurance up", () => {
    const v = getProgressVerdict(strength("up"), endurance("up"));
    expect(v.verdict).toBe("up");
    expect(v.label).toMatch(/progress/i);
    expect(v.proofChips).toHaveLength(2);
    expect(v.proofChips[0].modality).toBe("strength");
    expect(v.proofChips[1].modality).toBe("endurance");
  });

  it("up — strength up + endurance flat", () => {
    const v = getProgressVerdict(strength("up"), endurance("flat"));
    expect(v.verdict).toBe("up");
  });

  it("up — strength flat + endurance up", () => {
    const v = getProgressVerdict(strength("flat"), endurance("up"));
    expect(v.verdict).toBe("up");
  });

  it("up — strength up + endurance no-run-data treated as building", () => {
    const v = getProgressVerdict(strength("up"), endurance("no-run-data", { totalRuns: 0 }));
    expect(v.verdict).toBe("up");
  });

  it("down — strength down + endurance flat (regression honesty: not 'mixed')", () => {
    const v = getProgressVerdict(strength("down"), endurance("flat"));
    expect(v.verdict).toBe("down");
  });

  it("down — strength flat + endurance down", () => {
    const v = getProgressVerdict(strength("flat"), endurance("down"));
    expect(v.verdict).toBe("down");
  });

  it("down — strength down + endurance no-run-data — regression must surface", () => {
    const v = getProgressVerdict(strength("down"), endurance("no-run-data"));
    expect(v.verdict).toBe("down");
  });

  it("mixed — strength up + endurance down", () => {
    const v = getProgressVerdict(strength("up"), endurance("down"));
    expect(v.verdict).toBe("mixed");
  });

  it("mixed — strength down + endurance up", () => {
    const v = getProgressVerdict(strength("down"), endurance("up"));
    expect(v.verdict).toBe("mixed");
  });

  it("holding — both flat", () => {
    const v = getProgressVerdict(strength("flat"), endurance("flat"));
    expect(v.verdict).toBe("holding");
  });

  it("holding — strength flat + endurance building", () => {
    const v = getProgressVerdict(strength("flat"), endurance("building"));
    expect(v.verdict).toBe("holding");
  });

  it("building — both cold-start", () => {
    const v = getProgressVerdict(strength("building"), endurance("building"));
    expect(v.verdict).toBe("building");
  });

  it("building — strength building + endurance no-run-data", () => {
    const v = getProgressVerdict(strength("building"), endurance("no-run-data"));
    expect(v.verdict).toBe("building");
  });

  it("proof chips reflect actual signed slopes (regression chip is NOT massaged)", () => {
    const v = getProgressVerdict(
      strength("down", { topSlope: -1.4, label: "Squat" }),
      endurance("up", { slope: -6 }),
    );
    const sChip = v.proofChips.find((c) => c.modality === "strength")!;
    const eChip = v.proofChips.find((c) => c.modality === "endurance")!;
    expect(sChip.direction).toBe("down");
    expect(sChip.text).toMatch(/Squat/);
    expect(sChip.text).toMatch(/-1\.4 kg\/wk/);
    expect(eChip.direction).toBe("up");
    expect(eChip.text).toBe("Easy runs getting faster");
  });

  it("strength chip for building state explains the gating", () => {
    const v = getProgressVerdict(strength("building"), endurance("flat"));
    const sChip = v.proofChips.find((c) => c.modality === "strength")!;
    expect(sChip.direction).toBe("building");
    expect(sChip.text).toMatch(/building/i);
  });

  it("endurance chip for no-run-data explains it without faking a number", () => {
    const v = getProgressVerdict(strength("flat"), endurance("no-run-data", { totalRuns: 3 }));
    const eChip = v.proofChips.find((c) => c.modality === "endurance")!;
    expect(eChip.direction).toBe("no-run-data");
    expect(eChip.text).toMatch(/3 runs/i);
  });

  it("detail copy nudges action when down", () => {
    const v = getProgressVerdict(strength("down"), endurance("flat"));
    expect(v.detail).toMatch(/regress|recovery|review/i);
  });
});
