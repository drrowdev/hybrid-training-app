import { beforeEach, describe, expect, it, vi } from "vitest";

const { activateSeasonBlock, buildProgramInstanceWrite, revalidatePath, state } = vi.hoisted(() => ({
  activateSeasonBlock: vi.fn(),
  buildProgramInstanceWrite: vi.fn(),
  revalidatePath: vi.fn(),
  state: {
    legacyError: null as { message: string } | null,
    rpcCalls: [] as string[],
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

import { createProgramInstance } from "../actions";

describe("createProgramInstance app-first rollout", () => {
  beforeEach(() => {
    state.legacyError = null;
    state.rpcCalls.length = 0;
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
});
