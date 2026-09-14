import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  completeSwimWorkout, createSwimPlan, editSwimResult, setSwimPlanStatus,
  skipSwimWorkout, startSwimWorkout, updateSwimPlan,
  resumeSwimPlan,
  type CompleteSwimWorkoutInput, type CreateSwimPlanInput, type UpdateSwimPlanInput,
} from "../storage";

afterEach(() => vi.unstubAllEnvs());

function fakeClient(data: unknown = { id: "row" }, error: unknown = null) {
  const rpc = vi.fn().mockResolvedValue({ data, error });
  return { db: { rpc } as unknown as SupabaseClient, rpc };
}

const completion = {
  workoutId: "workout", expectedRevision: 2, result: { lengths: 24, timeMs: 600_005 },
  clientLogId: "client", completionEntryId: "receipt",
} as unknown as CompleteSwimWorkoutInput;

describe("ADR0079 swimming persistence wrappers", () => {
  it("requires installed storage and setup rollout before creating any rows", async () => {
    vi.stubEnv("POOL_SWIMMING_ENABLED", "false");
    const { db, rpc } = fakeClient(true);
    await expect(createSwimPlan(db, {} as CreateSwimPlanInput)).rejects.toThrow();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("swim_storage_ready");
  });

  it("creates the plan and prescriptions through one RPC", async () => {
    vi.stubEnv("POOL_SWIMMING_ENABLED", "true");
    const { db, rpc } = fakeClient();
    rpc.mockResolvedValueOnce({ data: true, error: null });
    const input = { startedOn: "2026-09-05", endsOn: "2026-10-05", definition: {}, state: {}, workouts: [] } as unknown as CreateSwimPlanInput;
    await createSwimPlan(db, input);
    expect(rpc).toHaveBeenLastCalledWith("swim_create_plan", {
      p_started_on: input.startedOn, p_ends_on: input.endsOn,
      p_definition: input.definition, p_state: input.state, p_workouts: input.workouts,
    });
  });

  it("uses the same receipt and native result without manufacturing summary columns", async () => {
    vi.stubEnv("POOL_SWIMMING_ENABLED", "false");
    const { db, rpc } = fakeClient({ transitioned: false });
    expect(await completeSwimWorkout(db, completion)).toEqual({ transitioned: false });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("swim_complete_workout", {
      p_workout_id: "workout", p_expected_revision: 2, p_result: completion.result,
      p_client_log_id: "client", p_completion_entry_id: "receipt",
      p_notes: null, p_allow_changed_course: false,
    });
  });

  it("makes a changed course explicit rather than silently changing historical targets", async () => {
    const { db, rpc } = fakeClient();
    await editSwimResult(db, { ...completion, allowChangedCourse: true, notes: "Changed pool" });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("swim_edit_result", {
      p_workout_id: "workout", p_expected_revision: 2, p_result: completion.result,
      p_notes: "Changed pool", p_allow_changed_course: true, p_notes_supplied: true,
    });
  });

  it("sends optimistic revisions for start, skip, lifecycle and prescription updates", async () => {
    const { db, rpc } = fakeClient();
    await startSwimWorkout(db, "workout", 3);
    await skipSwimWorkout(db, "workout", 3);
    await setSwimPlanStatus(db, "plan", 4, "paused");
    await updateSwimPlan(db, {
      planId: "plan", expectedRevision: 4, definition: {}, state: {}, workouts: [],
    } as unknown as UpdateSwimPlanInput);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "swim_start_workout", "swim_skip_workout", "swim_set_plan_status", "swim_update_plan",
    ]);
    expect(rpc.mock.calls.every(([, args]) => args.p_expected_revision > 0)).toBe(true);
  });

  it("resumes dates in one transaction and keeps the supplied skip reason", async () => {
    const { db, rpc } = fakeClient();
    await skipSwimWorkout(db, "workout", 2, "Pool closed");
    expect(rpc).toHaveBeenLastCalledWith("swim_skip_workout", {
      p_workout_id: "workout", p_expected_revision: 2, p_reason: "Pool closed",
    });
    await resumeSwimPlan(db, {
      planId: "plan", expectedRevision: 3, definition: {}, state: {}, workouts: [],
    } as unknown as UpdateSwimPlanInput);
    expect(rpc).toHaveBeenLastCalledWith("swim_resume_plan", {
      p_plan_id: "plan", p_expected_revision: 3, p_definition: {}, p_state: {}, p_workouts: [],
    });
  });

  it.each(["PGRST202", "42501", "40001", "40P01", "23505", "XX000"])("propagates RPC failure %s without retries or detached writes", async (code) => {
    const { db, rpc } = fakeClient(null, { code, message: "Rejected" });
    await expect(completeSwimWorkout(db, completion)).rejects.toThrow("Rejected");
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("fails loud when completion returns no durable result", async () => {
    await expect(completeSwimWorkout(fakeClient(null).db, completion)).rejects.toThrow();
  });

  it.each([
    { notes: undefined, supplied: false },
    { notes: null, supplied: true },
    { notes: "Updated notes", supplied: true },
  ])("distinguishes omitted notes from explicit edit/clear: $notes", async ({ notes, supplied }) => {
    const { db, rpc } = fakeClient();
    await editSwimResult(db, { ...completion, notes });
    expect(rpc).toHaveBeenCalledWith("swim_edit_result", expect.objectContaining({
      p_notes: notes ?? null, p_notes_supplied: supplied,
    }));
  });
});
