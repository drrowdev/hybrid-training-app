import { beforeEach, describe, expect, it, vi } from "vitest";

const { activateSeasonBlock, buildProgramInstanceWrite, revalidatePath, state } = vi.hoisted(() => ({
  activateSeasonBlock: vi.fn(),
  buildProgramInstanceWrite: vi.fn(),
  revalidatePath: vi.fn(),
  state: {
    legacyError: null as { message: string } | null,
    rpcCalls: [] as string[],
    writes: [] as string[],
    modular: false,
    readinessValue: true,
    readinessError: null as { code: string; message: string } | null,
    revision: "a".repeat(32),
    active: null as { id: string; notes: string; started_on: string; program_id: string; program_kind: "strength" | "running" | "hybrid" | null } | null,
    receipt: null as { context: Record<string, unknown> } | null,
    lastCommit: null as Record<string, unknown> | null,
    recommendation: null as Record<string, unknown> | null,
    recommendationBlock: null as Record<string, unknown> | null,
    recommendationInstance: null as Record<string, unknown> | null,
  },
}));

const user = { id: "00000000-0000-4000-8000-000000000001" };
const seasonBlockId = "00000000-0000-4000-8000-000000000002";

function queryFor(table: string) {
  let operation = "read";
  const filters: Record<string, unknown> = {};
  const result = () => {
    if (operation === "read" && table === "program_recommendations") return { data: state.recommendation, error: null };
    if (operation === "read" && table === "training_blocks" && filters.id) return { data: state.recommendationBlock, error: null };
    if (operation === "read" && table === "program_instances") return { data: state.recommendationInstance, error: null };
    if (operation === "read" && table === "training_blocks") return { data: state.active ? [state.active] : [], error: null };
    if (operation === "read" && table === "engine_override_events") return { data: state.receipt, error: null };
    if (table === "training_blocks" && operation === "insert") {
      return state.legacyError
        ? { data: null, error: state.legacyError }
        : { data: { id: "block-from-legacy" }, error: null };
    }
    if (table === "program_instances" && operation === "insert") {
      return { data: { id: "instance-from-legacy" }, error: null };
    }
    return { data: null, error: null };
  };
  const query = {
    insert: () => {
      state.writes.push(`${table}:insert`);
      operation = "insert";
      return query;
    },
    update: () => {
      state.writes.push(`${table}:update`);
      operation = "update";
      return query;
    },
    delete: () => {
      state.writes.push(`${table}:delete`);
      operation = "delete";
      return query;
    },
    select: () => query,
    eq: (key: string, value: unknown) => { filters[key] = value; return query; },
    is: () => query,
    neq: () => query,
    in: () => query,
    maybeSingle: async () => result(),
    single: async () => result(),
    then: <TResult1 = { data: unknown; error: unknown }, TResult2 = never>(
      onfulfilled?: ((value: { data: unknown; error: unknown }) => TResult1 | PromiseLike<TResult1>) | null,
      onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
    ) => Promise.resolve(result()).then(onfulfilled, onrejected),
  };
  return query;
}

vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/seasons/activation", () => ({ activateSeasonBlock }));
vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: async () => ({ data: { user }, error: null }),
  createClient: async () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.rpcCalls.push(name);
      if (name === "independent_programs_ready") return state.readinessError
        ? { data: null, error: state.readinessError }
        : state.modular ? { data: state.readinessValue, error: null }
          : { data: null, error: { code: "PGRST202", message: "Could not find independent_programs_ready" } };
      if (name === "training_schedule_snapshot") {
        return state.modular ? { data: { revision: state.revision, entries: [] }, error: null }
          : { data: null, error: { code: "PGRST202", message: "training_schedule_snapshot not found" } };
      }
      if (name === "independent_program_schedule_commit") {
        state.lastCommit = args;
        return { data: { block_id: "00000000-0000-4000-8000-000000000003",
          program_instance_id: "00000000-0000-4000-8000-000000000004", skipped: 0 }, error: null };
      }
      if (name === "deploy_program_instance_atomically") {
        return { data: null, error: { code: "PGRST202", message: "Function not found" } };
      }
      if (name === "atomic_user_workflows_ready") {
        return { data: null, error: { code: "PGRST202", message: "Function not found" } };
      }
      return { data: null, error: null };
    },
    from: queryFor,
  }),
}));
vi.mock("../context", () => ({
  buildPlatformContext: async () => ({
    ctx: { oneRepMaxes: {} },
    resolveMovement: () => undefined,
  }),
  validateCustomMovementBindings: () => [],
}));
vi.mock("../program-instance", () => ({ buildProgramInstanceWrite }));
vi.mock("../registry", () => ({
  isNativeProgram: (programId: string) => programId === "native-test",
  getProgramEngine: () => ({
    meta: { family: "test-family", name: "Test foreign program" },
    setup: () => ({}),
  }),
  getNativeProgramEngine: () => ({
    meta: { family: "test-family", name: "Test native program" },
    setup: () => ({
      archetypeId: "strength_anchor",
      daysPerWeek: 1,
      dayIndexOverrides: {},
    }),
    materializeNative: async () => ({
      ok: true,
      rows: [
        {
          week_index: 0,
          day_index: 0,
          slot: "single",
          title: "Test session",
          role: "strength",
          prescription: { items: [] },
          session_modality: "strength",
          effective_stress_load: 1,
        },
      ],
      mainMovementIds: [],
    }),
  }),
}));
vi.mock("@/lib/programs/hybrid/engine", () => ({
  resolveHybridTmPercent: () => 85,
}));

