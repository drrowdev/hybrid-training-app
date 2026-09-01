/**
 * Green Protocol deload days — end-to-end engine → adapter → materialize.
 *
 * A deload day used to prescribe a standalone note. The adapter folds a note
 * onto the item BEFORE it; a note with nothing before it is dropped, so the
 * whole day materialised with zero items and the lifter saw a blank session.
 *
 * The replacement has to carry the guidance without adding work: several Green
 * phases put their deload marker in a week that ALREADY schedules three easy
 * conditioning days, so a prescribed 30-minute run would be a fourth aerobic
 * session the methodology never asked for.
 */
import { describe, it, expect } from "vitest";
import { greenProtocolEngine, GREEN_PHASES, type GreenInstance } from "@hta/green";
import type { PlatformContext } from "@hta/program-core";
import { materializeProgram } from "../materialize";
import type { MovementResolver } from "../adapter";

const ctx: PlatformContext = {
  oneRepMaxes: { squat: 150, bench: 100, deadlift: 200, press: 70 },
  roundingKg: 2.5,
};

const resolve: MovementResolver = (key) =>
  ["squat", "bench", "deadlift", "press"].includes(key)
    ? { movementId: `mv-${key}`, slug: `${key}-variant`, displayName: key }
    : undefined;

const weekdays = [0, 1, 2, 3, 4, 5, 6];

function inst(phaseId: string): GreenInstance {
  return greenProtocolEngine.setup({ values: { phaseId, blocks: 1 } }, ctx);
}

// Every phase, not just the one whose deload week is otherwise all rest.
const phaseIds = GREEN_PHASES.map((p) => p.id);

describe("materializeProgram — Green Protocol deload days", () => {
  it.each(phaseIds)("DC-K4: %s materialises a deload day with something in it", (phaseId) => {
    const result = materializeProgram(greenProtocolEngine, inst(phaseId), ctx, resolve, {
      weekdays,
    });
    const deloads = result.sessions.filter((s) => s.role === "deload");
    expect(deloads.length).toBeGreaterThan(0);
    for (const s of deloads) {
      expect(s.prescription.items.length).toBeGreaterThan(0);
    }
  });

  it.each(phaseIds)("DC-K4: %s deload day adds no training dose", (phaseId) => {
    const result = materializeProgram(greenProtocolEngine, inst(phaseId), ctx, resolve, {
      weekdays,
    });
    for (const s of result.sessions.filter((d) => d.role === "deload")) {
      expect(s.effectiveStressLoad).toBe(0);
      expect(s.sessionModality).toBe("restorative");
      for (const item of s.prescription.items) {
        expect(item.kind).toBe("cardio_external");
        // No duration → the week's planned aerobic minutes are unchanged, so a
        // deload week that already schedules three easy runs does not gain a
        // fourth.
        expect(item.durationMin ?? 0).toBe(0);
        expect(item.sets ?? 0).toBe(0);
      }
    }
  });

  it("DC-K4: the deload title carries no invented duration", () => {
    const result = materializeProgram(greenProtocolEngine, inst("hybrid"), ctx, resolve, {
      weekdays,
    });
    for (const s of result.sessions.filter((d) => d.role === "deload")) {
      expect(s.title).not.toMatch(/\d+\s*min/);
    }
  });

  it("DC-K4: nothing is silently dropped on the way to the session", () => {
    for (const phaseId of phaseIds) {
      const result = materializeProgram(greenProtocolEngine, inst(phaseId), ctx, resolve, {
        weekdays,
      });
      expect(result.skipped.filter((s) => s.kind === "note")).toHaveLength(0);
    }
  });
});
