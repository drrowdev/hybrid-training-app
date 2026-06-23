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
  it("collects experience and division (sessions/week comes from the Schedule step)", () => {
    const keys = hyroxEngine.describeSetup().fields.map((f) => f.key);
    expect(keys).toEqual(["experience", "division"]);
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

  it("adds two-a-day companions only when the flag is on (ADR 0054)", () => {
    const off = buildHyroxGrid({ weeks: 16, sessionsPerWeek: 6, experience: "advanced" });
    expect(off.flatMap((w) => w.days).some((c) => c.kind === "session" && c.plus)).toBe(false);

    const on = buildHyroxGrid({ weeks: 16, sessionsPerWeek: 6, experience: "advanced", twoADay: true });
    const hasPlus = on
      .filter((w) => !w.isDeload && w.phase !== "taper")
      .some((w) => w.days.some((c) => c.kind === "session" && c.plus));
    expect(hasPlus).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR 0053 — week-quota invariants. These lock the redesign across EVERY level
// and EVERY budget so the "pool-by-index starves small weeks" regression can
// never come back: a generated HYROX week is always a real HYROX week.
// ─────────────────────────────────────────────────────────────────────────────
describe("HYROX week quotas (ADR 0053)", () => {
  const BUDGETS = [3, 4, 5, 6, 7, 8] as const;
  const STATION_IDS = new Set(["station-intervals", "se-circuit"]);
  const CROSS_IDS = new Set(["easy-bike", "easy-row", "easy-ski"]);

  /** Every (level × budget) combination, work weeks only (no deload/taper). */
  function workWeeks(experience: HyroxExperience, sessionsPerWeek: number) {
    const grid = buildHyroxGrid({
      weeks: WEEKS_BY_EXPERIENCE[experience],
      sessionsPerWeek,
      experience,
    });
    return grid.filter((w) => !w.isDeload && w.phase !== "taper");
  }

  function primarySessions(week: { days: { kind: string; session?: string }[] }) {
    return week.days
      .filter((c) => c.kind === "session")
      .map((c) => (c as { session: string }).session);
  }

  function hasSim(week: { days: { kind: string }[] }) {
    return week.days.some((c) => c.kind === "sim");
  }

  it("every work week has a strength session — all levels, all budgets", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of BUDGETS) {
        for (const week of workWeeks(experience, spw)) {
          if (hasSim(week)) continue; // a race simulation IS the week's stimulus
          const hasStrength = primarySessions(week).some(
            (id) => getHyroxSession(id)?.category === "strength",
          );
          expect(hasStrength, `${experience} @ ${spw}/wk, ${week.phase} wk${week.week}`).toBe(true);
        }
      }
    }
  });

  it("every work week has a functional-station session — all levels, all budgets", () => {
    // The headline regression: a low-budget week used to be strength + easy
    // aerobic with NO station. A race simulation also rehearses the stations.
    for (const experience of EXPERIENCES) {
      for (const spw of BUDGETS) {
        for (const week of workWeeks(experience, spw)) {
          const hasStation =
            hasSim(week) || primarySessions(week).some((id) => STATION_IDS.has(id));
          expect(hasStation, `${experience} @ ${spw}/wk, ${week.phase} wk${week.week}`).toBe(true);
        }
      }
    }
  });

  it("every work week has a running session (never all off-feet) — all levels, all budgets", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of BUDGETS) {
        for (const week of workWeeks(experience, spw)) {
          const hasRun =
            hasSim(week) ||
            // Any run-based session: easy/long/threshold runs, VO2 (run intervals),
            // and compromised running all materialise the "run" movement.
            primarySessions(week).some((id) => getHyroxSession(id)?.movements.includes("run"));
          expect(hasRun, `${experience} @ ${spw}/wk, ${week.phase} wk${week.week}`).toBe(true);
        }
      }
    }
  });

  it("off-feet ergs (ski/row) are leftover-only — never a primary below 6 sessions/week", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of [3, 4, 5] as const) {
        const grid = buildHyroxGrid({
          weeks: WEEKS_BY_EXPERIENCE[experience],
          sessionsPerWeek: spw,
          experience,
        });
        const crossPrimaries = grid
          .filter((w) => !w.isDeload) // deload recovery weeks legitimately use easy ergs
          .flatMap((w) => w.days)
          .filter((c) => c.kind === "session" && CROSS_IDS.has((c as { session: string }).session));
        expect(crossPrimaries, `${experience} @ ${spw}/wk`).toHaveLength(0);
      }
    }
  });

  it("compromised running appears from the Build phase (budget ≥ 4) — all levels", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of [4, 5, 6, 7, 8] as const) {
        const buildWeeks = workWeeks(experience, spw).filter((w) => w.phase === "build");
        for (const week of buildWeeks) {
          const hasCompromised = primarySessions(week).includes("compromised-run");
          expect(hasCompromised, `${experience} @ ${spw}/wk, build wk${week.week}`).toBe(true);
        }
      }
    }
  });

  it("every race-prep week trains compromised running — all levels, all budgets", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of BUDGETS) {
        const specificWeeks = workWeeks(experience, spw).filter((w) => w.phase === "specific");
        for (const week of specificWeeks) {
          const hasCompromised = primarySessions(week).includes("compromised-run");
          expect(hasCompromised, `${experience} @ ${spw}/wk, specific wk${week.week}`).toBe(true);
        }
      }
    }
  });

  it("a second strength day appears at high budgets (two full-body days)", () => {
    // The user's complaint that a 6-day plan had a single monolithic strength day.
    const week = workWeeks("advanced", 8).find((w) => w.phase === "build")!;
    const strengthIds = primarySessions(week).filter(
      (id) => getHyroxSession(id)?.category === "strength",
    );
    expect(strengthIds.length).toBeGreaterThanOrEqual(2); // two strength days
  });

  it("the reported regression is gone: a low-budget base week has no lone easy erg, has a station", () => {
    const week = workWeeks("beginner", 4).find((w) => w.phase === "base")!;
    const ids = primarySessions(week);
    expect(ids).not.toContain("easy-ski");
    expect(ids).not.toContain("easy-bike");
    expect(ids).not.toContain("easy-row");
    expect(ids.some((id) => STATION_IDS.has(id))).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR 0054 — two-a-day (AM/PM) invariants. Locked across levels so the
// evidence-grounded dosing can't silently regress.
// ─────────────────────────────────────────────────────────────────────────────
describe("HYROX two-a-days (ADR 0054)", () => {
  const CAP: Record<HyroxExperience, number> = { beginner: 0, intermediate: 2, advanced: 3 };
  const ERGS = new Set(["easy-ski", "easy-row", "easy-bike"]);
  const HARD = new Set([
    "strength-full",
    "strength-a",
    "strength-b",
    "strength-lower",
    "strength-upper",
    "station-intervals",
    "se-circuit",
    "threshold-run",
    "vo2-intervals",
    "compromised-run",
  ]);

  function grid(experience: HyroxExperience, spw: number, twoADay: boolean) {
    return buildHyroxGrid({ weeks: WEEKS_BY_EXPERIENCE[experience], sessionsPerWeek: spw, experience, twoADay });
  }
  function doublesIn(week: { days: { kind: string; session?: string; plus?: { session: string } }[] }) {
    return week.days.filter((c) => c.kind === "session" && c.plus);
  }

  it("off by default — no companions anywhere, every level/budget (byte-identical)", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of [3, 5, 7] as const) {
        const anyPlus = grid(experience, spw, false).flatMap((w) => w.days).some((c) => c.kind === "session" && c.plus);
        expect(anyPlus, `${experience}@${spw}`).toBe(false);
      }
    }
  });

  it("beginners never get a two-a-day even with the flag on", () => {
    for (const spw of [3, 4, 5] as const) {
      const anyPlus = grid("beginner", spw, true).flatMap((w) => w.days).some((c) => c.kind === "session" && c.plus);
      expect(anyPlus).toBe(false);
    }
  });

  it("respects the per-week experience cap and never doubles deload/taper", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of [4, 5, 6, 7] as const) {
        for (const week of grid(experience, spw, true)) {
          const n = doublesIn(week).length;
          expect(n).toBeLessThanOrEqual(CAP[experience]);
          if (week.isDeload || week.phase === "taper") expect(n).toBe(0);
        }
      }
    }
  });

  it("every companion is an easy off-feet erg, paired with a HARD primary, on non-adjacent days", () => {
    for (const experience of ["intermediate", "advanced"] as const) {
      for (const spw of [5, 6, 7] as const) {
        for (const week of grid(experience, spw, true)) {
          const dbl: number[] = [];
          week.days.forEach((c, d) => {
            if (c.kind === "session" && c.plus) {
              expect(ERGS.has(c.plus.session)).toBe(true); // easy off-feet erg
              expect(HARD.has(c.session)).toBe(true); // hard primary
              dbl.push(d);
            }
          });
          for (let k = 1; k < dbl.length; k++) {
            expect(dbl[k]! - dbl[k - 1]!).toBeGreaterThan(1); // non-adjacent
          }
        }
      }
    }
  });

  it("advanced build/race-prep weeks actually use the doubles when enabled", () => {
    const g = grid("advanced", 6, true);
    const used = g.some((w) => !w.isDeload && (w.phase === "build" || w.phase === "specific") && doublesIn(w).length > 0);
    expect(used).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// QA GUARD — full-matrix plan-quality floor. Institutionalises the manual QA
// review: across EVERY level × budget 3–7 × two-a-day on/off, no generated week
// may regress into a "weak" week (the original field-report bug: a sparse week
// whose sessions were strength + easy aerobic + a lone ski-erg, no station/quality).
// ─────────────────────────────────────────────────────────────────────────────
describe("HYROX plan quality (QA guard)", () => {
  const ERG_PRIMARY = new Set(["easy-ski", "easy-row", "easy-bike"]);
  const STATIONS = new Set(["station-intervals", "se-circuit"]);

  function* matrix() {
    for (const experience of EXPERIENCES) {
      for (const spw of [3, 4, 5, 6, 7] as const) {
        for (const twoADay of [false, true]) {
          yield {
            experience,
            spw,
            twoADay,
            grid: buildHyroxGrid({ weeks: WEEKS_BY_EXPERIENCE[experience], sessionsPerWeek: spw, experience, twoADay }),
          };
        }
      }
    }
  }

  it("no work week is all-easy — every base/build/race-prep week has a hard session", () => {
    for (const { experience, spw, grid } of matrix()) {
      for (const w of grid) {
        if (w.isDeload || w.phase === "taper") continue;
        const hasHard = w.days.some(
          (c) =>
            (c.kind === "session" && getHyroxSession(c.session)?.zone !== "aerobic" && getHyroxSession(c.session)?.zone !== "recovery") ||
            c.kind === "sim",
        );
        expect(hasHard, `${experience}@${spw} wk${w.week}`).toBe(true);
      }
    }
  });

  it("THE field-report guard: no lone off-feet erg as a PRIMARY below 6 sessions/week", () => {
    for (const { experience, spw, grid } of matrix()) {
      if (spw >= 6) continue; // an easy erg is a legitimate supplementary day at 6–7
      for (const w of grid) {
        if (w.isDeload) continue; // deload recovery legitimately uses easy ergs
        for (const c of w.days) {
          if (c.kind === "session") {
            expect(ERG_PRIMARY.has(c.session), `${experience}@${spw} wk${w.week} primary=${c.session}`).toBe(false);
          }
        }
      }
    }
  });

  it("every work week trains the functional stations (or a race sim)", () => {
    for (const { experience, spw, grid } of matrix()) {
      for (const w of grid) {
        if (w.isDeload || w.phase === "taper") continue;
        const hasStation = w.days.some(
          (c) => (c.kind === "session" && STATIONS.has(c.session)) || c.kind === "sim",
        );
        expect(hasStation, `${experience}@${spw} wk${w.week}`).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR 0055 — best-in-class refinements: a real taper, bike-default easy modality,
// within-build quality undulation.
// ─────────────────────────────────────────────────────────────────────────────
describe("HYROX best-in-class refinements (ADR 0055)", () => {
  function grid(experience: HyroxExperience, spw = 5) {
    return buildHyroxGrid({ weeks: WEEKS_BY_EXPERIENCE[experience], sessionsPerWeek: spw, experience });
  }
  const ids = (w: { days: { kind: string; session?: string; plus?: { session: string } }[] }) =>
    w.days.filter((c) => c.kind === "session").map((c) => (c as { session: string }).session);

  it("RACE week (final taper) carries NO heavy strength and is capped at 3", () => {
    for (const experience of EXPERIENCES) {
      const g = grid(experience, 6);
      const taperWeeks = g.filter((w) => w.phase === "taper");
      const raceWeek = taperWeeks[taperWeeks.length - 1]!;
      expect(ids(raceWeek)).not.toContain("strength-full");
      expect(ids(raceWeek)).not.toContain("strength-lower");
      expect(raceWeek.days.filter((c) => c.kind !== "rest").length).toBeLessThanOrEqual(3);
      // It still primes the race: a compromised-run primer + a station touch.
      expect(ids(raceWeek)).toContain("compromised-run");
    }
  });

  it("a 2-week taper keeps ONE last strength in the SHARPEN week, not the race week", () => {
    // intermediate/advanced have 2 taper weeks.
    for (const experience of ["intermediate", "advanced"] as const) {
      const g = grid(experience, 5);
      const taperWeeks = g.filter((w) => w.phase === "taper");
      expect(taperWeeks.length).toBe(2);
      const [sharpen, race] = taperWeeks;
      expect(ids(sharpen!)).toContain("strength-full");
      expect(ids(race!)).not.toContain("strength-full");
    }
  });

  it("easy aerobic defaults to the BIKE — ski never appears as a primary or companion", () => {
    for (const experience of EXPERIENCES) {
      for (const spw of [3, 4, 5, 6, 7] as const) {
        for (const twoADay of [false, true]) {
          const g = buildHyroxGrid({ weeks: WEEKS_BY_EXPERIENCE[experience], sessionsPerWeek: spw, experience, twoADay });
          for (const w of g) {
            for (const c of w.days) {
              if (c.kind === "session") {
                expect(c.session, `${experience}@${spw}`).not.toBe("easy-ski");
                if (c.plus) expect(c.plus.session).not.toBe("easy-ski");
              }
            }
          }
        }
      }
      // And the easy cross-fill (the `cross` slot) IS the bike — appears at 7 days
      // in base (slot 7) now that the 2nd strength day takes slot 5 (ADR 0056).
      const base7 = grid(experience, 7).find((w) => w.phase === "base")!;
      expect(ids(base7)).toContain("easy-bike");
    }
  });

  it("the Build phase UNDULATES the quality run week-to-week (threshold ↔ VO2)", () => {
    const g = grid("advanced", 4); // advanced has multiple build weeks
    const buildWeeks = g.filter((w) => w.phase === "build" && !w.isDeload);
    const threshold = buildWeeks.filter((w) => ids(w).includes("threshold-run")).length;
    const vo2 = buildWeeks.filter((w) => ids(w).includes("vo2-intervals")).length;
    expect(threshold).toBeGreaterThan(0);
    expect(vo2).toBeGreaterThan(0); // both stimuli appear across the build block
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ADR 0056 — strength dosing: full-body at low budgets / 1-strength weeks; a
// second SPLIT strength day at 5+ days in Base and 6+ days in Build (endurance-
// protected); race-prep stays at one maintenance strength day.
// ─────────────────────────────────────────────────────────────────────────────
describe("HYROX strength dosing (ADR 0056)", () => {
  function week(experience: HyroxExperience, spw: number, phase: HyroxPhaseId) {
    return buildHyroxGrid({ weeks: WEEKS_BY_EXPERIENCE[experience], sessionsPerWeek: spw, experience })
      .filter((w) => !w.isDeload && w.phase === phase)[0]!;
  }
  const strengthIds = (w: { days: { kind: string; session?: string }[] }) =>
    w.days.filter((c) => c.kind === "session" && getHyroxSession((c as { session: string }).session)?.category === "strength")
      .map((c) => (c as { session: string }).session);

  it("a 5-day BASE week is a TWO-DAY strength split (Squat+Press / Deadlift+Pull) — ADR 0058", () => {
    const s = strengthIds(week("intermediate", 5, "base"));
    expect(s.length).toBe(2);
    expect(new Set(s)).toEqual(new Set(["strength-a", "strength-b"]));
  });

  it("a 5-day BUILD block ALTERNATES one strength (+long) and a two-day split (no long) — ADR 0059", () => {
    // ADR 0059: at a 5-session budget Build can't fit a 2nd strength day without
    // dropping an endurance essential, so it alternates — swapping the bankable
    // long run for the split on every other Build week. Advanced @ 5/wk has several
    // non-deload Build weeks to observe the cadence.
    const buildWeeks = buildHyroxGrid({
      weeks: WEEKS_BY_EXPERIENCE.advanced,
      sessionsPerWeek: 5,
      experience: "advanced",
    }).filter((w) => !w.isDeload && w.phase === "build");
    expect(buildWeeks.length).toBeGreaterThanOrEqual(2);

    for (const w of buildWeeks) {
      const s = strengthIds(w);
      const ids = w.days
        .filter((c) => c.kind === "session")
        .map((c) => (c as { session: string }).session);
      // The high-specificity endurance stays weekly in EVERY Build week.
      expect(ids).toContain("compromised-run");
      const hasQuality = ids.includes("threshold-run") || ids.includes("vo2-intervals");
      expect(hasQuality, `quality run present, wk${w.week}`).toBe(true);
      if (s.length === 2) {
        // "double" week — the split appears and the long run is swapped out.
        expect(new Set(s)).toEqual(new Set(["strength-a", "strength-b"]));
        expect(ids).not.toContain("long-run");
      } else {
        // "single" week — full-body strength, long run preserved (ADR 0056).
        expect(s).toEqual(["strength-full"]);
        expect(ids).toContain("long-run");
      }
    }

    // It genuinely alternates (at least one of each) and front-loads the double
    // on the first non-deload Build week (fresh after the deload).
    const counts = buildWeeks.map((w) => strengthIds(w).length);
    expect(counts).toContain(2);
    expect(counts).toContain(1);
    expect(strengthIds(buildWeeks[0]!).length).toBe(2);
  });

  it("a 6-day BUILD week gets a second strength day (the split's Day B)", () => {
    const s = strengthIds(week("advanced", 6, "build"));
    expect(s.length).toBe(2);
    expect(new Set(s)).toEqual(new Set(["strength-a", "strength-b"]));
  });

  it("a low-budget (4-day) week is a single FULL-BODY strength day", () => {
    for (const phase of ["base", "build"] as const) {
      const s = strengthIds(week("intermediate", 4, phase));
      expect(s).toEqual(["strength-full"]);
    }
  });

  it("RACE-PREP keeps ONE maintenance strength day at every budget", () => {
    for (const spw of [5, 6, 7] as const) {
      const s = strengthIds(week("advanced", spw, "specific"));
      expect(s.length).toBe(1);
    }
  });

  it("spaces two strength days evenly — not on the first+last training day", () => {
    // 5-day Base = 2 strength days. They must NOT bookend the week (pos 0 & last);
    // even spacing puts them on the 2nd & 4th training days (Tue/Fri).
    const w = week("intermediate", 5, "base");
    const trainingCells = w.days
      .map((c, d) => ({ c, d }))
      .filter(({ c }) => c.kind === "session" || c.kind === "sim");
    const strengthSlots = trainingCells
      .map(({ c }, idx) => ({ idx, c }))
      .filter(({ c }) =>
        c.kind === "session" &&
        getHyroxSession((c as { session: string }).session)?.category === "strength",
      )
      .map(({ idx }) => idx);
    expect(strengthSlots).toEqual([1, 3]); // 2nd and 4th of 5 training days
  });

  it("places a single strength day mid-week (not on the first training day)", () => {
    const w = week("intermediate", 4, "base"); // 4 days, 1 strength
    const trainingCells = w.days.filter((c) => c.kind === "session" || c.kind === "sim");
    const strengthIdx = trainingCells.findIndex(
      (c) =>
        c.kind === "session" &&
        getHyroxSession((c as { session: string }).session)?.category === "strength",
    );
    expect(strengthIdx).toBeGreaterThan(0); // not the first training day
    expect(strengthIdx).toBeLessThan(trainingCells.length - 1); // not the last
  });
});

// ADR 0060 — a block with NO race date is concurrent maintenance, not a peak: a short
// capped Base intro then a held Build steady state, with NO Specific (race-prep) phase,
// NO taper, and NO 0-strength race week.
describe("HYROX no-race maintenance mode (ADR 0060)", () => {
  const raceless = (experience: HyroxExperience, spw: number) =>
    buildHyroxGrid({
      weeks: WEEKS_BY_EXPERIENCE[experience],
      sessionsPerWeek: spw,
      experience,
      hasRace: false,
    });
  const strengthCells = (w: { days: { kind: string; session?: string }[] }) =>
    w.days.filter(
      (c) =>
        c.kind === "session" &&
        getHyroxSession((c as { session: string }).session)?.category === "strength",
    );

  it("never emits a Specific or Taper phase — only Base/Build, all levels & budgets", () => {
    for (const exp of ["beginner", "intermediate", "advanced"] as const) {
      for (const spw of [4, 5, 6] as const) {
        for (const w of raceless(exp, spw)) {
          expect(["base", "build"], `${exp} @ ${spw}/wk wk${w.week}`).toContain(w.phase);
        }
      }
    }
  });

  it("never emits a race simulation, and every non-deload week keeps a strength day", () => {
    for (const w of raceless("intermediate", 5)) {
      expect(w.days.some((c) => c.kind === "sim")).toBe(false);
      if (!w.isDeload) expect(strengthCells(w).length).toBeGreaterThanOrEqual(1);
    }
  });

  it("uses a SHORT capped Base intro (≤ NO_RACE_BASE_WEEKS) then Build for the rest", () => {
    const grid = raceless("intermediate", 5); // 12 weeks
    const baseWeeks = grid.filter((w) => w.phase === "base").length;
    expect(baseWeeks).toBeGreaterThanOrEqual(1);
    expect(baseWeeks).toBeLessThanOrEqual(4); // the fixed cap, not 40% of the block
    expect(grid.filter((w) => w.phase === "build").length).toBe(grid.length - baseWeeks);
  });

  it("keeps the every-4th-week deload cadence across the long maintenance build", () => {
    const deloads = raceless("advanced", 5) // 16 weeks
      .filter((w) => w.isDeload)
      .map((w) => w.week);
    expect(deloads).toContain(4);
    expect(deloads).toContain(8);
    expect(deloads).toContain(12);
  });

  it("holds the Build steady state — strength still alternates (ADR 0059), no race-week drop", () => {
    const grid = raceless("advanced", 5);
    const buildWeeks = grid.filter((w) => w.phase === "build" && !w.isDeload);
    const counts = buildWeeks.map((w) => strengthCells(w).length);
    expect(counts).toContain(2); // double weeks
    expect(counts).toContain(1); // single weeks
  });

  it("race mode (the default) is unchanged — it still peaks with Specific + Taper", () => {
    const phases = new Set(
      buildHyroxGrid({ weeks: 12, sessionsPerWeek: 5, experience: "intermediate" }).map(
        (w) => w.phase,
      ),
    );
    expect(phases.has("specific")).toBe(true);
    expect(phases.has("taper")).toBe(true);
  });

  it("setup() carries hasRace through the instance (default true, explicit false honoured)", () => {
    expect(setup({ experience: "intermediate" }).hasRace).toBe(true);
    expect(setup({ experience: "intermediate", hasRace: false }).hasRace).toBe(false);
    expect(setup({ experience: "intermediate", hasRace: "true" }).hasRace).toBe(true);
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

  it("does NOT fix a weekday on specs, but every ref round-trips", () => {
    // HYROX now uses the Schedule-step weekdays (like 5/3/1 / Hybrid), so specs
    // carry no explicit weekday — materialize seats them on the chosen days. The
    // ref still encodes an internal weekday coordinate for content lookup.
    const tl = hyroxEngine.timeline(setup());
    for (const spec of tl) {
      expect(spec.weekday).toBeUndefined();
      const parsed = parseHyroxRef(spec.ref);
      expect(parsed).not.toBeNull();
      expect(parsed!.weekday).toBeGreaterThanOrEqual(0);
      expect(parsed!.weekday).toBeLessThanOrEqual(6);
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

describe("HYROX engine — segments (start points)", () => {
  it("emits a boundary at each periodization phase, in order, starting at week 0", () => {
    const segs = hyroxEngine.segments!(setup({ experience: "intermediate" }));
    expect(segs[0]!.startWeekIndex).toBe(0);
    expect(segs.map((s) => s.label)).toEqual(["Base", "Build", "Race-prep", "Taper"]);
    expect(segs[segs.length - 1]!.kind).toBe("test");
    const idx = segs.map((s) => s.startWeekIndex);
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
    expect(new Set(idx).size).toBe(idx.length);
  });
});
