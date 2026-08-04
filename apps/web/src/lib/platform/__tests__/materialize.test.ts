/**
 * Program materialisation — end-to-end against the real 5/3/1 engine.
 *
 * Proves that a concrete Wendler instance materialises into the app's
 * `(week_index, day_index)` grid correctly: weeks grouped by the engine's
 * weekLabel runs, sessions seated on the user's training weekdays, prescriptions
 * adapted + resolved, modality/load stamped, and the `(week, day, slot)` grid
 * collision-free (the planned_sessions unique key).
 */
import { describe, it, expect } from "vitest";
import type { PlatformContext } from "@hta/program-core";
import { wendler531Engine, type WendlerInstance } from "@hta/wendler";
import { tacticalBarbellEngine } from "@hta/tacticalbarbell";
import { greenProtocolEngine } from "@hta/green";
import { materializeProgram } from "../materialize";
import { buildAssistancePlanner } from "../assistance-resolver";
import { buildTbAccessoryInjector } from "../tb-accessories";
import type { CatalogMovement } from "@/lib/planner/accessory-picker";
import type { MovementResolver } from "../adapter";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 165, bench: 118, deadlift: 212, press: 71 },
  roundingKg: 2.5,
};

// Each 5/3/1 engine key resolves to a stub anchored movement.
const resolve: MovementResolver = (key) =>
  ({
    movementId: `mv-${key}`,
    slug: `${key}-variant`,
    displayName: key[0]!.toUpperCase() + key.slice(1),
  });

function setup(values: Record<string, unknown> = {}): WendlerInstance {
  return wendler531Engine.setup(
    { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85, ...values } },
    ctx,
  );
}

// Mon/Tue/Thu/Fri — the conventional 4-day 5/3/1 split.
const weekdays = [0, 1, 3, 4];

