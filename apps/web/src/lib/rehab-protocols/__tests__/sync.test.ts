/**
 * Syncing a Settings edit into a live program.
 *
 * The edit path REPLACES a program's rehab bindings with exactly what it is
 * sent. Sync used to send nothing, so the first edit deleted every binding and
 * no later edit ever reached the plan — a failure with no error and no visible
 * symptom until a lifter noticed their rehab had stopped changing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const createProgramInstance = vi.fn();
const getBlockEditContext = vi.fn();
const loadRehabBindingsFor = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/platform/actions", () => ({ createProgramInstance }));
vi.mock("@/lib/platform/edit-context", () => ({ getBlockEditContext }));
vi.mock("../queries", () => ({
  loadRehabBindingsFor,
  isMissingTable: () => false,
}));

const LIB_ID = "dddddddd-1111-4111-8111-dddddddddddd";
const BLOCK_ID = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
const INSTANCE_ID = "ffffffff-1111-4111-8111-ffffffffffff";

const item = (movementName: string) => ({
  movementId: "11111111-1111-1111-1111-111111111111",
  movementName,
  sets: 3,
  reps: 12,
});

/**
 * Enough of the query builder for `updateRehabProtocol`: a read of the current
 * revision, the compare-and-set write, then the binding fan-out.
 */
function supabaseStub() {
  const rows: Record<string, unknown> = {
    "rehab_protocols.select": { revision: 1 },
    "rehab_protocols.update": { id: LIB_ID },
    "program_rehab_bindings.select": [
      {
        program_instance_id: INSTANCE_ID,
        program_instances: {
          id: INSTANCE_ID,
          block_id: BLOCK_ID,
          display_name: "Zulu",
          status: "active",
          deleted_at: null,
        },
      },
    ],
  };
  const builder = (table: string, op: string) => {
    const chain: Record<string, unknown> = {};
    for (const key of ["select", "update", "eq", "order"]) {
      chain[key] = (...args: unknown[]) =>
        key === "select" || key === "update"
          ? builder(table, key === "update" ? op : key)
          : (chain as never);
    }
    chain.maybeSingle = async () => ({
      data: rows[`${table}.${op}`] ?? null,
      error: null,
    });
    chain.then = (resolve: (value: unknown) => unknown) =>
      resolve({ data: rows[`${table}.${op}`] ?? null, error: null });
    return chain;
  };
  return {
    from: (table: string) => ({
      select: () => builder(table, "select"),
      update: () => builder(table, "update"),
    }),
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => supabaseStub(),
  getAuthUser: async () => ({ data: { user: { id: "user-1" } } }),
}));

const definition = {
  items: [item("Copenhagen Plank")],
  links: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  createProgramInstance.mockResolvedValue({ ok: true, programInstanceId: INSTANCE_ID });
  loadRehabBindingsFor.mockResolvedValue({
    bindingsByInstance: { [INSTANCE_ID]: { "protocol-1": LIB_ID } },
    library: [
      { id: LIB_ID, name: "Renamed", items: definition.items, links: [] },
    ],
  });
  getBlockEditContext.mockResolvedValue({
    blockId: BLOCK_ID,
    programId: "tactical-barbell",
    setupValues: { templateId: "zulu" },
    strengthWeekdays: [0, 1, 3, 4],
    cardioWeekdays: [],
    startedOn: "2026-01-05",
    accessoriesEnabled: false,
    currentWeekIndex: 0,
    programStartWeekIndex: 0,
    rehabSchedule: {
      version: 1,
      protocols: [
        { id: "protocol-1", name: "Original", items: definition.items },
      ],
      series: [{ key: "slot-1", protocolId: "protocol-1" }],
      days: [],
    },
  });
});

describe("syncing a protocol edit into a live program", () => {
  it("sends the program's bindings back so a later edit can still sync", async () => {
    const { updateRehabProtocol } = await import("../actions");
    const result = await updateRehabProtocol(LIB_ID, { name: "Renamed", definition });

    expect(result).toMatchObject({ ok: true });
    expect(createProgramInstance).toHaveBeenCalledTimes(1);
    expect(createProgramInstance.mock.calls[0]![0]).toMatchObject({
      editBlockId: BLOCK_ID,
      rehabBindings: [
        { localProtocolId: "protocol-1", rehabProtocolId: LIB_ID },
      ],
    });
  });

  it("syncs a block whose rehab lives in the envelope, with no customization", async () => {
    const { updateRehabProtocol } = await import("../actions");
    await updateRehabProtocol(LIB_ID, { name: "Renamed", definition });

    // The envelope is independent of the "Customize template" opt-in, so a
    // canonical block must not be skipped for having no customization.
    expect(createProgramInstance.mock.calls[0]![0]).toMatchObject({
      rehabSchedule: {
        protocols: [expect.objectContaining({ name: "Renamed" })],
        series: [{ key: "slot-1", protocolId: "protocol-1" }],
      },
    });
    expect(createProgramInstance.mock.calls[0]![0].customization).toBeUndefined();
  });

  it("leaves a program alone when the library already matches it", async () => {
    getBlockEditContext.mockResolvedValue({
      blockId: BLOCK_ID,
      programId: "tactical-barbell",
      setupValues: { templateId: "zulu" },
      strengthWeekdays: [0, 1, 3, 4],
      cardioWeekdays: [],
      startedOn: "2026-01-05",
      accessoriesEnabled: false,
      currentWeekIndex: 0,
      programStartWeekIndex: 0,
      rehabSchedule: {
        version: 1,
        protocols: [
          { id: "protocol-1", name: "Renamed", items: definition.items },
        ],
        series: [{ key: "slot-1", protocolId: "protocol-1" }],
        days: [],
      },
    });
    const { updateRehabProtocol } = await import("../actions");
    await updateRehabProtocol(LIB_ID, { name: "Renamed", definition });
    expect(createProgramInstance).not.toHaveBeenCalled();
  });
});
