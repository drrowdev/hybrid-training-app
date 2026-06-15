/**
 * HYROX materialisation — end-to-end against the real @hta/hyrox engine
 * (ADR 0050 step 6). Proves a concrete HYROX instance flows through the
 * program-agnostic materialize/adapter path:
 *   - one planned row per non-rest timeline spec, seated on the engine's FIXED
 *     weekdays (HYROX sets an explicit weekday on every spec);
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

// Full week so the (ignored) schedule never under-seats — HYROX specs carry their
// own weekday, so this is belt-and-suspenders.
const weekdays = [0, 1, 2, 3, 4, 5, 6];

function inst(over: Partial<Record<"experience" | "division" | "sessionsPerWeek", unknown>> = {}): HyroxInstance {
  return hyroxEngine.setup(
    {
      values: {
        experience: over.experience ?? "intermediate",
        division: over.division ?? "open",
        sessionsPerWeek: over.sessionsPerWeek ?? 5,
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

  it("seats every session on the engine's fixed weekday (0..6)", () => {
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

  it("gives sessions clean content-first titles (no breadcrumb)", () => {
    for (const s of result.sessions) {
      expect(s.title).toBeTruthy();
      expect(s.title).not.toContain("HYROX · Wk");
      expect(s.title).not.toMatch(/·\s*Day \d/);
    }
    // strength → the lifts; a run → the activity (no "(Z2)" qualifier)
    expect(result.sessions.some((s) => s.title === "Squat · Deadlift · Overhead Press")).toBe(true);
    expect(result.sessions.some((s) => s.title === "Easy Run")).toBe(true);
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

describe("materializeProgram — HYROX with assistance planner (ADR 0047)", () => {
  const catalog: CatalogMovement[] = [
    { id: "dip", slug: "dip", displayName: "Dip", pattern: "press" },
    { id: "row", slug: "row-db", displayName: "DB Row", pattern: "pull", primaryMuscles: ["lats", "biceps"] },
    { id: "lunge", slug: "walking-lunge", displayName: "Walking Lunge", pattern: "squat", primaryRegion: "lumbar_trunk" },
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
