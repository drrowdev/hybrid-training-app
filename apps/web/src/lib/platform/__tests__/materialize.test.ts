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
import { materializeProgram } from "../materialize";
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
    expect(result.skipped).toHaveLength(0);
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

  it("carries the engine label as the title and maps kind → role", () => {
    const first = result.sessions[0]!;
    expect(first.title).toContain("Leader 1 · Wk 1");
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

  it("stamps a modality + non-negative effective load on every session", () => {
    for (const s of result.sessions) {
      expect(s.sessionModality).toBeTruthy();
      expect(s.effectiveStressLoad).toBeGreaterThanOrEqual(0);
    }
    // strength-only 5/3/1 (no archetype tag, no cardio) → pure_hypertrophy default
    expect(result.sessions[0]!.sessionModality).toBe("pure_hypertrophy");
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
