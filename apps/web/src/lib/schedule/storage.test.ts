import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { commitTrainingSchedule, isMissingScheduleFunction, loadAvailableTrainingSchedule, loadTrainingSchedule, scheduleInputHash, scheduleRequestId, ScheduleUnavailableError } from "./storage";

const name = "training_schedule_snapshot";
function client(data: unknown, error: { code: string; message: string } | null = null) {
  const rpc = vi.fn(async (_routine: string, _parameters?: Record<string, unknown>) => ({ data, error }));
  return { rpc, db: { rpc } as unknown as SupabaseClient };
}

describe("DC-K4/DC-SW7 shared schedule readiness and review", () => {
  it.each(["PGRST202", "42883"])("treats only the missing new RPC as the app-first rollout gap (%s)", async (code) => {
    const { db } = client(null, { code, message: `Could not find public.${name}` });
    await expect(loadTrainingSchedule(db)).rejects.toBeInstanceOf(ScheduleUnavailableError);
    await expect(loadAvailableTrainingSchedule(db)).resolves.toBeNull();
  });
  it.each([
    { code: "42501", message: `${name}: permission denied` },
    { code: "08006", message: "Connection lost" },
    { code: "PGRST202", message: "Could not find unrelated_function" },
  ])("never presents a failed read as an empty calendar: $code", async (error) => {
    expect(isMissingScheduleFunction(error, name)).toBe(false);
    await expect(loadAvailableTrainingSchedule(client(null, error).db)).rejects.toThrow("Could not load");
  });
  it("distinguishes malformed data from a valid empty schedule", async () => {
    await expect(loadAvailableTrainingSchedule(client({}).db)).rejects.toThrow("could not be read");
    const snapshot = { revision: "a".repeat(32), entries: [] };
    await expect(loadAvailableTrainingSchedule(client(snapshot).db)).resolves.toEqual(snapshot);
  });
  it("passes the reviewed revision, replacement consent and semantic replay hash to one RPC", async () => {
    const { db, rpc } = client({ block_id: "saved" });
    const input = { dates: ["2026-09-23"] };
    const requestId = scheduleRequestId(input);
    expect(requestId).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(scheduleRequestId(input)).toBe(requestId);
    await commitTrainingSchedule(db, "primary-create", { p_block: {} }, {
      revision: "a".repeat(32), requestId, acceptOverlap: true, replaceBlockId: "old",
    }, input);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("independent_program_schedule_commit", {
      p_operation: "primary-create", p_args: { p_block: {}, p_replace_block_id: "old" },
      p_expected_revision: "a".repeat(32), p_request_id: requestId, p_input_hash: scheduleInputHash(input), p_accept_overlap: true,
    });
  });
  it("DC-R5 never falls back to the legacy archive-all creator", async () => {
    const { db, rpc } = client(null);
    rpc.mockImplementation(async (routine?: string) => ({
      data: null, error: { code: "PGRST202", message: `Could not find ${routine}` },
    }));
    await expect(commitTrainingSchedule(db, "primary-create", {}, {
      revision: "a".repeat(32), requestId: scheduleRequestId("create"), acceptOverlap: false,
    }, {})).rejects.toBeInstanceOf(ScheduleUnavailableError);
    expect(rpc.mock.calls.map(([routine]) => routine)).not.toContain("training_schedule_commit");
  });
  it("retains legacy scoped operations only when both ownership RPCs are absent", async () => {
    const { db, rpc } = client(null);
    rpc.mockImplementation(async (routine?: string) => routine === "training_schedule_commit" ? { data: { id: "old" }, error: null } : {
      data: null, error: { code: "PGRST202", message: `Could not find ${routine}` },
    });
    await expect(commitTrainingSchedule(db, "primary-end", { id: "old" }, {
      revision: "a".repeat(32), requestId: scheduleRequestId("end"), acceptOverlap: false,
    }, { id: "old" })).resolves.toMatchObject({ data: { id: "old" } });
  });
  it.each([
    { data: true, error: null },
    { data: false, error: null },
    { data: null, error: { code: "42501", message: "Permission denied" } },
  ])("refuses a legacy write when ownership readiness is not explicitly absent", async (capability) => {
    const { db, rpc } = client(null);
    rpc.mockImplementation(async (routine?: string) => routine === "independent_programs_ready" ? capability : {
      data: null, error: { code: "PGRST202", message: `Could not find ${routine}` },
    });
    await expect(commitTrainingSchedule(db, "primary-end", { id: "owned" }, {
      revision: "a".repeat(32), requestId: scheduleRequestId("end"), acceptOverlap: false,
    }, { id: "owned" })).rejects.toBeInstanceOf(ScheduleUnavailableError);
    expect(rpc.mock.calls.map(([routine]) => routine)).toEqual([
      "independent_program_schedule_commit", "independent_programs_ready",
    ]);
  });
});