import { createProgramInstance, previewProgramInstance } from "../actions";

describe("createProgramInstance app-first rollout", () => {
  beforeEach(() => {
    state.legacyError = null;
    state.rpcCalls.length = 0;
    state.writes.length = 0;
    state.modular = false;
    state.readinessValue = true;
    state.readinessError = null;
    state.revision = "a".repeat(32);
    state.active = null;
    state.receipt = null;
    state.lastCommit = null;
    state.recommendation = null;
    state.recommendationBlock = null;
    state.recommendationInstance = null;
    activateSeasonBlock.mockReset();
    revalidatePath.mockReset();
    buildProgramInstanceWrite.mockReset();
    buildProgramInstanceWrite.mockReturnValue({
      weeks: 4,
      daysPerWeek: 3,
      dayIndexOverrides: {},
      sessions: [
        {
          weekIndex: 0,
          dayIndex: 0,
          slot: "single",
          title: "Test session",
          role: "strength",
          prescription: { items: [] },
          sessionModality: "strength",
          effectiveStressLoad: 1,
        },
      ],
      tmPercents: [],
      skipped: [],
    });
  });

  it("DC-R5 refuses foreign setup before independent ownership is installed", async () => {
    await expect(
      createProgramInstance({
        programId: "tactical-barbell",
        setupValues: {},
        weekdays: [0, 2, 4],
        startedOn: "2026-09-01",
        seasonBlockId,
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(state.rpcCalls).toEqual(["independent_programs_ready"]);
    expect(state.writes).toEqual([]);
    expect(activateSeasonBlock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-R5 refuses foreign setup on a capability permission failure without legacy writes", async () => {
    state.readinessError = { code: "42501", message: "Permission denied" };

    await expect(
      createProgramInstance({
        programId: "tactical-barbell",
        setupValues: {},
        weekdays: [0, 2, 4],
        startedOn: "2026-09-01",
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(state.rpcCalls).toEqual(["independent_programs_ready"]);
    expect(state.writes).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-R5 refuses native setup before independent ownership is installed", async () => {
    await expect(
      createProgramInstance({
        programId: "native-test",
        setupValues: {},
        weekdays: [0],
        startedOn: "2026-09-01",
        seasonBlockId,
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(state.rpcCalls).toEqual(["independent_programs_ready"]);
    expect(state.writes).toEqual([]);
    expect(activateSeasonBlock).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-R5 refuses native setup on an invalid ownership capability", async () => {
    state.modular = true; state.readinessValue = false;

    await expect(
      createProgramInstance({
        programId: "native-test",
        setupValues: {},
        weekdays: [0],
        startedOn: "2026-09-01",
      }),
    ).resolves.toMatchObject({ ok: false, error: expect.any(String) });
    expect(state.rpcCalls).toEqual(["independent_programs_ready"]);
    expect(state.writes).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-K4 previews the actual template without writes and saves draft maxes through one reviewed transaction", async () => {
    state.modular = true;
    const input = { programId: "tactical-barbell", setupValues: {}, weekdays: [0, 2, 4], startedOn: "2026-09-07",
      trainingMaxDrafts: [{ movementId: "00000000-0000-4000-8000-000000000005", oneRmKg: 120 }] };
    const preview = await previewProgramInstance(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    expect(state.rpcCalls).toEqual(["independent_programs_ready", "training_schedule_snapshot"]);
    expect(preview.preview.dates).toEqual([{ date: "2026-09-07", title: "Test session" }]);
    const review = { revision: preview.preview.revision, previewId: preview.preview.id,
      requestId: "00000000-0000-4000-8000-000000000006", acceptOverlap: false };
    const saved = await createProgramInstance({ ...input, review });
    expect(saved.ok).toBe(true);
    expect(state.rpcCalls).toEqual(["independent_programs_ready", "training_schedule_snapshot",
      "independent_programs_ready", "training_schedule_snapshot", "independent_program_schedule_commit"]);
    expect(state.lastCommit).toMatchObject({ p_operation: "primary-create", p_expected_revision: "a".repeat(32),
      p_request_id: review.requestId, p_accept_overlap: false, p_args: { p_training_max_drafts: input.trainingMaxDrafts } });
    state.receipt = { context: { kind: "training-schedule-v1", operation: "primary-create",
      inputHash: state.lastCommit!.p_input_hash,
      result: { block_id: "00000000-0000-4000-8000-000000000003",
        program_instance_id: "00000000-0000-4000-8000-000000000004", skipped: 0 } } };
    state.revision = "b".repeat(32);
    expect(await createProgramInstance({ ...input, review })).toEqual(saved);
    expect(state.rpcCalls.filter((name) => name === "independent_program_schedule_commit")).toHaveLength(1);
  });

  it("DC-K4 rejects stale template dates and requires explicit primary replacement", async () => {
    state.modular = true;
    state.active = { id: "00000000-0000-4000-8000-000000000007", notes: "Existing program",
      started_on: "2026-09-01", program_id: "tactical-barbell", program_kind: "strength" };
    const input = { programId: "tactical-barbell", setupValues: {}, weekdays: [0, 2, 4], startedOn: "2026-09-07" };
    const result = await previewProgramInstance(input);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.replaces).toEqual({ id: state.active.id, name: state.active.notes });
    const review = { revision: result.preview.revision, previewId: result.preview.id,
      requestId: "00000000-0000-4000-8000-000000000008", acceptOverlap: false };
    expect(await createProgramInstance({ ...input, review })).toMatchObject({ ok: false });
    expect(state.lastCommit).toBeNull();
    state.revision = "b".repeat(32);
    expect(await createProgramInstance({ ...input, review: { ...review, replaceBlockId: state.active.id } })).toMatchObject({ ok: false });
    expect(state.lastCommit).toBeNull();
  });

  it.each(["running", "hybrid"] as const)("DC-R5 creates Strength without replacing an existing %s program", async (kind) => {
    state.modular = true;
    state.active = { id: "00000000-0000-4000-8000-000000000007", notes: "Another program",
      started_on: "2026-09-01", program_id: "authored", program_kind: kind };
    const input = { programId: "tactical-barbell", setupValues: {}, weekdays: [0, 2, 4], startedOn: "2026-09-07" };
    const result = await previewProgramInstance(input);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.replaces).toBeNull();
    expect(await createProgramInstance({ ...input, review: {
      previewId: result.preview.id, revision: result.preview.revision,
      requestId: "00000000-0000-4000-8000-000000000009", acceptOverlap: false,
    } })).toMatchObject({ ok: true });
    expect(state.lastCommit).toMatchObject({ p_operation: "primary-create", p_args: { p_block: { program_kind: "strength" } } });
    expect(state.lastCommit!.p_args).not.toHaveProperty("p_replace_block_id");
    expect(state.writes).toEqual([]);
    expect(state.rpcCalls).not.toContain("deploy_program_instance_atomically");
  });

  it("DC-R5 requires explicit ending of a legacy active program without classifying or archiving it", async () => {
    state.modular = true;
    state.active = { id: "00000000-0000-4000-8000-000000000007", notes: "Older program",
      started_on: "2026-09-01", program_id: "tactical-barbell", program_kind: null };
    expect(await previewProgramInstance({ programId: "tactical-barbell", setupValues: {},
      weekdays: [0, 2, 4], startedOn: "2026-09-07" })).toMatchObject({ ok: false });
    expect(state.lastCommit).toBeNull();
    expect(state.writes).toEqual([]);
  });

  it("DC-K4 reviews and saves the leading recovery week in the same program graph", async () => {
    state.modular = true;
    buildProgramInstanceWrite.mockReturnValue({
      weeks: 4, daysPerWeek: 3, dayIndexOverrides: {}, tmPercents: [{
        movementId: "00000000-0000-4000-8000-000000000005", tmPercent: 100,
        programLoadBasis: { version: 1, kind: "one-rm", percent: 100, roundingKg: null },
      }], skipped: [],
      sessions: [{ weekIndex: 0, dayIndex: 0, slot: "single", title: "Strength", role: "strength",
        sessionModality: "pure_strength", effectiveStressLoad: 3,
        prescription: { items: [{ movementId: "00000000-0000-4000-8000-000000000005",
          kind: "main", sets: 3, reps: 5, percentTm: 70 }] } }],
    });
    const input = { programId: "tactical-barbell", setupValues: {}, weekdays: [0, 2, 4],
      startedOn: "2026-09-07", startWithRecoveryWeek: true };
    const result = await previewProgramInstance(input);
    if (!result.ok) throw new Error(result.error);
    expect(result.preview.dates.map((row) => row.date)).toEqual(["2026-09-07", "2026-09-14"]);
    expect(state.lastCommit).toBeNull();
    expect(await createProgramInstance({ ...input, review: {
      previewId: result.preview.id, revision: result.preview.revision,
      requestId: "00000000-0000-4000-8000-000000000009", acceptOverlap: false,
    } })).toMatchObject({ ok: true });
    expect(state.lastCommit).toMatchObject({ p_args: {
      p_block: { weeks: 5 }, p_accept_recovery: true,
      p_planned_sessions: [
        { week_index: 0, role: "deload", prescription: { insertedRecoveryWeek: true } },
        { week_index: 1, role: "strength" },
      ],
    } });
    expect(state.rpcCalls).not.toContain("insert_deload_week");
  });

  function continuation() {
    state.modular = true;
    state.recommendationBlock = {
      id: "00000000-0000-4000-8000-000000000010", status: "completed", program_kind: "strength", deleted_at: null,
    };
    state.recommendationInstance = {
      id: "00000000-0000-4000-8000-000000000011", block_id: state.recommendationBlock.id,
      status: "archived", program_id: "tactical-barbell", deleted_at: null,
    };
    state.recommendation = {
      id: "00000000-0000-4000-8000-000000000012", block_id: state.recommendationBlock.id,
      program_instance_id: state.recommendationInstance.id, status: "pending", kind: "next-block",
      occurrence_key: "final", detail: "Review the next phase.",
      data: { programId: "tactical-barbell", nextPhaseId: "synthetic-next-phase" },
    };
    return { programId: "tactical-barbell", setupValues: { phaseId: "synthetic-next-phase" },
      weekdays: [0, 2, 4], startedOn: "2026-09-07", sourceRecommendationId: String(state.recommendation.id) };
  }

  it("DC-R5 keeps abandoned or failed continuation advice pending and commits its exact origin with setup", async () => {
    const input = continuation();
    const preview = await previewProgramInstance(input);
    if (!preview.ok) throw new Error(preview.error);
    expect(state.recommendation?.status).toBe("pending");
    expect(state.lastCommit).toBeNull();
    expect(state.writes).toEqual([]);
    const review = { previewId: preview.preview.id, revision: preview.preview.revision,
      requestId: "00000000-0000-4000-8000-000000000013", acceptOverlap: false };
    state.recommendation!.occurrence_key = "changed";
    expect(await createProgramInstance({ ...input, review })).toMatchObject({ ok: false });
    expect(state.lastCommit).toBeNull();
    expect(state.recommendation?.status).toBe("pending");
    state.recommendation!.occurrence_key = "final";
    const saved = await createProgramInstance({ ...input, review });
    expect(saved.ok).toBe(true);
    expect(state.lastCommit).toMatchObject({ p_args: { p_recommendation: {
      id: input.sourceRecommendationId, block_id: state.recommendationBlock!.id,
      program_instance_id: state.recommendationInstance!.id, kind: "next-block", occurrence_key: "final",
      program_kind: "strength", data: state.recommendation!.data,
    }, p_program_instance: { setup_input: { values: input.setupValues } } } });
    state.receipt = { context: { kind: "training-schedule-v1", operation: "primary-create",
      inputHash: state.lastCommit!.p_input_hash, result: {
        block_id: "00000000-0000-4000-8000-000000000003", program_instance_id: "00000000-0000-4000-8000-000000000004", skipped: 0,
      } } };
    state.recommendation!.status = "accepted";
    expect(await createProgramInstance({ ...input, review })).toEqual(saved);
    expect(state.rpcCalls.filter((name) => name === "independent_program_schedule_commit")).toHaveLength(1);
    expect(state.writes).toEqual([]);
  });

  it("DC-R5 refuses dismissed advice or another program/phase without saving or consuming it", async () => {
    const input = continuation();
    expect(await previewProgramInstance({ ...input, programId: "wendler-531" })).toMatchObject({ ok: false });
    expect(await previewProgramInstance({ ...input, setupValues: { phaseId: "another-phase" } })).toMatchObject({ ok: false });
    expect(await previewProgramInstance({ ...input, editBlockId: String(state.recommendationBlock!.id) })).toMatchObject({ ok: false });
    state.recommendation!.status = "dismissed";
    expect(await previewProgramInstance(input)).toMatchObject({ ok: false });
    expect(state.lastCommit).toBeNull();
    expect(state.writes).toEqual([]);
  });
});
