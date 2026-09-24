import { describe, expect, it } from "vitest";
import { isPlannedRest, nextProgramCommitment, type TrainingCommitment } from "./training-schedule";

describe("DC-K3: planned rest identity", () => {
  it("recognizes both stored rest representations without inferring from names", () => {
    expect(isPlannedRest({ role: "rest" })).toBe(true);
    expect(isPlannedRest({ prescription: { kind: "rest" } })).toBe(true);
    expect(isPlannedRest({ role: "primary", prescription: { kind: "strength", title: "Rest day lifting" } })).toBe(false);
    expect(isPlannedRest({ role: null, prescription: null })).toBe(false);
    expect(isPlannedRest({})).toBe(false);
  });

  describe("nextProgramCommitment", () => {
    it("selects the next scheduled date for only the requested program without mutating inputs", () => {
      const row: TrainingCommitment = { id: "next", source: "primary", programId: "p", date: "2026-09-25", title: "Workout", state: "scheduled" };
      const rows: TrainingCommitment[] = [
        { ...row, id: "later", date: "2026-09-26" }, row,
        { ...row, id: "past", date: "2026-09-23" },
        { ...row, id: "other", programId: "q", date: "2026-09-24" },
        { ...row, id: "swim", source: "swim", date: "2026-09-24" },
        ...(["started", "completed", "paused", "rest"] as const).map((state) => ({ ...row, id: state, state, date: "2026-09-24" })),
      ];
      const before = structuredClone(rows);
      expect(nextProgramCommitment(rows, "p", "2026-09-24")).toEqual(row);
      expect(rows).toEqual(before);
      expect(nextProgramCommitment(rows, "p", "2026-09-24", "swim")?.id).toBe("swim");
      expect(nextProgramCommitment(rows, "missing", "2026-09-24")).toBeUndefined();
      expect(nextProgramCommitment(rows, "p", "2026-09-27")).toBeUndefined();
      expect(nextProgramCommitment([{ ...row, date: "2026-09-24" }], "p", "2026-09-24")?.id).toBe("next");
    });
  });
});
