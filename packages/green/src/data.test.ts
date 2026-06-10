/**
 * Green Protocol data integrity — guards the conditioning vocabulary and the
 * phase-grid transcription.
 */
import { describe, it, expect } from "vitest";
import { CONDITIONING_SESSIONS, getConditioningSession } from "./conditioning";
import { GREEN_PHASES } from "./phases";

describe("conditioning vocabulary", () => {
  it("has unique ids", () => {
    const ids = CONDITIONING_SESSIONS.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every session declares a unit and an intensity zone", () => {
    for (const s of CONDITIONING_SESSIONS) {
      expect(["minutes", "miles", "rounds"]).toContain(s.unit);
      expect(["recovery", "aerobic", "threshold", "anaerobic", "mixed"]).toContain(s.zone);
    }
  });
});

describe("phase grids", () => {
  it("ships the two Continuation baselines", () => {
    expect(GREEN_PHASES.map((p) => p.id)).toEqual(["hybrid", "hybrid-op"]);
  });

  for (const phase of GREEN_PHASES) {
    describe(phase.name, () => {
      it("every week has exactly 7 day cells", () => {
        for (const w of phase.weeks) expect(w.days).toHaveLength(7);
      });

      it("every conditioning cell references a known session", () => {
        for (const w of phase.weeks) {
          for (const c of w.days) {
            if (c.kind === "conditioning") {
              expect(getConditioningSession(c.session), `unknown session ${c.session}`).toBeDefined();
            }
          }
        }
      });

      it("every strength cell delegates to a known TB token", () => {
        for (const w of phase.weeks) {
          for (const c of w.days) {
            if (c.kind === "strength") expect(["OP", "FT", "ZULU_HT"]).toContain(c.strength);
          }
        }
      });
    });
  }

  it("Hybrid is 14 weeks with deloads at weeks 7 and 14", () => {
    const hybrid = GREEN_PHASES.find((p) => p.id === "hybrid")!;
    expect(hybrid.weeks).toHaveLength(14);
    expect(hybrid.weeks[6]!.days[0]!.kind).toBe("deload");
    expect(hybrid.weeks[13]!.days[0]!.kind).toBe("deload");
  });

  it("Hybrid front-half lifts Operator, back-half lifts Fighter", () => {
    const hybrid = GREEN_PHASES.find((p) => p.id === "hybrid")!;
    const strengthOf = (wi: number) =>
      hybrid.weeks[wi]!.days.filter((c) => c.kind === "strength").map((c) => (c as { strength: string }).strength);
    expect(strengthOf(0)).toEqual(["OP", "OP", "OP"]);
    expect(strengthOf(7)).toEqual(["FT", "FT"]);
  });
});