describe("materializeProgram — 5/3/1 default block", () => {
  const result = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays });

  it("materialises one row per non-rest timeline session", () => {
    // 2 leader cycles × 3 wk × 4 lifts (24) + deload 4 + anchor 1 × 3 × 4 (12) + TM-test 4 = 44
    expect(result.sessions).toHaveLength(44);
    // ADR 0047: with NO assistance planner passed, each session's 3 assistance
    // INTENT slots have no movementId, so they're skipped. All 44 sessions emit
    // assistance now — the 36 training sessions at their supplemental dose and the
    // 8 deload / TM-test sessions at the 7th-week LIGHT dose — so 44 × 3 = 132
    // skips. Every skip is an assistance slot.
    expect(result.skipped).toHaveLength(132);
    expect(result.skipped.every((s) => s.kind === "assistance")).toBe(true);
  });

  it("groups the timeline into 11 program-weeks", () => {
    // leader 2×3 (6) + deload 7w (1) + anchor 3 (3) + TM-test 7w (1) = 11
    expect(result.weeks).toBe(11);
    expect(Math.max(...result.sessions.map((s) => s.weekIndex))).toBe(10);
  });

  it("seats each program-week's four lifts on the scheduled weekdays in order", () => {
    const wk0 = result.sessions.filter((s) => s.weekIndex === 0);
    expect(wk0).toHaveLength(4);
    expect(wk0.map((s) => s.dayIndex)).toEqual([0, 1, 3, 4]);
    expect(wk0.every((s) => s.slot === "single")).toBe(true);
  });

  it("keeps the (week, day, slot) grid collision-free (planned_sessions unique key)", () => {
    const keys = result.sessions.map((s) => `${s.weekIndex}-${s.dayIndex}-${s.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("derives a clean content title (lifts + working %) and maps kind → role", () => {
    const first = result.sessions[0]!;
    // Day 1 of the default order is the Press — the title names the lift(s) plus
    // the top working % (5/3/1 = % of TM), not the old "Leader 1 · Wk 1 · …".
    expect(first.title).toContain("Overhead Press");
    expect(first.title).toMatch(/·\s*\d+%$/);
    expect(first.title).not.toContain("Wk 1");
    expect(first.title).not.toContain("Leader");
    expect(first.role).toBe("strength");
    // the deload 7th week materialises as role 'deload'
    expect(result.sessions.some((s) => s.role === "deload")).toBe(true);
    // the final TM-test 7th week materialises as role 'test'
    expect(result.sessions.some((s) => s.role === "test")).toBe(true);
  });

  it("adapts + resolves the prescription items (no skips for a clean cluster)", () => {
    const first = result.sessions[0]!;
    expect(first.prescription.items.length).toBeGreaterThan(0);
    const main = first.prescription.items.find((i) => i.kind === "main");
    expect(main).toBeDefined();
    expect(main!.movementId).toMatch(/^mv-/);
    expect(main!.movementName).toBeTruthy();
  });

  it("stamps the engine ref on each prescription for the progression hook", () => {
    for (const s of result.sessions) {
      expect(s.prescription.programRef).toBe(s.ref);
    }
  });

  it("stamps a modality + non-negative effective load on every session", () => {
    for (const s of result.sessions) {
      expect(s.sessionModality).toBeTruthy();
      expect(s.effectiveStressLoad).toBeGreaterThanOrEqual(0);
    }
    // strength-only 5/3/1 (no archetype tag, no cardio) → pure_hypertrophy default
    expect(result.sessions[0]!.sessionModality).toBe("pure_hypertrophy");
  });
});

describe("materializeProgram — 5/3/1 with assistance planner (ADR 0047)", () => {
  // Small catalog: one candidate per category, plus a cardio item that must
  // never be selected as assistance.
  const catalog: CatalogMovement[] = [
    { id: "dip", slug: "dip", displayName: "Dip", pattern: "press" },
    { id: "row", slug: "row-db", displayName: "DB Row", pattern: "pull", primaryMuscles: ["lats", "biceps"] },
    { id: "plank", slug: "plank", displayName: "Plank", pattern: "isolation", primaryRegion: "lumbar_trunk" },
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
  const result = materializeProgram(wendler531Engine, setup(), ctx, resolve, {
    weekdays,
    assistance: planner,
  });

  it("resolves every assistance intent — no assistance is left skipped", () => {
    expect(result.skipped).toHaveLength(0);
  });

  it("adds three resolved accessory movements to each training session", () => {
    const training = result.sessions.filter((s) => s.role === "strength");
    expect(training.length).toBeGreaterThan(0);
    for (const s of training) {
      const accessories = s.prescription.items.filter((i) => i.kind === "accessory");
      // Accessory sets are expanded one-item-per-set (3 movements × 3 sets = 9).
      expect(accessories).toHaveLength(9);
      expect([...new Set(accessories.map((a) => a.movementId))].sort()).toEqual([
        "dip",
        "plank",
        "row",
      ]);
      expect(accessories.every((a) => a.sets === 1)).toBe(true);
    }
  });

  it("never resolves assistance to a cardio movement", () => {
    const all = result.sessions.flatMap((s) => s.prescription.items);
    expect(all.every((i) => i.movementId !== "run")).toBe(true);
  });

  it("adds three LIGHT (2-set) accessories to deload / TM-test sessions too (7th Week Protocol)", () => {
    const nonTraining = result.sessions.filter((s) => s.role !== "strength");
    expect(nonTraining.length).toBeGreaterThan(0);
    for (const s of nonTraining) {
      const accessories = s.prescription.items.filter((i) => i.kind === "accessory");
      // 5/3/1 Forever keeps assistance during the 7th week but at a reduced 2-set
      // dose — expanded one-item-per-set → 3 movements × 2 sets = 6.
      expect(accessories).toHaveLength(6);
      expect([...new Set(accessories.map((a) => a.movementId))].sort()).toEqual([
        "dip",
        "plank",
        "row",
      ]);
      expect(accessories.every((a) => a.sets === 1)).toBe(true);
    }
  });
});

describe("materializeProgram — scheduling", () => {
  it("honours a different weekday schedule", () => {
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays: [0, 2, 4, 6] });
    expect(r.sessions.filter((s) => s.weekIndex === 0).map((s) => s.dayIndex)).toEqual([0, 2, 4, 6]);
  });

  it("throws when the schedule can't seat a program-week", () => {
    expect(() =>
      materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays: [0, 1, 2] }),
    ).toThrow(/more sessions than/);
  });

  it("seats a 2-day 5/3/1 block as two sessions/week, each training two main lifts", () => {
    const inst = setup({ daysPerWeek: 2 });
    const r = materializeProgram(wendler531Engine, inst, ctx, resolve, { weekdays: [0, 3] });
    const wk0 = r.sessions.filter((s) => s.weekIndex === 0);
    expect(wk0).toHaveLength(2);
    expect(wk0.map((s) => s.dayIndex)).toEqual([0, 3]);
    // each session prescribes two distinct main lifts
    const mains = wk0[0]!.prescription.items.filter((i) => i.kind === "main");
    expect(new Set(mains.map((m) => m.movementId)).size).toBe(2);
    // total sessions: leader 2×3×2 + deload 2 + anchor 1×3×2 + tm-test 2 = 22
    expect(r.sessions).toHaveLength(22);
  });

  it("reports unresolved movements in skipped rather than dropping silently", () => {
    const onlySquat: MovementResolver = (k) => (k === "squat" ? resolve(k) : undefined);
    const r = materializeProgram(wendler531Engine, setup(), ctx, onlySquat, { weekdays });
    expect(r.skipped.length).toBeGreaterThan(0);
    // squat sessions still resolve their main item; non-squat mains are skipped
    expect(
      r.sessions.some((s) => s.prescription.items.some((i) => i.movementId === "mv-squat")),
    ).toBe(true);
    expect(r.skipped.some((s) => s.reason.includes("bench"))).toBe(true);
  });
});

describe("materializeProgram — TB optional accessories (ADR 0048)", () => {
  const accessoryCatalog: CatalogMovement[] = [
    { id: "curl", slug: "barbell-curl", displayName: "Barbell Curl", pattern: "isolation", primaryMuscles: ["biceps"] },
    { id: "calf", slug: "calf-raise", displayName: "Calf Raise", pattern: "isolation", primaryMuscles: ["calves"] },
    { id: "plank", slug: "plank", displayName: "Plank", pattern: "isolation", primaryMuscles: ["abs"] },
  ].map((m) => ({
    secondaryMuscles: [],
    primaryRegion: "",
    secondaryRegions: [],
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

  function tbInstance() {
    return tacticalBarbellEngine.setup({ values: { templateId: "operator" } }, ctx);
  }

  it("appends accessory items to TB training sessions when an injector is supplied", () => {
    const injector = buildTbAccessoryInjector({
      catalog: accessoryCatalog,
      filters: { blockedRegions: new Set() },
      muscles: ["biceps", "calves", "abs"],
      maxItems: 2,
      setsPerItem: 3,
    });
    const r = materializeProgram(tacticalBarbellEngine, tbInstance(), ctx, resolve, {
      weekdays: [0, 2, 4],
      accessories: injector,
    });
    const training = r.sessions.filter((s) => s.role === "strength");
    expect(training.length).toBeGreaterThan(0);
    for (const s of training) {
      const acc = s.prescription.items.filter((i) => i.kind === "accessory");
      expect(acc).toHaveLength(2);
      expect(acc.every((a) => a.sets === 3 && a.reps === 12)).toBe(true);
      expect(acc.every((a) => ["curl", "calf", "plank"].includes(a.movementId))).toBe(true);
    }
  });

  it("adds NO accessories when no injector is supplied (TB default)", () => {
    const r = materializeProgram(tacticalBarbellEngine, tbInstance(), ctx, resolve, {
      weekdays: [0, 2, 4],
    });
    const acc = r.sessions.flatMap((s) => s.prescription.items).filter((i) => i.kind === "accessory");
    expect(acc).toHaveLength(0);
  });
});

describe("materializeProgram — TB3 Activation", () => {
  const activationCtx: PlatformContext = {
    oneRepMaxes: {
      ...ctx.oneRepMaxes,
      "barbell-row": 100,
      "pendlay-row": 100,
      "rack-pull": 200,
      "weighted-pullup": 40,
      "power-clean": 80,
      "push-press": 70,
    },
    roundingKg: 2.5,
  };
  const instance = tacticalBarbellEngine.setup(
    { values: { templateId: "activation" } },
    activationCtx,
  );
  const result = materializeProgram(
    tacticalBarbellEngine,
    instance,
    activationCtx,
    resolve,
    { weekdays: [0] },
  );

  it("materialises all 25 weeks on the engine-owned phase schedule", () => {
    expect(result.sessions).toHaveLength(111);
    expect(result.weeks).toBe(25);
    expect(result.skipped).toHaveLength(0);
    expect(result.sessions.filter((session) => session.weekIndex === 0).map((session) => session.dayIndex)).toEqual([0, 2, 4, 1, 3, 5]);
    expect(result.sessions.filter((session) => session.weekIndex === 5).map((session) => session.dayIndex)).toEqual([0, 1, 3, 5, 2, 4]);
    expect(result.sessions.filter((session) => session.weekIndex === 21).map((session) => session.dayIndex)).toEqual([0, 3, 1, 5]);
    expect(result.sessions.filter((session) => session.weekIndex === 5 && session.role === "strength")).toHaveLength(4);
    expect(result.sessions.filter((session) => session.weekIndex === 5 && session.role === "cardio")).toHaveLength(2);
  });

  it("starting at Armor rebases a 4 strength / 2 cardio week to week zero", () => {
    const armor = materializeProgram(
      tacticalBarbellEngine,
      instance,
      activationCtx,
      resolve,
      { weekdays: [0], startWeekIndex: 5 },
    );
    const firstWeek = armor.sessions.filter((session) => session.weekIndex === 0);
    expect(firstWeek.filter((session) => session.role === "strength")).toHaveLength(4);
    expect(firstWeek.filter((session) => session.role === "cardio")).toHaveLength(2);
    expect(firstWeek.map((session) => session.dayIndex).sort()).toEqual([0, 1, 2, 3, 4, 5]);
    expect(armor.weeks).toBe(20);
  });

  it("materialises the corrected Armor main, supplemental and Ab Triad work", () => {
    const a1 = result.sessions.find(
      (session) => session.weekIndex === 5 && session.ref.endsWith("armor-a1"),
    )!;
    const b1 = result.sessions.find(
      (session) => session.weekIndex === 5 && session.ref.endsWith("armor-b1"),
    )!;
    const itemsFor = (
      session: typeof a1,
      engineKey: string,
      kind: string,
    ) => session.prescription.items.filter(
      (item) => item.movementId === `mv-${engineKey}` && item.kind === kind,
    );

    expect(itemsFor(a1, "rack-pull", "main")).toHaveLength(4);
    expect(itemsFor(a1, "back-extension", "back_off")).toHaveLength(5);
    expect(itemsFor(a1, "back-extension", "back_off").filter((item) => item.optional)).toHaveLength(2);
    for (const movement of ["hanging-leg-raise", "hanging-knee-raise", "toes-to-bar"]) {
      const items = itemsFor(a1, movement, "accessory");
      expect(items).toHaveLength(3);
      expect(items.every((item) => item.reps === 5)).toBe(true);
    }
    expect(a1.prescription.items.some((item) => item.movementId === "mv-ab-triad")).toBe(false);
    expect(itemsFor(b1, "weighted-pullup", "main")).toHaveLength(4);
    expect(itemsFor(b1, "weighted-pullup", "main").some((item) => item.optional)).toBe(false);
    expect(a1.title).not.toContain("Back Extension");
  });

  it("preserves test/deload roles and optional Operator Black sets", () => {
    expect(result.sessions.filter((session) => session.weekIndex === 4).every((session) => session.role === "test")).toBe(true);
    expect(result.sessions.filter((session) => session.weekIndex === 14).every((session) => session.role === "deload")).toBe(true);
    const black = result.sessions.find(
      (session) => session.weekIndex === 15 && session.ref.endsWith("operator-d1"),
    )!;
    const main = black.prescription.items.filter((item) => item.kind === "main");
    expect(main.filter((item) => item.optional)).toHaveLength(6);
    expect(main.filter((item) => !item.optional)).toHaveLength(9);
  });
});

describe("materializeProgram — Green Protocol (concurrent strength + cardio)", () => {
  it("seats sessions on the engine's own weekdays and materialises cardio days", () => {
    const inst = greenProtocolEngine.setup(
      { values: { phaseId: "hybrid", blocks: 1, useTrainingMax: false, tmPercent: 0.9 } },
      ctx,
    );
    // weekdays here are ignored — GP sets an explicit weekday on every spec.
    const r = materializeProgram(greenProtocolEngine, inst, ctx, resolve, { weekdays: [0] });
    expect(r.sessions.length).toBeGreaterThan(0);

    // Strength days resolve to the user's anchored movements (delegated to TB).
    const strengthDay = r.sessions.find((s) =>
      s.prescription.items.some((i) => i.kind === "main"),
    );
    expect(strengthDay, "GP has strength days").toBeTruthy();

    // Cardio days materialise as display-only cardio_external items (not empty).
    const cardioDay = r.sessions.find((s) =>
      s.prescription.items.some((i) => i.kind === "cardio_external"),
    );
    expect(cardioDay, "GP has cardio days").toBeTruthy();
    expect(cardioDay!.prescription.items[0]!.movementId).toBe("");

    // Every session carries its engine-assigned weekday (0=Mon).
    expect(r.sessions.every((s) => s.dayIndex >= 0 && s.dayIndex <= 6)).toBe(true);
  });
});

describe("materializeProgram — startWeekIndex (start point)", () => {
  const full = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays });

  it("omitting startWeekIndex is byte-identical to startWeekIndex: 0", () => {
    const zero = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, startWeekIndex: 0 });
    expect(zero).toEqual(full);
  });

  it("starting at Anchor 1 (program-week 7) skips the leaders + first deload and rebases to weekIndex 0", () => {
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, startWeekIndex: 7 });
    // anchor 1 cycle × 3 wk × 4 lifts (12) + TM-test 4 = 16; 4 program-weeks.
    expect(r.sessions).toHaveLength(16);
    expect(r.weeks).toBe(4);
    expect(Math.min(...r.sessions.map((s) => s.weekIndex))).toBe(0);
    expect(Math.max(...r.sessions.map((s) => s.weekIndex))).toBe(3);
  });

  it("keeps engine refs ABSOLUTE — the rebased week mirrors the same week of the full plan", () => {
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, startWeekIndex: 7 });
    const rebasedWk0 = r.sessions.filter((s) => s.weekIndex === 0).map((s) => s.prescription.programRef);
    const fullWk7 = full.sessions.filter((s) => s.weekIndex === 7).map((s) => s.prescription.programRef);
    expect(rebasedWk0).toEqual(fullWk7);
    // The chosen start really is the Anchor phase (refs carry the segment index).
    expect(rebasedWk0.every((ref) => typeof ref === "string" && ref.length > 0)).toBe(true);
  });

  it("clamps a negative startWeekIndex to the beginning", () => {
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, startWeekIndex: -3 });
    expect(r).toEqual(full);
  });
});

describe("materializeProgram — cardioWeekdays (open cardio days)", () => {
  const base = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays });

  it("omitting cardioWeekdays is byte-identical to an empty list", () => {
    const empty = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, cardioWeekdays: [] });
    expect(empty).toEqual(base);
  });

  it("adds one cardio_external placeholder per listed weekday in every program-week", () => {
    // Sat (5) + Sun (6) are open; 11 program-weeks → 22 cardio placeholders.
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, cardioWeekdays: [5, 6] });
    const cardio = r.sessions.filter((s) =>
      s.prescription.items.length > 0 && s.prescription.items.every((i) => i.kind === "cardio_external"),
    );
    expect(cardio).toHaveLength(22);
    // One on each of Sat/Sun for every week 0..10.
    for (let wk = 0; wk <= 10; wk++) {
      expect(cardio.filter((s) => s.weekIndex === wk).map((s) => s.dayIndex).sort()).toEqual([5, 6]);
    }
    // Shape: role cardio, the cardio_external sentinel, classified as cardio modality.
    expect(cardio.every((s) => s.role === "cardio")).toBe(true);
    expect(cardio.every((s) => s.prescription.items[0]!.movementId === "")).toBe(true);
    expect(cardio.every((s) => s.prescription.programRef === s.ref)).toBe(true);
    // The strength sessions are unchanged from the no-cardio plan.
    const strength = r.sessions.filter((s) => s.role !== "cardio");
    expect(strength).toEqual(base.sessions);
    expect(r.weeks).toBe(base.weeks);
  });

  it("skips a cardio weekday that collides with a strength session that week", () => {
    // Mon (0) is already a strength day → no cardio placeholder is added there.
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, cardioWeekdays: [0] });
    const cardio = r.sessions.filter((s) => s.role === "cardio");
    expect(cardio).toHaveLength(0);
    expect(r.sessions).toEqual(base.sessions);
  });

  it("keeps the (week, day, slot) grid collision-free with cardio added", () => {
    const r = materializeProgram(wendler531Engine, setup(), ctx, resolve, { weekdays, cardioWeekdays: [5, 6] });
    const keys = r.sessions.map((s) => `${s.weekIndex}-${s.dayIndex}-${s.slot}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
