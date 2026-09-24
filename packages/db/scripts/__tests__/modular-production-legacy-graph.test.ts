import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { modularHistoricalInputs } from "../../integration-tests/modular-production-legacy-graph";
import { tacticalBarbellEngine } from "../../../tacticalbarbell/src/program";

const bench = { id: "10000000-0000-4000-8000-000000000001", slug: "bench-press-flat", displayName: "Bench Press", pattern: "push_h" };
const squat = { id: "10000000-0000-4000-8000-000000000002", slug: "back-squat-high-bar", displayName: "Back Squat", pattern: "squat" };

describe("DC-K4/DC-SW8 historical updater graph uses pre-modular paths", () => {
  it.each(["2026-09-24", "2026-09-27"])("compiles a real two-day legacy authored program for %s", (today) => {
    const { authored } = modularHistoricalInputs(bench, squat, today);
    expect(authored.p_block.days_per_week).toBe(2);
    expect(authored.p_block).not.toHaveProperty("program_kind");
    expect(authored.p_planned_sessions).toHaveLength(2);
    expect(authored.p_program_instance.instance.workouts).toHaveLength(2);
    for (const row of authored.p_planned_sessions) {
      expect(row.prescription.items).toHaveLength(1);
      expect(row.prescription.items[0]).toMatchObject({ movementId: bench.id, sets: 1, reps: 5, targetWeightKg: 20 });
    }
  });

  it("retains the template engine instance, complete timeline and every required set", () => {
    const { template } = modularHistoricalInputs(bench, squat, "2026-09-24");
    const timeline = tacticalBarbellEngine.timeline(template.p_program_instance.instance);
    expect(template.p_planned_sessions).toHaveLength(timeline.length);
    expect(timeline.length).toBeGreaterThan(2);
    expect(template.p_block).not.toHaveProperty("program_kind");
    for (const [index, spec] of timeline.entries()) {
      const prescribed = tacticalBarbellEngine.prescribe(template.p_program_instance.instance, spec.ref,
        { oneRepMaxes: { bench: 100, squat: 100 }, roundingKg: 2.5 });
      const row = template.p_planned_sessions[index]!;
      expect(row.prescription.programRef).toBe(spec.ref);
      expect(row.prescription.items).toHaveLength(prescribed.items.reduce((sum, item) => sum + (item.sets ?? 1), 0));
      expect(row.prescription.items.every((item) => [bench.id, squat.id].includes(item.movementId))).toBe(true);
    }
  });

  it("does not use post-0155 RPCs or weaken the used-history rollback guard", () => {
    const fixture = readFileSync(new URL("../../integration-tests/modular-production-legacy-graph.ts", import.meta.url), "utf8");
    expect(fixture).not.toMatch(/public\.(training_schedule_commit|independent_program_schedule_commit|start_planned_session_atomically)\(/);
    expect(fixture).toContain('assert.equal(process.env.GITHUB_JOB, "pool-storage")');
    const runner = readFileSync(new URL("../../integration-tests/modular-production-update-rehearsal.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    expect(runner).toContain("await fixture.cleanup();\n    await down(158); await down(157); await down(156);");
    expect(runner).toContain("await fixture.verifyUpgrade()");
  });
});
