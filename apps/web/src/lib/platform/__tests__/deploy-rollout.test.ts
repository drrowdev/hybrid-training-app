import { beforeEach, describe, expect, it, vi } from "vitest";

const { activateSeasonBlock, buildProgramInstanceWrite, revalidatePath, state } = vi.hoisted(() => ({
  activateSeasonBlock: vi.fn(),
  buildProgramInstanceWrite: vi.fn(),
  revalidatePath: vi.fn(),
  state: {
    legacyError: null as { message: string } | null,
    rpcCalls: [] as string[],
    modular: false,
    revision: "a".repeat(32),
    active: null as { id: string; notes: string } | null,
    receipt: null as { context: Record<string, unknown> } | null,
    lastCommit: null as Record<string, unknown> | null,
  },
}));

const user = { id: "00000000-0000-4000-8000-000000000001" };
const seasonBlockId = "00000000-0000-4000-8000-000000000002";

function queryFor(table: string) {
  let operation = "read";
  const result = () => {
    if (operation === "read" && table === "training_blocks") return { data: state.active, error: null };
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
      operation = "insert";
      return query;
    },
    update: () => {
      operation = "update";
      return query;
    },
    delete: () => {
      operation = "delete";
      return query;
    },
    select: () => query,
    eq: () => query,
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
      if (name === "training_schedule_snapshot") {
        return state.modular ? { data: { revision: state.revision, entries: [] }, error: null }
          : { data: null, error: { code: "PGRST202", message: "training_schedule_snapshot not found" } };
      }
      if (name === "training_schedule_commit") {
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
          prescription: {},
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
    state.modular = false;
    state.revision = "a".repeat(32);
    state.active = null;
    state.receipt = null;
    state.lastCommit = null;
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
          prescription: {},
          sessionModality: "strength",
          effectiveStressLoad: 1,
        },
      ],
      tmPercents: [],
      skipped: [],
    });
  });

  it("continues the foreign deployment after a missing atomic RPC falls back successfully", async () => {
    await expect(
      createProgramInstance({
        programId: "tactical-barbell",
        setupValues: {},
        weekdays: [0, 2, 4],
        startedOn: "2026-09-01",
        seasonBlockId,
      }),
    ).resolves.toEqual({
      ok: true,
      blockId: "block-from-legacy",
      programInstanceId: "instance-from-legacy",
      skipped: 0,
    });

    expect(state.rpcCalls).toEqual([
      "training_schedule_snapshot",
      "deploy_program_instance_atomically",
      "atomic_user_workflows_ready",
    ]);
    expect(activateSeasonBlock).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      seasonBlockId,
      "block-from-legacy",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/app");
    expect(revalidatePath).toHaveBeenCalledWith("/app/plan");
    expect(revalidatePath).toHaveBeenCalledWith("/app/stats");
  });

  it("surfaces the foreign legacy deployment error instead of the missing-RPC error", async () => {
    state.legacyError = { message: "Legacy deployment failed" };

    await expect(
      createProgramInstance({
        programId: "tactical-barbell",
        setupValues: {},
        weekdays: [0, 2, 4],
        startedOn: "2026-09-01",
      }),
    ).resolves.toEqual({ ok: false, error: "Legacy deployment failed" });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("continues the native deployment after a missing atomic RPC falls back successfully", async () => {
    await expect(
      createProgramInstance({
        programId: "native-test",
        setupValues: {},
        weekdays: [0],
        startedOn: "2026-09-01",
        seasonBlockId,
      }),
    ).resolves.toEqual({
      ok: true,
      blockId: "block-from-legacy",
      programInstanceId: "instance-from-legacy",
      skipped: 0,
    });

    expect(state.rpcCalls).toEqual([
      "training_schedule_snapshot",
      "deploy_program_instance_atomically",
      "atomic_user_workflows_ready",
    ]);
    expect(activateSeasonBlock).toHaveBeenCalledWith(
      expect.anything(),
      user.id,
      seasonBlockId,
      "block-from-legacy",
    );
    expect(revalidatePath).toHaveBeenCalledWith("/app");
    expect(revalidatePath).toHaveBeenCalledWith("/app/plan");
    expect(revalidatePath).toHaveBeenCalledWith("/app/stats");
  });

  it("surfaces the native legacy deployment error instead of the missing-RPC error", async () => {
    state.legacyError = { message: "Legacy deployment failed" };

    await expect(
      createProgramInstance({
        programId: "native-test",
        setupValues: {},
        weekdays: [0],
        startedOn: "2026-09-01",
      }),
    ).resolves.toEqual({ ok: false, error: "Legacy deployment failed" });

    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-K4 previews the actual template without writes and saves draft maxes through one reviewed transaction", async () => {
    state.modular = true;
    const input = { programId: "tactical-barbell", setupValues: {}, weekdays: [0, 2, 4], startedOn: "2026-09-07",
      trainingMaxDrafts: [{ movementId: "00000000-0000-4000-8000-000000000005", oneRmKg: 120 }] };
    const preview = await previewProgramInstance(input);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error(preview.error);
    expect(state.rpcCalls).toEqual(["training_schedule_snapshot"]);
    expect(preview.preview.dates).toEqual([{ date: "2026-09-07", title: "Test session" }]);
    const review = { revision: preview.preview.revision, previewId: preview.preview.id,
      requestId: "00000000-0000-4000-8000-000000000006", acceptOverlap: false };
    const saved = await createProgramInstance({ ...input, review });
    expect(saved.ok).toBe(true);
    expect(state.rpcCalls).toEqual(["training_schedule_snapshot", "training_schedule_snapshot", "training_schedule_commit"]);
    expect(state.lastCommit).toMatchObject({ p_operation: "primary-create", p_expected_revision: "a".repeat(32),
      p_request_id: review.requestId, p_accept_overlap: false, p_args: { p_training_max_drafts: input.trainingMaxDrafts } });
    state.receipt = { context: { kind: "training-schedule-v1", operation: "primary-create",
      inputHash: state.lastCommit!.p_input_hash,
      result: { block_id: "00000000-0000-4000-8000-000000000003",
        program_instance_id: "00000000-0000-4000-8000-000000000004", skipped: 0 } } };
    state.revision = "b".repeat(32);
    expect(await createProgramInstance({ ...input, review })).toEqual(saved);
    expect(state.rpcCalls.filter((name) => name === "training_schedule_commit")).toHaveLength(1);
  });

  it("DC-K4 rejects stale template dates and requires explicit primary replacement", async () => {
    state.modular = true;
    state.active = { id: "00000000-0000-4000-8000-000000000007", notes: "Existing program" };
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

  it("DC-K4 reviews and saves the leading recovery week in the same program graph", async () => {
    state.modular = true;
    buildProgramInstanceWrite.mockReturnValue({
      weeks: 4, daysPerWeek: 3, dayIndexOverrides: {}, tmPercents: [], skipped: [],
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
});
