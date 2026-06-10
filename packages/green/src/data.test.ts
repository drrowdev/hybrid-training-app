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

  it("carries real Green Protocol definitions — no leftover placeholders", () => {
    for (const s of CONDITIONING_SESSIONS) {
      expect(s.note.length).toBeGreaterThan(20);
      expect(s.note.toLowerCase()).not.toContain("pending");
    }
  });

  it("defines Peggy's Hills as a loaded, continuous (non-sprint) hill session", () => {
    const peggy = getConditioningSession("peggy")!;
    expect(peggy.loaded).toBe(true);
    expect(peggy.note).toMatch(/NOT a sprint/i);
  });

  it("flags continuous runs/rucks as Strava-trackable and circuits as not", () => {
    expect(getConditioningSession("lss")!.trackable).toBe(true);
    expect(getConditioningSession("ruck")!.trackable).toBe(true);
    // Strength-endurance circuits aren't a GPS activity → manual completion.
    expect(getConditioningSession("se")!.trackable).toBeUndefined();
  });
});

describe("phase grids", () => {
  it("ships the two Continuation baselines and the two Foundation builders", () => {
    expect(GREEN_PHASES.map((p) => p.id)).toEqual(["hybrid", "hybrid-op", "capacity", "velocity", "outcome", "ccat"]);
  });

  it("Foundation phases are benchmark-gated with exactly one test cell", () => {
    for (const phase of GREEN_PHASES.filter((p) => p.category === "foundation")) {
      expect(phase.benchmark).toBeDefined();
      const tests = phase.weeks.flatMap((w) => w.days).filter((c) => c.kind === "test");
      expect(tests).toHaveLength(1);
    }
  });

  it("Capacity is 12 weeks, Velocity 17, Outcome 17", () => {
    expect(GREEN_PHASES.find((p) => p.id === "capacity")!.weeks).toHaveLength(12);
    expect(GREEN_PHASES.find((p) => p.id === "velocity")!.weeks).toHaveLength(17);
    expect(GREEN_PHASES.find((p) => p.id === "outcome")!.weeks).toHaveLength(17);
  });

  for (const phase of GREEN_PHASES) {
    describe(phase.name, () => {
      it("every week has exactly 7 day cells", () => {
        for (const w of phase.weeks) expect(w.days).toHaveLength(7);
      });

      it("every conditioning cell references a known session", () => {
        for (const w of phase.weeks) {
          for (const c of w.days) {
            if (c.kind === "conditioning" || c.kind === "test") {
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
