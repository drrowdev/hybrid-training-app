import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createModularHistoricalCatalog, modularHistoricalAssertionLine, modularHistoricalInputs,
  modularHistoricalMovementSeeds, modularHistoricalSwimInputs,
} from "../../integration-tests/modular-production-legacy-graph";
import { tacticalBarbellEngine } from "../../../tacticalbarbell/src/program";
import { SEED_MOVEMENTS } from "../../seeds/movements";

vi.mock("drizzle-orm/postgres-js", () => ({ drizzle: vi.fn() }));
afterEach(() => { vi.restoreAllMocks(); });
const bench = { id: "10000000-0000-4000-8000-000000000001", slug: "bench-press-flat", displayName: "Bench Press", pattern: "push_h" };
const squat = { id: "10000000-0000-4000-8000-000000000002", slug: "back-squat-high-bar", displayName: "Back Squat", pattern: "squat" };

describe("DC-K4/DC-SW8 historical updater graph uses pre-modular paths", () => {
  it("uses complete canonical lift seeds, not the partial SQL-migration catalog", () => {
    const seeds = modularHistoricalMovementSeeds();
    expect(seeds.map((seed) => seed.slug)).toEqual(["bench-press-flat", "back-squat-high-bar"]);
    for (const seed of seeds) {
      expect(seed).toBe(SEED_MOVEMENTS.find((entry) => entry.slug === seed.slug));
      expect(seed.userId).toBeNull();
    }
  });

  function catalogFixture(present: number, failInsert = 0) {
    const seeds = modularHistoricalMovementSeeds();
    const existing = seeds.slice(0, present).map((seed, index) => ({
      ...seed, id: `10000000-0000-4000-8000-00000000000${index + 1}`, displayName: "Retain existing catalog data",
    }));
    let rows = [...existing], writes = 0;
    const database = vi.fn(async (parts: TemplateStringsArray, ...params: unknown[]) => {
      const query = parts.join("?");
      if (query.startsWith("SELECT")) {
        expect(query).toContain("WHERE user_id IS NULL AND slug=?");
        return rows.filter((row) => row.slug === params[0]);
      }
      expect(query).toBe("DELETE FROM public.movements WHERE id=?::uuid AND user_id IS NULL");
      rows = rows.filter((row) => row.id !== params[0]);
      return [];
    });
    const failure = new Error("Synthetic insert failure");
    const values = vi.fn(async (value: typeof existing[number]) => {
      expect(value).toEqual({ ...seeds.find((seed) => seed.slug === value.slug), id: expect.any(String) });
      if (++writes === failInsert) throw failure;
      rows.push(value);
    });
    vi.mocked(drizzle).mockReturnValue({ insert: () => ({ values }) } as unknown as ReturnType<typeof drizzle>);
    return { fixture: createModularHistoricalCatalog(database as unknown as postgres.Sql), values, existing, rows: () => rows, failure };
  }

  it.each([0, 1, 2])("adds only absent lifts and preserves all %s existing catalog rows through cleanup", async (present) => {
    const { fixture, values, existing, rows } = catalogFixture(present);
    await fixture.prepare();
    expect(rows()).toHaveLength(2);
    expect(values).toHaveBeenCalledTimes(2 - present);
    for (const original of existing) expect(rows()).toContain(original);
    await fixture.cleanup();
    expect(rows()).toEqual(existing);
  });

  it("removes only captured IDs after a partially completed seed and supports repeated cleanup", async () => {
    const { fixture, rows, failure } = catalogFixture(0, 2);
    await expect(fixture.prepare()).rejects.toBe(failure);
    expect(rows()).toHaveLength(1);
    await fixture.cleanup();
    await fixture.cleanup();
    expect(rows()).toEqual([]);
  });

  it.each(Array.from({ length: 7 }, (_, day) => `2026-09-${21 + day}`))("compiles a real two-day legacy authored program for %s", (today) => {
    const { authored } = modularHistoricalInputs(bench, squat, today);
    expect(authored.p_block.days_per_week).toBe(2);
    expect(authored.p_block).not.toHaveProperty("program_kind");
    expect(authored.p_planned_sessions).toHaveLength(2);
    expect(authored.p_program_instance.instance.workouts).toHaveLength(2);
    for (const row of authored.p_planned_sessions) {
      expect(row.prescription.items).toHaveLength(1);
      expect(row.prescription.items[0]).toMatchObject({ movementId: bench.id, sets: 1, reps: 5, targetWeightKg: 20 });
      expect(row.week_index).toBeGreaterThanOrEqual(0);
      expect(row.week_index).toBeLessThan(authored.p_block.weeks);
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
      expect(row.week_index).toBeGreaterThanOrEqual(0);
      expect(row.week_index).toBeLessThan(template.p_block.weeks);
      expect([0, 3]).toContain(row.day_index);
      expect(row.prescription.items).toHaveLength(prescribed.items.reduce((sum, item) => sum + (item.sets ?? 1), 0));
      expect(row.prescription.items.every((item) => [bench.id, squat.id].includes(item.movementId))).toBe(true);
    }
  });

  it("generates both real swim workouts without a seeded plan, pool, stroke, course or calibration", () => {
    const { setup, workouts } = modularHistoricalSwimInputs("2026-09-24", "2026-09-25");
    expect(setup.course).toEqual({ numerator: 25, denominator: 1, unit: "m" });
    expect(workouts.map((workout) => workout.scheduled_date)).toEqual(["2026-09-24", "2026-09-25"]);
    for (const workout of workouts) {
      expect(workout.definition.original).toEqual(workout.definition.issued);
      expect(workout.definition.issued.sections.length).toBeGreaterThan(0);
      expect(workout.definition.issued.snapshot.calibration).toBeNull();
    }
  });

  it("does not use post-0155 RPCs or weaken the used-history rollback guard", () => {
    const fixture = readFileSync(new URL("../../integration-tests/modular-production-legacy-graph.ts", import.meta.url), "utf8");
    expect(fixture).not.toMatch(/public\.(training_schedule_commit|independent_program_schedule_commit|start_planned_session_atomically)\(/);
    expect(fixture).toContain('assert.equal(process.env.GITHUB_JOB, "pool-storage")');
    const runner = readFileSync(new URL("../../integration-tests/modular-production-update-rehearsal.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");
    expect(runner).toContain("await fixture.cleanup();\n    await down(158); await down(157); await down(156);");
    expect(runner).toContain("await fixture.verifyUpgrade(substep)");
    expect(fixture.indexOf("original = await snapshot();")).toBeLessThan(fixture.indexOf("await movementFixture.prepare();"));
    expect(fixture.indexOf("await movementFixture.prepare();")).toBeLessThan(fixture.indexOf("prepared = await snapshot();"));
    const cleanup = fixture.slice(fixture.lastIndexOf("async cleanup()"));
    expect(cleanup.indexOf("DELETE FROM auth.users")).toBeLessThan(cleanup.indexOf("await movementFixture.cleanup();"));
    expect(cleanup.indexOf("await movementFixture.cleanup();")).toBeLessThan(cleanup.indexOf("assert.deepEqual(await snapshot(), original)"));
  });
});

describe("DC-SW8 historical assertion diagnostic is a failure-only bounded line", () => {
  it.each([
    [1, "/work/packages/db/integration-tests/modular-production-legacy-graph.ts"],
    [9999, "C:\\work\\packages\\db\\integration-tests\\modular-production-legacy-graph.ts"],
  ])("retains only helper line %s", (line, path) => {
    const error = new assert.AssertionError({ message: "PrivateSyntheticCanary" });
    error.stack = `AssertionError: PrivateSyntheticCanary\n    at Object.prepare (${path}:${line}:7)\n    at other (/private/file.ts:8:9)`;
    expect(modularHistoricalAssertionLine(error)).toBe(line);
  });

  it("recognizes an actual assertion thrown by the helper without a database", () => {
    expect.assertions(2);
    try { modularHistoricalSwimInputs("invalid-date", "2026-09-25"); }
    catch (error) {
      expect(error).toBeInstanceOf(assert.AssertionError);
      expect(modularHistoricalAssertionLine(error)).toBeGreaterThan(0);
    }
  });

  it.each([0, 10000])("omits out-of-range line %s", (line) => {
    const error = new assert.AssertionError({ message: "PrivateSyntheticCanary" });
    error.stack = `AssertionError\n    at prepare (/work/modular-production-legacy-graph.ts:${line}:7)`;
    expect(modularHistoricalAssertionLine(error)).toBeUndefined();
  });

  it("omits non-assertions, other files, message-only lookalikes and unreadable stacks", () => {
    const error = new Error("PrivateSyntheticCanary");
    error.stack = "Error\n    at prepare (/work/modular-production-legacy-graph.ts:42:7)";
    expect(modularHistoricalAssertionLine(error)).toBeUndefined();
    const assertion = new assert.AssertionError({ message: "PrivateSyntheticCanary" });
    assertion.stack = "AssertionError\n    at prepare (/work/modular-production-update-rehearsal.ts:42:7)";
    expect(modularHistoricalAssertionLine(assertion)).toBeUndefined();
    assertion.stack = "AssertionError: /work/modular-production-legacy-graph.ts:42:7";
    expect(modularHistoricalAssertionLine(assertion)).toBeUndefined();
    const getter = vi.fn(() => { throw error; });
    Object.defineProperty(assertion, "stack", { get: getter });
    expect(modularHistoricalAssertionLine(assertion)).toBeUndefined();
    expect(getter).toHaveBeenCalledOnce();
  });
});
