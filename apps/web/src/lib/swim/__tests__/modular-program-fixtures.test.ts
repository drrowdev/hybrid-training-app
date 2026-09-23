import { describe, expect, it } from "vitest";
import { authoredProgramDates, resolveTargetLoadKg } from "@hta/domain";
import { tacticalBarbellEngine } from "@hta/tacticalbarbell";
import { greenProtocolEngine, getGreenPhase } from "@hta/green";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { runInNewContext } from "node:vm";
import { ScriptTarget, transpileModule } from "typescript";
import type { Prescription } from "@hta/db";
import { groupPrescriptionByMovement } from "../../sessions/movement-grouping";
import { authoredProgramInput, nativeProgramDefinition, nativeTemplateInput } from "../../../../e2e/fixtures/modular-programs";

const liftId = "00000000-0000-4000-8000-000000000001", runId = "00000000-0000-4000-8000-000000000002";
const catalog = [
  { id: liftId, slug: "bench-press-flat", displayName: "Bench press", pattern: "press" },
  { id: runId, slug: "run-easy-z2", displayName: "Easy run", pattern: "cardio", modality: "run" },
];

describe("DC-K4 native ownership preparation uses canonical prescription and calendar contracts", () => {
  it.each(["strength", "running", "hybrid"] as const)("keeps %s modality and real IDs for all seven start weekdays", (kind) => {
    for (let weekday = 0; weekday < 7; weekday++) {
      const today = `2026-09-${21 + weekday}`;
      const definition = nativeProgramDefinition(kind, "Owned program", weekday, liftId, runId);
      const input = authoredProgramInput(definition, today, catalog);
      const dates = authoredProgramDates(definition, today);
      expect(input.p_planned_sessions).toHaveLength(1);
      expect(dates[0]!.date).toBe(today);
      expect(input.p_block.weeks).toBe(dates[0]!.weekIndex + 1);
      expect(input.p_planned_sessions[0]).toMatchObject({
        week_index: dates[0]!.weekIndex, day_index: weekday,
        prescription: { programRef: dates[0]!.ref, meta: { authoredWorkout: definition.workouts[0] } },
      });
      expect(input.p_planned_sessions[0]!.prescription.items.map((item) => item.movementId))
        .toEqual(kind === "strength" ? [liftId] : kind === "running" ? [runId] : [runId, liftId]);
      expect(input.p_tm_percents).toEqual([]);
    }
  });

  it("materializes different template-owned load bases without dropping required conditioning", () => {
    const ctx = { oneRepMaxes: { bench: 100, squat: 100, deadlift: 150, press: 60 }, roundingKg: 2.5 };
    const resolveMovement = (key: string) => ({ movementId: key === "bench" ? liftId : runId, slug: key, displayName: key });
    const strength = nativeTemplateInput({
      engine: tacticalBarbellEngine, ctx, resolveMovement, startedOn: "2026-09-21", weekdays: [0, 3], kind: "strength",
      values: { templateId: "fighter", blocks: 1, cluster: ["bench", "squat"], useTemplateDefaults: false,
        useTrainingMax: true, tmPercent: 0.9 },
    });
    const hybrid = nativeTemplateInput({
      engine: greenProtocolEngine, ctx, resolveMovement, startedOn: "2026-09-21", weekdays: [0, 2, 4], kind: "hybrid",
      values: { phaseId: "hybrid", blocks: 1, cluster: ["bench", "squat", "deadlift"], useTrainingMax: false },
    });
    const first = [strength, hybrid].map((input) => input.p_planned_sessions.find((row) =>
      row.prescription.items[0]?.movementId === liftId &&
      row.prescription.items.some((item) => item.movementId === liftId && item.kind === "main"))!
      .prescription.items.find((item) => item.movementId === liftId && item.kind === "main")!);
    expect(first[0]!.meta?.programLoadBasis).toEqual({ version: 1, kind: "one-rm", percent: 90, roundingKg: 2.5 });
    expect(first[1]!.meta?.programLoadBasis).toEqual({ version: 1, kind: "one-rm", percent: 100, roundingKg: null });
    expect(first.map((item) => item.percentTm)).toEqual([75, 70]);
    const loads = first.map((item) => resolveTargetLoadKg(item, { oneRmKg: 110, tmKg: 106.7, roundKg: (kg) => Math.round(kg / 2.5) * 2.5 }));
    expect(loads.every((kg) => kg !== null && kg > 0)).toBe(true);
    expect(loads[0]).not.toBe(loads[1]);
    expect(hybrid.p_planned_sessions.some((row) => row.prescription.items.some((item) => item.kind.startsWith("cardio_")))).toBe(true);
    expect(strength.p_planned_sessions.every((row) => row.prescription.items.every((item) => !item.kind.startsWith("cardio_")))).toBe(true);
  });

  it("retains Capacity's terminal benchmark and generates genuine next-phase advice", () => {
    const ctx = { oneRepMaxes: { bench: 100, squat: 100, deadlift: 150, press: 60 }, roundingKg: 2.5 };
    const input = nativeTemplateInput({
      engine: greenProtocolEngine, ctx, startedOn: "2026-09-21", weekdays: [0, 2, 4], kind: "hybrid",
      resolveMovement: (key) => ({ movementId: liftId, slug: key, displayName: key }),
      startWeekIndex: getGreenPhase("capacity")!.weeks.length - 1,
      values: { phaseId: "capacity", blocks: 1, useTrainingMax: false },
    });
    expect(input.p_block.weeks).toBe(1);
    expect(input.p_planned_sessions).toHaveLength(3);
    const terminal = input.p_planned_sessions.at(-1)!;
    expect(terminal.prescription.items).toHaveLength(1);
    expect(terminal.prescription.items[0]!.kind).toBe("cardio_external");
    const result = greenProtocolEngine.onSessionLogged(input.p_program_instance.instance, {
      ref: terminal.prescription.programRef!, performedAt: "2026-09-26T12:00:00.000Z", sets: [],
    }, ctx);
    expect(result.recommendations).toEqual(expect.arrayContaining([expect.objectContaining({
      kind: "next-block", data: { programId: "green-protocol", nextPhaseId: "velocity", nextPhaseName: "Velocity" },
    })]));
  });

  it("selects M12's Bench group by identity in Green's real Squat-first setup and retains the 65 kg oracle", () => {
    const ctx = { oneRepMaxes: { bench: 110, squat: 100, deadlift: 150, press: 60 }, roundingKg: 2.5 };
    const keys = ["bench", "squat", "deadlift", "press"];
    const input = nativeTemplateInput({
      engine: greenProtocolEngine, ctx, startedOn: "2026-09-21", weekdays: [0, 2, 4], kind: "hybrid",
      resolveMovement: (key) => ({
        movementId: `00000000-0000-4000-8000-${String(keys.indexOf(key) + 1).padStart(12, "0")}`,
        slug: key, displayName: key,
      }),
      values: { phaseId: "hybrid", blocks: 1, useTrainingMax: true, tmPercent: 0.85 },
    });
    const source = readFileSync(resolve(__dirname, "../../../../e2e/program-builder-mobile.spec.ts"), "utf8");
    const helper = source.slice(source.indexOf("const firstBench ="), source.indexOf("const selectBench ="));
    const firstBench = runInNewContext(transpileModule(`${helper}\nfirstBench;`, {
      compilerOptions: { target: ScriptTarget.ES2022 },
    }).outputText, { expect, groupPrescriptionByMovement, bench: { movementId: liftId }, original: [] }) as
      (blockId: string, rows: { block_id: string; prescription: Prescription }[]) =>
        { index: number; slot: number; groupKey: string; item: Prescription["items"][number]; row: { prescription: Prescription } };
    const target = firstBench("hybrid", input.p_planned_sessions.map((row) => ({ ...row, block_id: "hybrid" })));
    expect(target.row.prescription.items[0]?.movementId).not.toBe(liftId);
    expect(target.groupKey).toBe(liftId);
    expect(target.index).toBeGreaterThan(target.slot);
    expect(target.item).toMatchObject({ movementId: liftId, kind: "main", percentTm: 70,
      meta: { programLoadBasis: { kind: "one-rm", percent: 85, roundingKg: 2.5 } } });
    expect(resolveTargetLoadKg(target.item, { oneRmKg: 110, tmKg: 106.7, roundKg: (kg) => Math.round(kg / 2.5) * 2.5 })).toBe(65);
  });
});
