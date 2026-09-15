import { beforeEach, describe, expect, it, vi } from "vitest";

const { activateSeasonBlock, buildProgramInstanceWrite, buildContext, revalidatePath, state, conditioning } = vi.hoisted(() => ({
  activateSeasonBlock: vi.fn(),
  buildProgramInstanceWrite: vi.fn(),
  buildContext: vi.fn(),
  revalidatePath: vi.fn(),
  conditioning: {
    available: vi.fn(), replay: vi.fn(), prepare: vi.fn(), deploy: vi.fn(),
  },
  state: {
    legacyError: null as { message: string } | null,
    rpcCalls: [] as string[],
    maxWrites: [] as string[],
  },
}));

const user = { id: "00000000-0000-4000-8000-000000000001" };
const seasonBlockId = "00000000-0000-4000-8000-000000000002";

function queryFor(table: string) {
  let operation = "read";
  const result = () => {
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
      if (table === "training_maxes") state.maxWrites.push("insert");
      operation = "insert";
      return query;
    },
    update: () => {
      if (table === "training_maxes") state.maxWrites.push("update");
      operation = "update";
      return query;
    },
    delete: () => {
      operation = "delete";
      return query;
    },
    select: () => query,
    eq: () => query,
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
    rpc: async (name: string) => {
      state.rpcCalls.push(name);
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
  buildPlatformContext: buildContext,
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
vi.mock("@/lib/swim/program-conditioning", async (original) => ({
  ...await original<typeof import("@/lib/swim/program-conditioning")>(),
  programConditioningAvailable: conditioning.available,
  readConditioningSave: conditioning.replay,
  prepareConditioningSwim: conditioning.prepare,
  deployProgramWithSwimming: conditioning.deploy,
}));

import { createProgramInstance } from "../actions";

describe("createProgramInstance app-first rollout", () => {
  beforeEach(() => {
    state.legacyError = null;
    state.rpcCalls.length = 0;
    state.maxWrites.length = 0;
    buildContext.mockReset().mockResolvedValue({ ctx: { oneRepMaxes: {} }, resolveMovement: () => undefined });
    activateSeasonBlock.mockReset();
    revalidatePath.mockReset();
    buildProgramInstanceWrite.mockReset();
    conditioning.available.mockReset().mockResolvedValue(true);
    conditioning.replay.mockReset().mockResolvedValue(null);
    conditioning.prepare.mockReset().mockResolvedValue({
      plan_id: "00000000-0000-4000-8000-000000000006", expected_revision: 1,
    });
    conditioning.deploy.mockReset();
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

  const coupledInput = {
    programId: "tactical-barbell", setupValues: {}, weekdays: [0, 2, 4], startedOn: "2026-09-14",
    conditioning: {
      requestId: "00000000-0000-4000-8000-000000000005",
      choices: [{ weekday: 2, activity: "swimming" }],
      swim: { kind: "existing", planId: "00000000-0000-4000-8000-000000000006", revision: 1 },
    },
  } satisfies Parameters<typeof createProgramInstance>[0];

  it("DC-SW8 recovers the original save before recomputation even after new creation is disabled", async () => {
    conditioning.available.mockResolvedValue(false);
    conditioning.replay.mockResolvedValue({
      block_id: "00000000-0000-4000-8000-000000000007",
      program_instance_id: "00000000-0000-4000-8000-000000000008",
      swim_plan_id: coupledInput.conditioning.swim.planId, skipped: 2,
    });
    const result = await createProgramInstance(coupledInput);
    expect(result).toMatchObject({ ok: true, skipped: 2 });
    expect(conditioning.available).not.toHaveBeenCalled();
    expect(buildProgramInstanceWrite).not.toHaveBeenCalled();
    expect(conditioning.prepare).not.toHaveBeenCalled();
    expect(conditioning.deploy).not.toHaveBeenCalled();
    expect(state.rpcCalls).toEqual([]);
  });

  it("DC-SW8 refuses new coupled saves while unavailable without invoking primary deployment", async () => {
    conditioning.available.mockResolvedValue(false);
    expect((await createProgramInstance(coupledInput)).ok).toBe(false);
    expect(buildProgramInstanceWrite).not.toHaveBeenCalled();
    expect(state.rpcCalls).toEqual([]);
  });

  it("DC-SW8 never falls back to primary-only persistence after a coupled save fails", async () => {
    const materialized = buildProgramInstanceWrite.getMockImplementation()!();
    materialized.sessions[0] = {
      ...materialized.sessions[0], dayIndex: 2, role: "cardio",
      prescription: { items: [{ movementId: "", kind: "cardio_external" }] },
    };
    buildProgramInstanceWrite.mockReturnValue(materialized);
    conditioning.deploy.mockRejectedValue(new Error("Coupled save unavailable"));
    expect((await createProgramInstance(coupledInput)).ok).toBe(false);
    expect(conditioning.prepare).toHaveBeenCalledOnce();
    expect(conditioning.deploy).toHaveBeenCalledOnce();
    expect(state.rpcCalls).toEqual([]);
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-SW8 prepares benchmark edits read-only and includes them in the same replayable save", async () => {
    const materialized = buildProgramInstanceWrite.getMockImplementation()!();
    materialized.sessions[0] = {
      ...materialized.sessions[0], dayIndex: 2, role: "cardio",
      prescription: { items: [{ movementId: "", kind: "cardio_external" }] },
    };
    buildProgramInstanceWrite.mockReturnValue(materialized);
    const benchmarks = [{ movementId: "00000000-0000-4000-8000-000000000010", oneRmKg: 120 }];
    const input = { ...coupledInput, conditioning: { ...coupledInput.conditioning, benchmarks } };
    conditioning.deploy.mockRejectedValue(new Error("Synthetic late failure"));
    expect((await createProgramInstance(input)).ok).toBe(false);
    expect(buildContext.mock.calls[0]?.[2]).toMatchObject({ benchmarkEdits: benchmarks });
    expect(conditioning.replay.mock.calls[0]?.[2]).toEqual(input);
    expect(conditioning.deploy.mock.calls[0]?.[2]).toEqual(input);
    expect(state.maxWrites).toEqual([]);
    expect(state.rpcCalls).toEqual([]);

    conditioning.replay.mockResolvedValue({
      block_id: "00000000-0000-4000-8000-000000000007",
      program_instance_id: "00000000-0000-4000-8000-000000000008",
      swim_plan_id: coupledInput.conditioning.swim.planId, skipped: 0,
    });
    buildContext.mockClear();
    expect((await createProgramInstance(input)).ok).toBe(true);
    expect(buildContext).not.toHaveBeenCalled();
    expect(state.maxWrites).toEqual([]);
    expect(revalidatePath).toHaveBeenCalledWith("/app/settings/training-maxes");
  });
});
