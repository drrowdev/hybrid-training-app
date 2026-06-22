/**
 * HYROX materialisation — end-to-end against the real @hta/hyrox engine
 * (ADR 0050 step 6). Proves a concrete HYROX instance flows through the
 * program-agnostic materialize/adapter path:
 *   - one planned row per non-rest timeline spec, seated on the user's CHOSEN
 *     training weekdays (HYROX no longer fixes its own calendar — like 5/3/1 /
 *     Hybrid it uses the Schedule-step weekdays);
 *   - strength sessions resolve their role-anchored mains and (with the ADR-0047
 *     planner) their station accessories;
 *   - run / erg / station / circuit / compromised / sim sessions map to the app's
 *     display-only cardio_external kind (no catalog resolution needed);
 *   - sims → role "test", deload markers → role "deload";
 *   - the (week, day, slot) grid is collision-free.
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { hyroxEngine, buildHyroxGrid, type HyroxInstance } from "@hta/hyrox";
import { materializeProgram } from "../materialize";
import { buildAssistancePlanner } from "../assistance-resolver";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import type { MovementResolver } from "../adapter";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 150, deadlift: 200, press: 75, bench: 100 },
  roundingKg: 2.5,
};

// Role keys resolve to a stub anchored movement; anything else is unresolved.
const resolve: MovementResolver = (key) =>
  ["squat", "bench", "deadlift", "press"].includes(key)
    ? { movementId: `mv-${key}`, slug: `${key}-variant`, displayName: key }
    : undefined;

// A 5-session instance seats onto the first five chosen weekdays; pass the full
// week so the schedule never under-seats.
const weekdays = [0, 1, 2, 3, 4, 5, 6];

function inst(over: Partial<Record<"experience" | "division" | "sessionsPerWeek" | "twoADay", unknown>> = {}): HyroxInstance {
  return hyroxEngine.setup(
    {
      values: {
        experience: over.experience ?? "intermediate",
        division: over.division ?? "open",
        sessionsPerWeek: over.sessionsPerWeek ?? 5,
        ...(over.twoADay ? { twoADay: true } : {}),
      },
    },
    ctx,
  );
}

function nonRestCount(i: HyroxInstance): number {
  const grid = buildHyroxGrid({ weeks: i.weeks, sessionsPerWeek: i.sessionsPerWeek, experience: i.experience });
  return grid.flatMap((w) => w.days).filter((c) => c.kind !== "rest").length;
}

describe("materializeProgram — HYROX (no assistance planner)", () => {
  const i = inst();
  const result = materializeProgram(hyroxEngine, i, ctx, resolve, { weekdays });

  it("materialises one row per non-rest timeline spec", () => {
    expect(result.sessions).toHaveLength(nonRestCount(i));
  });

  it("groups into exactly the block's week count", () => {
    expect(result.weeks).toBe(i.weeks);
    expect(Math.max(...result.sessions.map((s) => s.weekIndex))).toBe(i.weeks - 1);
  });

  it("seats every session within the chosen schedule weekdays (0..6)", () => {
    for (const s of result.sessions) {
      expect(s.dayIndex).toBeGreaterThanOrEqual(0);
      expect(s.dayIndex).toBeLessThanOrEqual(6);
      expect(s.slot).toBe("single");
    }
  });

  it("keeps the (week, day, slot) grid collision-free", () => {
    const keys = result.sessions.map((s) => `${s.weekIndex}-${s.dayIndex}-${s.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("maps engine kinds to roles — deload markers and sims included", () => {
    expect(result.sessions.some((s) => s.role === "deload")).toBe(true);
    expect(result.sessions.some((s) => s.role === "test")).toBe(true); // simulations
    expect(result.sessions.some((s) => s.role === "strength")).toBe(true);
  });

  it("gives sessions clean content-first titles with a load cue", () => {
    for (const s of result.sessions) {
      expect(s.title).toBeTruthy();
      expect(s.title).not.toContain("HYROX · Wk");
      expect(s.title).not.toMatch(/·\s*Day \d/);
    }
    // strength → the lifts + the working % (e.g. "Squat · Deadlift · 75%" for a
    // split day, "Squat · Deadlift · Overhead Press · 83%" for a full-body day);
    // a run → the activity + duration.
    expect(result.sessions.some((s) => /^Squat · Deadlift.*· \d+%$/.test(s.title))).toBe(true);
    expect(result.sessions.some((s) => /^Easy Run · \d+ min$/.test(s.title))).toBe(true);
  });

  it("resolves strength mains off the 1RM (warm-up ramp + working main)", () => {
    const strength = result.sessions.find((s) =>
      s.prescription.items.some((it) => it.kind === "main" && it.movementId === "mv-squat"),
    );
    expect(strength).toBeDefined();
    const main = strength!.prescription.items.find((it) => it.kind === "main" && it.movementId === "mv-squat");
    expect(main!.movementName).toBeTruthy();
    expect(strength!.prescription.items.some((it) => it.kind === "warmup")).toBe(true);
  });

  it("renders runs / ergs / stations as display-only cardio_external", () => {
    const cardio = result.sessions.flatMap((s) => s.prescription.items).filter((it) => it.kind === "cardio_external");
    expect(cardio.length).toBeGreaterThan(0);
    // cardio_external is the platform's external-activity sentinel (movementId "").
    expect(cardio.every((it) => it.movementId === "")).toBe(true);
  });

  it("skips ONLY unresolved strength assistance when no planner is supplied", () => {
    expect(result.skipped.length).toBeGreaterThan(0);
    expect(result.skipped.every((s) => s.kind === "assistance")).toBe(true);
  });

  it("stamps a modality + non-negative load and the engine ref on every session", () => {
    for (const s of result.sessions) {
      expect(s.sessionModality).toBeTruthy();
      expect(s.effectiveStressLoad).toBeGreaterThanOrEqual(0);
      expect(s.prescription.programRef).toBe(s.ref);
    }
  });
});

describe("materializeProgram — HYROX honours the chosen training weekdays", () => {
  // A 3-session HYROX week placed on Tue/Thu/Sat must land EXACTLY on those days
  // (not the engine's old auto-spread). This is the unification fix: HYROX uses
  // the Schedule-step weekdays like 5/3/1 / Hybrid.
  const i = inst({ sessionsPerWeek: 3 });
  const chosen = [1, 3, 5]; // Tue / Thu / Sat
  const result = materializeProgram(hyroxEngine, i, ctx, resolve, { weekdays: chosen });

  it("places every session on a chosen weekday — none elsewhere", () => {
    for (const s of result.sessions) {
      expect(chosen).toContain(s.dayIndex);
    }
  });

  it("a normal (non-deload, non-taper) week uses all three chosen days", () => {
    const grid = buildHyroxGrid({ weeks: i.weeks, sessionsPerWeek: i.sessionsPerWeek, experience: i.experience });
    // Find a program-week index that is a full 3-session work week.
    const fullWeek = grid.find((w) => !w.isDeload && w.phase !== "taper" && w.days.filter((c) => c.kind !== "rest").length === 3);
    expect(fullWeek).toBeDefined();
    const wkIndex = fullWeek!.week - 1;
    const days = result.sessions.filter((s) => s.weekIndex === wkIndex).map((s) => s.dayIndex).sort((a, b) => a - b);
    expect(days).toEqual(chosen);
  });
});

describe("materializeProgram — HYROX two-a-days (ADR 0054)", () => {
  const i = inst({ experience: "advanced", sessionsPerWeek: 6, twoADay: true });
  const result = materializeProgram(hyroxEngine, i, ctx, resolve, { weekdays });

  it("emits paired am/pm rows on the same weekday for a double-day", () => {
    // Group sessions by (week, day); a doubled day has exactly one 'am' + one 'pm'.
    const byDay = new Map<string, string[]>();
    for (const s of result.sessions) {
      const k = `${s.weekIndex}-${s.dayIndex}`;
      byDay.set(k, [...(byDay.get(k) ?? []), s.slot]);
    }
    const doubled = [...byDay.values()].filter((slots) => slots.length === 2);
    expect(doubled.length).toBeGreaterThan(0);
    for (const slots of doubled) {
      expect(new Set(slots)).toEqual(new Set(["am", "pm"]));
    }
    // Single days stay 'single'.
    const singles = [...byDay.values()].filter((slots) => slots.length === 1);
    expect(singles.every((s) => s[0] === "single")).toBe(true);
  });

  it("the pm row is an easy off-feet erg (cardio_external), never a strength main", () => {
    const pm = result.sessions.filter((s) => s.slot === "pm");
    expect(pm.length).toBeGreaterThan(0);
    for (const s of pm) {
      expect(s.prescription.items.every((it) => it.kind === "cardio_external")).toBe(true);
    }
  });

  it("keeps the (week, day, slot) grid collision-free with doubles", () => {
    const keys = result.sessions.map((s) => `${s.weekIndex}-${s.dayIndex}-${s.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("two-a-day OFF stays single-slot only (byte-identical)", () => {
    const off = materializeProgram(hyroxEngine, inst({ experience: "advanced", sessionsPerWeek: 6 }), ctx, resolve, { weekdays });
    expect(off.sessions.every((s) => s.slot === "single")).toBe(true);
  });
});

describe("materializeProgram — HYROX with assistance planner (ADR 0047)", () => {
  const catalog: CatalogMovement[] = [
    { id: "dip", slug: "dip", displayName: "Dip", pattern: "press" },
    { id: "row", slug: "row-db", displayName: "DB Row", pattern: "pull", primaryMuscles: ["lats", "biceps"] },
    { id: "lunge", slug: "walking-lunge", displayName: "Walking Lunge", pattern: "squat", functionalRoles: ["single_leg"] as never },
    { id: "carry", slug: "farmer-carry", displayName: "Farmer Carry", pattern: "carry" },
    { id: "plank", slug: "plank", displayName: "Plank", pattern: "isolation", primaryMuscles: ["abs"] },
    { id: "run", slug: "run", displayName: "Run", pattern: "cardio" },
  ].map((m) => ({
    primaryMuscles: [],
    secondaryMuscles: [],
    secondaryRegions: [],
    primaryRegion: "",
    bulletproofRoles: [],
    functionalRoles: [],
    isSupported: true,
    isCompound: false,
    isLoadable: false,
    eccentricLoadScore: null,
    stimToFatigueScore: null,
    highStrainTendon: false,
    experienceMin: 0,
    experienceMax: 4,
    equipment: "bodyweight",
    ...m,
  })) as CatalogMovement[];

  const planner = buildAssistancePlanner({ catalog, filters: { blockedRegions: new Set() } });
  const i = inst();
  const result = materializeProgram(hyroxEngine, i, ctx, resolve, { weekdays, assistance: planner });

  it("resolves every strength assistance intent — nothing left skipped", () => {
    expect(result.skipped).toHaveLength(0);
  });

  it("adds resolved accessory items to strength sessions, never a cardio movement", () => {
    const withAccessories = result.sessions.filter((s) =>
      s.prescription.items.some((it) => it.kind === "accessory"),
    );
    expect(withAccessories.length).toBeGreaterThan(0);
    const allItems = result.sessions.flatMap((s) => s.prescription.items);
    expect(allItems.every((it) => it.movementId !== "run")).toBe(true);
  });
});
