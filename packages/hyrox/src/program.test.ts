/**
 * HYROX engine — skeleton tests (ADR 0050 step 3): meta + describeSetup + setup.
 * Pure, no DB. timeline/prescribe are stubbed until steps 4–5.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import {
  hyroxEngine,
  hyroxRef,
  parseHyroxRef,
  hyroxSessionIdForRef,
  WEEKS_BY_EXPERIENCE,
  DEFAULT_SESSIONS_BY_EXPERIENCE,
} from "./program";
import { buildHyroxGrid, gridSessionsResolve, type HyroxExperience } from "./index";
import { getHyroxSession } from "./sessions";

const ctx: PlatformContext = { oneRepMaxes: {}, roundingKg: 2.5 };

function setup(values: Record<string, unknown> = {}) {
  return hyroxEngine.setup({ values }, ctx);
}

describe("HYROX engine — meta", () => {
  it("identifies as the HYROX family", () => {
    expect(hyroxEngine.meta.id).toBe("hyrox");
    expect(hyroxEngine.meta.family).toBe("hyrox");
    expect(hyroxEngine.meta.name).toBe("HYROX");
  });
});

describe("HYROX engine — describeSetup", () => {
  it("collects experience, division, and sessions/week", () => {
    const keys = hyroxEngine.describeSetup().fields.map((f) => f.key);
    expect(keys).toEqual(["experience", "division", "sessionsPerWeek"]);
  });

  it("offers the three divisions", () => {
    const division = hyroxEngine
      .describeSetup()
      .fields.find((f) => f.key === "division");
    expect(division?.options?.map((o) => o.value)).toEqual(["open", "pro", "doubles"]);
  });
});

describe("HYROX engine — setup", () => {
  it("derives block length from experience (10 / 12 / 16)", () => {
    expect(setup({ experience: "beginner" }).weeks).toBe(WEEKS_BY_EXPERIENCE.beginner);
    expect(setup({ experience: "intermediate" }).weeks).toBe(WEEKS_BY_EXPERIENCE.intermediate);
    expect(setup({ experience: "advanced" }).weeks).toBe(WEEKS_BY_EXPERIENCE.advanced);
  });

  it("defaults sessions/week by experience when unspecified", () => {
    expect(setup({ experience: "beginner" }).sessionsPerWeek).toBe(
      DEFAULT_SESSIONS_BY_EXPERIENCE.beginner,
    );
    expect(setup({ experience: "advanced" }).sessionsPerWeek).toBe(
      DEFAULT_SESSIONS_BY_EXPERIENCE.advanced,
    );
  });

  it("honours an explicit sessions/week, clamped to [3, 8]", () => {
    expect(setup({ sessionsPerWeek: "6" }).sessionsPerWeek).toBe(6);
    expect(setup({ sessionsPerWeek: 99 }).sessionsPerWeek).toBe(8);
    expect(setup({ sessionsPerWeek: 1 }).sessionsPerWeek).toBe(3);
  });

  it("defaults unknown experience/division to intermediate / open", () => {
    const inst = setup({ experience: "nonsense", division: "nonsense" });
    expect(inst.experience).toBe("intermediate");
    expect(inst.division).toBe("open");
    expect(inst.weeks).toBe(12);
  });

  it("accepts all three divisions", () => {
    expect(setup({ division: "pro" }).division).toBe("pro");
    expect(setup({ division: "doubles" }).division).toBe("doubles");
    expect(setup({ division: "open" }).division).toBe("open");
  });

  it("produces a JSON-round-trippable instance", () => {
    const inst = setup({ experience: "advanced", division: "pro", sessionsPerWeek: "7" });
    expect(JSON.parse(JSON.stringify(inst))).toEqual(inst);
  });

  it("honours a race-date `weeks` override, clamped to [4, 24]", () => {
    // beginner default is 10; an override wins.
    expect(setup({ experience: "beginner", weeks: 8 }).weeks).toBe(8);
    expect(setup({ experience: "beginner", weeks: 2 }).weeks).toBe(4); // clamp low
    expect(setup({ experience: "beginner", weeks: 40 }).weeks).toBe(24); // clamp high
    // absent / invalid → experience default.
    expect(setup({ experience: "advanced" }).weeks).toBe(16);
    expect(setup({ experience: "advanced", weeks: "" }).weeks).toBe(16);
  });
});

describe("HYROX engine — prescribe is wired (step 5)", () => {
  it("returns items for a real ref and empty for an unknown ref", () => {
    const i = setup();
    const firstRef = hyroxEngine.timeline(i)[0]!.ref;
    expect(hyroxEngine.prescribe(i, firstRef, ctx).items.length).toBeGreaterThan(0);
    expect(hyroxEngine.prescribe(i, "nope", ctx)).toEqual({ items: [] });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Step 4 — phase grid + timeline
// ─────────────────────────────────────────────────────────────────────────────

const EXPERIENCES: HyroxExperience[] = ["beginner", "intermediate", "advanced"];

describe("HYROX grid — periodization", () => {
  it("produces exactly `weeks` weeks of 7 cells each, for every level", () => {
    for (const experience of EXPERIENCES) {
      const inst = setup({ experience });
      const grid = buildHyroxGrid({
        weeks: inst.weeks,
        sessionsPerWeek: inst.sessionsPerWeek,
        experience,
      });
      expect(grid).toHaveLength(WEEKS_BY_EXPERIENCE[experience]);
      expect(grid.every((w) => w.days.length === 7)).toBe(true);
    }
  });

  it("walks Base → Build → Specific → Taper in order with no gaps", () => {
    const grid = buildHyroxGrid({ weeks: 12, sessionsPerWeek: 5, experience: "intermediate" });
    const order = ["base", "build", "specific", "taper"];
    let cursor = 0;
    for (const week of grid) {
      const pos = order.indexOf(week.phase);
      expect(pos).toBeGreaterThanOrEqual(cursor);
      cursor = pos;
    }
    expect(grid[0]!.phase).toBe("base");
    expect(grid[grid.length - 1]!.phase).toBe("taper");
  });

  it("ends in a taper of the level-defined length", () => {
    const grid = buildHyroxGrid({ weeks: 16, sessionsPerWeek: 8, experience: "advanced" });
    const taperWeeks = grid.filter((w) => w.phase === "taper");
    expect(taperWeeks).toHaveLength(2);
    // the taper is the tail, not the middle
    expect(grid.slice(-2).every((w) => w.phase === "taper")).toBe(true);
  });

  it("inserts deloads on 4th work weeks, only in Base/Build (never Specific or Taper)", () => {
    const grid = buildHyroxGrid({ weeks: 16, sessionsPerWeek: 5, experience: "advanced" });
    expect(grid.find((w) => w.week === 4)!.isDeload).toBe(true);
    expect(grid.find((w) => w.week === 8)!.isDeload).toBe(true);
    for (const w of grid) {
      if (w.isDeload) expect(["base", "build"]).toContain(w.phase);
    }
    expect(grid.find((w) => w.week === 1)!.isDeload).toBe(false);
  });

  it("gives every level at least one real (non-sim) race-prep week", () => {
    for (const experience of EXPERIENCES) {
      const inst = setup({ experience });
      const grid = buildHyroxGrid({
        weeks: inst.weeks,
        sessionsPerWeek: inst.sessionsPerWeek,
        experience,
      });
      const realRacePrep = grid.filter(
        (w) =>
          w.phase === "specific" &&
          !w.isDeload &&
          !w.days.some((c) => c.kind === "sim"),
      );
      expect(realRacePrep.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("references only sessions that resolve in the vocabulary, at every level", () => {
    for (const experience of EXPERIENCES) {
      const inst = setup({ experience });
      const grid = buildHyroxGrid({
        weeks: inst.weeks,
        sessionsPerWeek: inst.sessionsPerWeek,
        experience,
      });
      expect(gridSessionsResolve(grid)).toBe(true);
    }
  });

  it("schedules `sessionsPerWeek` sessions in a normal week, fewer in deload/taper", () => {
    const grid = buildHyroxGrid({ weeks: 12, sessionsPerWeek: 5, experience: "intermediate" });
    const countSessions = (w: (typeof grid)[number]) =>
      w.days.filter((c) => c.kind !== "rest").length;

    const normal = grid.find((w) => !w.isDeload && w.phase !== "taper")!;
    expect(countSessions(normal)).toBe(5);

    const deload = grid.find((w) => w.isDeload)!;
    expect(countSessions(deload)).toBeLessThanOrEqual(3);

    const taper = grid.find((w) => w.phase === "taper")!;
    expect(countSessions(taper)).toBeLessThanOrEqual(4);
  });

  it("includes at least one strength session in every non-deload work week", () => {
    const grid = buildHyroxGrid({ weeks: 12, sessionsPerWeek: 4, experience: "intermediate" });
    for (const week of grid) {
      if (week.isDeload || week.phase === "taper") continue;
      const hasStrength = week.days.some(
        (c) => c.kind === "session" && getHyroxSession(c.session)?.category === "strength",
      );
      expect(hasStrength).toBe(true);
    }
  });

  it("places at least one race simulation in the Specific phase", () => {
    const grid = buildHyroxGrid({ weeks: 12, sessionsPerWeek: 5, experience: "intermediate" });
    const sims = grid.flatMap((w) => w.days).filter((c) => c.kind === "sim");
    expect(sims.length).toBeGreaterThanOrEqual(1);
  });

  it("adds a two-a-day for an 8-sessions/week block", () => {
    const grid = buildHyroxGrid({ weeks: 16, sessionsPerWeek: 8, experience: "advanced" });
    const hasPlus = grid
      .filter((w) => !w.isDeload && w.phase !== "taper")
      .some((w) => w.days.some((c) => c.kind === "session" && c.plus));
    expect(hasPlus).toBe(true);
  });
});

describe("HYROX timeline — specs", () => {
  it("emits one spec per non-rest cell, with 0-based contiguous indices", () => {
    const inst = setup({ experience: "intermediate" });
    const grid = buildHyroxGrid({
      weeks: inst.weeks,
      sessionsPerWeek: inst.sessionsPerWeek,
      experience: "intermediate",
    });
    const nonRest = grid.flatMap((w) => w.days).filter((c) => c.kind !== "rest").length;
    const tl = hyroxEngine.timeline(inst);
    expect(tl).toHaveLength(nonRest);
    expect(tl.map((s) => s.index)).toEqual(tl.map((_, i) => i));
  });

  it("assigns a weekday and a round-trippable ref to every spec", () => {
    const tl = hyroxEngine.timeline(setup());
    for (const spec of tl) {
      expect(spec.weekday).toBeGreaterThanOrEqual(0);
      expect(spec.weekday).toBeLessThanOrEqual(6);
      const parsed = parseHyroxRef(spec.ref);
      expect(parsed).not.toBeNull();
      expect(hyroxRef(parsed!.week, parsed!.weekday)).toBe(spec.ref);
    }
  });

  it("maps sims to `test` kind and deload markers to `deload` kind", () => {
    const tl = hyroxEngine.timeline(setup({ experience: "advanced" }));
    expect(tl.some((s) => s.kind === "test" && s.tags?.includes("simulation"))).toBe(true);
    expect(tl.some((s) => s.kind === "deload")).toBe(true);
    expect(tl.some((s) => s.kind === "training")).toBe(true);
  });

  it("tags strength sessions for per-movement logging", () => {
    const tl = hyroxEngine.timeline(setup());
    const strength = tl.filter((s) => s.tags?.includes("modality:strength"));
    expect(strength.length).toBeGreaterThan(0);
    expect(strength.every((s) => s.tags?.includes("per-movement-log"))).toBe(true);
  });

  it("has unique refs across the whole timeline", () => {
    const tl = hyroxEngine.timeline(setup({ experience: "advanced" }));
    const refs = tl.map((s) => s.ref);
    expect(new Set(refs).size).toBe(refs.length);
  });
});

describe("hyroxSessionIdForRef", () => {
  it("resolves a ref to its session id for session + sim cells", () => {
    const i = setup({ experience: "intermediate" });
    const tl = hyroxEngine.timeline(i);
    const sim = tl.find((s) => s.tags?.includes("simulation"))!;
    expect(hyroxSessionIdForRef(i, sim.ref)).toBe("sim-half");
    const training = tl.find((s) => s.kind === "training")!;
    expect(typeof hyroxSessionIdForRef(i, training.ref)).toBe("string");
  });

  it("returns null for a deload ref and an unknown ref", () => {
    const i = setup({ experience: "intermediate" });
    const deload = hyroxEngine.timeline(i).find((s) => s.kind === "deload");
    if (deload) expect(hyroxSessionIdForRef(i, deload.ref)).toBeNull();
    expect(hyroxSessionIdForRef(i, "hx-w99-d9")).toBeNull();
    expect(hyroxSessionIdForRef(i, "garbage")).toBeNull();
  });
});
