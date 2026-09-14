import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { runInNewContext } from "node:vm";
import { SWIM_GENERATOR_VERSION } from "@hta/engine";
import { revalidatePath } from "next/cache";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import { startSwimWorkout, changeSwimPlanStatus, editSwimResult, completeSwimWorkoutResult, skipSwimWorkout, previewSwimResume, resumeSwimPlan, proposeSwimWeek, decideSwimProposal, proposeSwimBenchmark, decideSwimBenchmark } from "../actions";
import * as storage from "../storage";
import * as queries from "../queries";
import { assertSwimSafety } from "../safety";
import { requireSwimStorage } from "../capability";
import { SWIM_REFRESH_WARNING } from "../action-feedback";
import { SWIM_SCHEDULE_VERSION } from "../model";
import type { SwimHubView, SwimWorkoutView } from "../view-types";
import { workoutPresentation } from "../presentation";
import { swimFixture, userId, planId, sessionId, receiptId } from "./fixtures";

const mock = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  client: { from: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mock.client,
  getAuthUser: async () => ({ data: { user: mock.user } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../capability", () => ({ requireSwimStorage: vi.fn() }));
vi.mock("../safety", async (importOriginal) => ({
  ...await importOriginal<typeof import("../safety")>(), assertSwimSafety: vi.fn(),
}));
vi.mock("@/lib/sessions/post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: vi.fn(),
}));
vi.mock("../storage", () => ({
  getSwimWorkout: vi.fn(), listSwimPlans: vi.fn(), listSwimWorkouts: vi.fn(),
  startSwimWorkout: vi.fn(), setSwimPlanStatus: vi.fn(), editSwimResult: vi.fn(),
  getSwimResult: vi.fn(), completeSwimWorkout: vi.fn(), skipSwimWorkout: vi.fn(),
  resumeSwimPlan: vi.fn(), updateSwimPlan: vi.fn(),
}));

const loadSwimHubView = queries.loadSwimHubView;
const swimWorkoutViewFromRow = queries.swimWorkoutViewFromRow;
const returnedWorkout: storage.SwimWorkoutRow = {
  ...swimFixture().workouts[0]!, revision: 2, status: "started", session_id: sessionId,
};
const confirmedWorkoutView: SwimWorkoutView = {
  ...workoutPresentation(returnedWorkout.definition.issued),
  id: returnedWorkout.id, revision: returnedWorkout.revision, status: "started", sessionId,
  planStatus: "active", date: returnedWorkout.scheduled_date,
  provisional: false, deleted: false, sourceGone: false, result: null,
};
const returnedEditedWorkout: storage.SwimWorkoutRow = {
  ...swimFixture().history[0]!.workout, revision: 4, updated_at: "2026-09-08T12:00:00Z",
};
const confirmedEditedView: SwimWorkoutView = {
  ...confirmedWorkoutView, revision: returnedEditedWorkout.revision, status: "completed",
  notes: "Edited swim",
  result: {
    lengths: 14, timeMs: 840456, rpe: 7, notes: "Edited swim", splits: "",
    stroke: "backstroke", strokes: ["backstroke"], equipment: ["fins"],
    course: "25 yd", distance: "350 yd", pool: returnedEditedWorkout.definition.issued.snapshot.course,
  },
};
const confirmedView: SwimHubView = {
  id: planId, revision: 7, status: "paused", goal: "Technique & base",
  course: "25 yd", dates: "2026-09-07 – 2026-09-27", today: "2026-09-08",
  workouts: [], proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
};

function actualForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    workoutId: swimFixture().workouts[0]!.id, sessionId, clientLogId: receiptId,
    expectedRevision: "1", lengths: "12", timeMs: "900123", rpe: "6",
    notes: "Easy", stroke: "freestyle", equipment: "[]",
  })) form.set(key, value);
  return form;
}

function editForm() {
  const form = actualForm();
  for (const [key, value] of Object.entries({
    expectedRevision: "3", lengths: "14", timeMs: "840456", rpe: "7",
    stroke: "backstroke", equipment: '["fins"]', notes: "Edited swim",
  })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  vi.spyOn(queries, "loadSwimHubView").mockResolvedValue(confirmedView);
  vi.spyOn(queries, "swimWorkoutViewFromRow").mockImplementation(async (_client, _userId, row) =>
    row === returnedEditedWorkout ? confirmedEditedView : confirmedWorkoutView);
  mock.user = { id: userId };
  const { plan, workouts, history } = swimFixture();
  const workout = { ...workouts[0]!, session_id: sessionId, status: "started" as const };
  const query = { select: vi.fn(), in: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn() };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { timezone: "UTC" }, error: null });
  query.in.mockResolvedValue({ data: [{ id: receiptId, slug: "swim-easy" }], error: null });
  mock.client.from.mockReturnValue(query);
  vi.mocked(storage.getSwimWorkout).mockResolvedValue(workout);
  vi.mocked(storage.listSwimPlans).mockResolvedValue([plan]);
  vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts);
  vi.mocked(storage.getSwimResult).mockResolvedValue(history[0]!.result!);
  vi.mocked(storage.startSwimWorkout).mockResolvedValue(returnedWorkout);
  vi.mocked(storage.setSwimPlanStatus).mockResolvedValue({ ...plan, revision: 7, status: "paused" });
  const reply = { workout, session_id: sessionId, cardio_log_id: receiptId, transitioned: false };
  vi.mocked(storage.editSwimResult).mockResolvedValue({ ...reply, workout: returnedEditedWorkout });
  vi.mocked(storage.completeSwimWorkout).mockResolvedValue(reply);
  vi.mocked(recomputeAfterCompletedSessionMutation).mockResolvedValue({ recomputed: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const actions = [
  { name: "Start", call: () => startSwimWorkout(swimFixture().workouts[0]!.id, 1), mutation: storage.startSwimWorkout },
  { name: "Plan status", call: () => changeSwimPlanStatus(planId, 1, "paused"), mutation: storage.setSwimPlanStatus },
  { name: "Edit", call: () => editSwimResult(editForm()), mutation: storage.editSwimResult },
];

describe.each(actions)("$name post-save refresh boundary", ({ name, call, mutation }) => {
  it("returns confirmed success and a nonempty warning when cache refresh throws, without retrying", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    const result = await call();
    expect(result).toEqual({ ok: true, warning: SWIM_REFRESH_WARNING, view: name === "Plan status" ? confirmedView : name === "Start" ? confirmedWorkoutView : confirmedEditedView });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledOnce();
    expect(vi.mocked(mutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    if (name === "Edit") {
      expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
      expect(vi.mocked(recomputeAfterCompletedSessionMutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    }
  });

  it("returns success without a warning after normal refresh", async () => {
    expect(await call()).toEqual({ ok: true, view: name === "Plan status" ? confirmedView : name === "Start" ? confirmedWorkoutView : confirmedEditedView });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/app/swim/[workoutId]", "page");
    if (name === "Edit") expect(revalidatePath).toHaveBeenCalledWith(`/app/sessions/${sessionId}`);
  });

  it.each([
    [undefined, "transient"], ["42501", "forbidden"], ["40001", "validation"],
    ["P0001", "validation"], ["23505", "validation"], ["23514", "validation"],
  ])("preserves RPC/reply rejection classification (%s), without refresh or retry", async (code, errorCode) => {
    vi.mocked(mutation).mockRejectedValueOnce(new Error("RPC reply unavailable", { cause: { code } }));
    expect(await call()).toEqual({
      error: code === "42501" ? "You cannot change this swim." : "RPC reply unavailable", errorCode,
    });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
  });

  it("preserves auth failure without mutation or warning", async () => {
    mock.user = null;
    expect(await call()).toEqual({ error: "Sign in to save your swim.", errorCode: "auth" });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
  });

  it("preserves ownership failure without mutation or warning", async () => {
    const { plan, workouts } = swimFixture();
    vi.mocked(storage.getSwimWorkout).mockResolvedValue({ ...workouts[0]!, user_id: receiptId });
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...plan, user_id: receiptId }]);
    expect(await call()).toEqual({
      error: name === "Plan status" ? "Swim plan not found." : "Swim workout not found.", errorCode: "not_found",
    });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
  });
});

describe("DC-SW8/DC-SW9 confirmed completion view", () => {
  it("does not project or confirm before the original mutation and shared recompute settle", async () => {
    let release!: (value: Awaited<ReturnType<typeof storage.completeSwimWorkout>>) => void;
    let entered!: () => void;
    const waiting = new Promise<void>((resolve) => { entered = resolve; });
    vi.mocked(storage.completeSwimWorkout).mockImplementationOnce(() => {
      entered();
      return new Promise((resolve) => { release = resolve; });
    });
    const pending = completeSwimWorkoutResult(actualForm());
    await waiting;
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
    release({ workout: returnedEditedWorkout, session_id: sessionId, cardio_log_id: receiptId, transitioned: true });
    const result = await pending;
    expect(result.completion?.view).toBe(confirmedEditedView);
    expect(storage.completeSwimWorkout).toHaveBeenCalledOnce();
    expect(vi.mocked(recomputeAfterCompletedSessionMutation).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(queries.swimWorkoutViewFromRow).mock.invocationCallOrder[0]!);
  });

  it("retains existing replay-safe recompute failure semantics rather than confirming unfinished reconciliation", async () => {
    vi.mocked(recomputeAfterCompletedSessionMutation).mockRejectedValueOnce(new Error("Recompute unavailable"));
    expect(await completeSwimWorkoutResult(actualForm())).toEqual({ error: "Recompute unavailable", errorCode: "transient" });
    expect(storage.completeSwimWorkout).toHaveBeenCalledOnce();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it.each([false, true])("projects committed original result/receipt after recompute; refresh failure=%s", async (refreshFails) => {
    const returned = { ...returnedWorkout, revision: 3, status: "completed" as const };
    vi.mocked(queries.swimWorkoutViewFromRow).mockImplementation(swimWorkoutViewFromRow);
    vi.mocked(storage.completeSwimWorkout).mockImplementationOnce(async (_client, input) => {
      expect(input.clientLogId).toBe(receiptId);
      expect(input.completionEntryId).toBe(receiptId);
      mock.client.from.mockImplementation((table: string) => ({
        select: () => ({
          in: async () => ({ error: null, data: table === "sessions" ? [{
            id: sessionId, completed_at: "2026-09-07T12:20:00Z", deleted_at: null, notes: input.notes,
          }] : [{ id: receiptId, session_id: sessionId, swim_result: input.result }] }),
        }),
      }));
      return { workout: returned, session_id: sessionId, cardio_log_id: receiptId, transitioned: true };
    });
    if (refreshFails) vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    const result = await completeSwimWorkoutResult(actualForm());
    expect(result).toEqual({ ok: true, completion: {
      receiptId, workoutId: returned.id, sessionId, userId,
      ...(refreshFails ? { warning: SWIM_REFRESH_WARNING } : {}),
      view: {
        ...confirmedWorkoutView, revision: 3, status: "completed", notes: "Easy",
        result: {
          lengths: 12, timeMs: 900123, rpe: 6, notes: "Easy", splits: "", stroke: "freestyle",
          strokes: ["freestyle"], equipment: [], course: "25 yd", distance: "300 yd",
          pool: returned.definition.issued.snapshot.course,
        },
      },
    } });
    expect(storage.completeSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.getSwimWorkout).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledWith({ supabase: mock.client, userId, sessionId });
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledWith(mock.client, userId, returned);
    const order = [storage.completeSwimWorkout, recomputeAfterCompletedSessionMutation, revalidatePath, queries.swimWorkoutViewFromRow]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it.each(["null", "throw", "started", "foreign", "malformed"] as const)("does not retry a committed write when projection is %s", async (failure) => {
    if (failure === "null") vi.mocked(queries.swimWorkoutViewFromRow).mockResolvedValueOnce(null);
    if (failure === "throw") vi.mocked(queries.swimWorkoutViewFromRow).mockRejectedValueOnce(new Error("History unavailable"));
    if (failure === "foreign") vi.mocked(queries.swimWorkoutViewFromRow).mockResolvedValueOnce({ ...confirmedEditedView, sessionId: receiptId });
    if (failure === "malformed") vi.mocked(queries.swimWorkoutViewFromRow).mockResolvedValueOnce({ ...confirmedEditedView, result: null });
    expect(await completeSwimWorkoutResult(actualForm())).toEqual({
      ok: true, completion: { receiptId, workoutId: returnedWorkout.id, sessionId, userId, warning: SWIM_REFRESH_WARNING },
    });
    expect(storage.completeSwimWorkout).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledOnce();
  });
});

describe("DC-SW8/SW9 confirmed Edit view", () => {
  beforeEach(() => {
    vi.mocked(storage.getSwimWorkout).mockResolvedValue({ ...returnedEditedWorkout, revision: 3 });
  });

  it.each([
    [false, "success"], [true, "success"],
    [false, "null"], [true, "null"],
    [false, "throw"], [true, "throw"],
  ] as const)("keeps the saved edit with refresh failure=%s and projection=%s", async (refreshFails, projection) => {
    if (refreshFails) vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Private refresh failure"); });
    if (projection === "null") vi.mocked(queries.swimWorkoutViewFromRow).mockResolvedValueOnce(null);
    if (projection === "throw") vi.mocked(queries.swimWorkoutViewFromRow).mockRejectedValueOnce(new Error("Private history failure"));
    const result = await editSwimResult(editForm());
    expect(result).toEqual({
      ok: true, ...(refreshFails || projection !== "success" ? { warning: SWIM_REFRESH_WARNING } : {}),
      ...(projection === "success" ? { view: confirmedEditedView } : {}),
    });
    if (projection === "success") expect(result.view).toBe(confirmedEditedView);
    else expect(result).not.toHaveProperty("view");
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(storage.editSwimResult).toHaveBeenCalledWith(mock.client, expect.objectContaining({
      workoutId: returnedEditedWorkout.id, expectedRevision: 3, notes: "Edited swim",
      result: expect.objectContaining({
        lengths: 14, timeMs: 840456, rpe: 7,
        snapshot: expect.objectContaining({ strokes: ["backstroke"], equipment: ["fins"] }),
      }),
    }));
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledWith({ supabase: mock.client, userId, sessionId });
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledOnce();
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledWith(mock.client, userId, returnedEditedWorkout);
    expect(vi.mocked(queries.swimWorkoutViewFromRow).mock.calls[0]![2]).toBe(returnedEditedWorkout);
    expect(storage.getSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.getSwimWorkout).toHaveBeenCalledWith(mock.client, returnedEditedWorkout.id);
    expect(storage.getSwimResult).toHaveBeenCalledOnce();
    expect(storage.getSwimResult).toHaveBeenCalledWith(mock.client, sessionId);
    expect(revalidatePath).toHaveBeenCalledTimes(refreshFails ? 1 : 7);
    if (!refreshFails) expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/app"], ["/app/plan"], ["/app/swim"], ["/app/stats"], ["/app/sessions"],
      ["/app/swim/[workoutId]", "page"], [`/app/sessions/${sessionId}`],
    ]);
    const calls = [storage.editSwimResult, recomputeAfterCompletedSessionMutation, revalidatePath, queries.swimWorkoutViewFromRow]
      .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
    expect(calls).toEqual([...calls].sort((a, b) => a - b));
    expect(storage.completeSwimWorkout).not.toHaveBeenCalled();
    expect(storage.listSwimWorkouts).not.toHaveBeenCalled();
  });

  it.each([false, true])("projects actual edited history after the one mutation, refresh failure=%s", async (refreshFails) => {
    vi.mocked(queries.swimWorkoutViewFromRow).mockImplementation(swimWorkoutViewFromRow);
    vi.mocked(storage.editSwimResult).mockImplementationOnce(async (_client, input) => {
      mock.client.from.mockImplementation((table: string) => ({
        select: () => ({
          in: async () => ({ error: null, data: table === "sessions" ? [{
            id: sessionId, completed_at: "2026-09-07T12:20:00Z", deleted_at: null, notes: input.notes,
          }] : [{ id: receiptId, session_id: sessionId, swim_result: input.result, notes: "Earlier cardio note" }] }),
        }),
      }));
      return { workout: returnedEditedWorkout, session_id: sessionId, cardio_log_id: receiptId, transitioned: false };
    });
    if (refreshFails) vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Private refresh failure"); });
    const result = await editSwimResult(editForm());
    expect(result).toEqual({ ok: true, view: confirmedEditedView, ...(refreshFails ? { warning: SWIM_REFRESH_WARNING } : {}) });
    expect(result.view?.id).toBe(returnedEditedWorkout.id);
    expect(result.view?.sessionId).toBe(returnedEditedWorkout.session_id);
    expect(result.view?.revision).toBe(returnedEditedWorkout.revision);
    expect(returnedEditedWorkout.definition).toEqual(swimFixture().workouts[0]!.definition);
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(storage.getSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.getSwimResult).toHaveBeenCalledOnce();
    expect(storage.listSwimPlans).toHaveBeenCalledOnce();
    expect(storage.listSwimWorkouts).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledOnce();
    expect(vi.mocked(queries.swimWorkoutViewFromRow).mock.calls[0]![2]).toBe(returnedEditedWorkout);
    expect(mock.client.from.mock.calls.map(([table]) => table)).toEqual(["sessions", "cardio_logs"]);
    expect(revalidatePath).toHaveBeenCalledTimes(refreshFails ? 1 : 7);
  });

  it("awaits the single storage mutation and shared recompute before refresh or projection", async () => {
    let releaseMutation!: (reply: Awaited<ReturnType<typeof storage.editSwimResult>>) => void;
    let enteredMutation!: () => void;
    const mutationEntered = new Promise<void>((resolve) => { enteredMutation = resolve; });
    vi.mocked(storage.editSwimResult).mockImplementationOnce(() => {
      enteredMutation();
      return new Promise((resolve) => { releaseMutation = resolve; });
    });
    let releaseRecompute!: (reply: { recomputed: true }) => void;
    let enteredRecompute!: () => void;
    const recomputeEntered = new Promise<void>((resolve) => { enteredRecompute = resolve; });
    vi.mocked(recomputeAfterCompletedSessionMutation).mockImplementationOnce(() => {
      enteredRecompute();
      return new Promise((resolve) => { releaseRecompute = resolve; });
    });
    const pending = editSwimResult(editForm());
    await mutationEntered;
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
    releaseMutation({ workout: returnedEditedWorkout, session_id: sessionId, cardio_log_id: receiptId, transitioned: false });
    await recomputeEntered;
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
    releaseRecompute({ recomputed: true });
    expect(await pending).toEqual({ ok: true, view: confirmedEditedView });
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledTimes(7);
  });

  it.each(["parse", "storage", "workout-read", "missing-workout", "session", "missing-result", "conditions"] as const)(
    "preserves %s rejection without mutation, recompute, refresh or projection", async (failure) => {
      const form = editForm();
      let expected = { error: "Check your swim entries and try again.", errorCode: "validation" };
      if (failure === "parse") form.set("expectedRevision", "0");
      if (failure === "storage") {
        vi.mocked(requireSwimStorage).mockRejectedValueOnce(new Error("Storage unavailable"));
        expected = { error: "Storage unavailable", errorCode: "transient" };
      }
      if (failure === "workout-read") {
        vi.mocked(storage.getSwimWorkout).mockRejectedValueOnce(new Error("Workout read unavailable"));
        expected = { error: "Workout read unavailable", errorCode: "transient" };
      }
      if (failure === "missing-workout") {
        vi.mocked(storage.getSwimWorkout).mockResolvedValueOnce(null);
        expected = { error: "Swim workout not found.", errorCode: "not_found" };
      }
      if (failure === "session") {
        form.set("sessionId", planId);
        expected = { error: "This session does not belong to the swim.", errorCode: "forbidden" };
      }
      if (failure === "missing-result") {
        vi.mocked(storage.getSwimResult).mockResolvedValueOnce(null);
        expected = { error: "No saved swim result was found.", errorCode: "not_found" };
      }
      if (failure === "conditions") {
        form.set("pool", "25m"); form.set("confirmPool", "on");
        expected = { error: "Add a reason for the different pool.", errorCode: "validation" };
      }
      expect(await editSwimResult(form)).toEqual(expected);
      expect(storage.editSwimResult).not.toHaveBeenCalled();
      expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
      expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
    },
  );
});

describe("DC-SW7 confirmed Start view", () => {
  it.each([
    [false, "success"], [true, "success"],
    [false, "null"], [true, "null"],
    [false, "throw"], [true, "throw"],
  ] as const)("keeps the commit with refresh failure=%s and projection=%s", async (refreshFails, projection) => {
    if (refreshFails) vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Private refresh failure"); });
    if (projection === "null") vi.mocked(queries.swimWorkoutViewFromRow).mockResolvedValueOnce(null);
    if (projection === "throw") vi.mocked(queries.swimWorkoutViewFromRow).mockRejectedValueOnce(new Error("Private history failure"));
    expect(await startSwimWorkout(returnedWorkout.id, 1)).toEqual({
      ok: true, ...(refreshFails || projection !== "success" ? { warning: SWIM_REFRESH_WARNING } : {}),
      ...(projection === "success" ? { view: confirmedWorkoutView } : {}),
    });
    expect(storage.startSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.startSwimWorkout).toHaveBeenCalledWith(mock.client, returnedWorkout.id, 1);
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledOnce();
    expect(queries.swimWorkoutViewFromRow).toHaveBeenCalledWith(mock.client, userId, returnedWorkout);
    expect(vi.mocked(queries.swimWorkoutViewFromRow).mock.calls[0]![2]).toBe(returnedWorkout);
    expect(storage.getSwimWorkout).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalled();
    expect(vi.mocked(storage.startSwimWorkout).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    expect(vi.mocked(revalidatePath).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(queries.swimWorkoutViewFromRow).mock.invocationCallOrder[0]!);
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
  });

  it("projects the actual committed session and revision without rereading the workout", async () => {
    vi.mocked(queries.swimWorkoutViewFromRow).mockImplementation(swimWorkoutViewFromRow);
    mock.client.from.mockImplementation((table: string) => ({
      select: () => ({
        in: async () => ({ error: null, data: table === "sessions" ? [{
          id: sessionId, completed_at: null, deleted_at: null, notes: null,
        }] : [] }),
      }),
    }));
    expect(await startSwimWorkout(returnedWorkout.id, 1)).toEqual({ ok: true, view: confirmedWorkoutView });
    expect(storage.getSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.startSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.listSwimPlans).toHaveBeenCalledOnce();
    expect(mock.client.from.mock.calls.map(([table]) => table)).toEqual(["sessions", "cardio_logs"]);
  });

  it.each(["safety", "revision", "read", "missing"] as const)("preserves %s rejection before writing or projecting", async (failure) => {
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(swimFixture().workouts[0]!);
    if (failure === "safety") vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Safety unavailable"));
    if (failure === "read") vi.mocked(storage.getSwimWorkout).mockRejectedValueOnce(new Error("Read unavailable"));
    if (failure === "missing") vi.mocked(storage.getSwimWorkout).mockResolvedValueOnce(null);
    const result = await startSwimWorkout(returnedWorkout.id, failure === "revision" ? 0 : 1);
    expect(result).toMatchObject({ error: expect.any(String), errorCode: failure === "revision" ? "validation" : failure === "missing" ? "not_found" : "transient" });
    expect(result).not.toHaveProperty("ok");
    expect(result).not.toHaveProperty("view");
    expect(storage.startSwimWorkout).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe.each(["paused", "finished", "archived", "resume"] as const)("DC-SW7 confirmed %s view", (operation) => {
  async function prepare() {
    const { plan, workouts } = swimFixture();
    const returnedPlan = { ...plan, revision: 7, status: operation === "resume" ? "active" as const : operation, ends_on: "2026-10-31" };
    vi.mocked(storage.setSwimPlanStatus).mockResolvedValue(returnedPlan);
    vi.mocked(storage.resumeSwimPlan).mockResolvedValue({ plan: returnedPlan, workouts });
    if (operation !== "resume") return {
      returnedPlan, mutation: storage.setSwimPlanStatus,
      call: () => changeSwimPlanStatus(planId, 1, operation), planReads: 1,
    };
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{
      ...plan, status: "paused", state: {
        ...plan.state, pauseSnapshot: { pausedAt: "2026-09-08T12:00:00Z", workoutIds: workouts.map((row) => row.id) },
      },
    }]);
    const result = await previewSwimResume(planId, 1, "2026-10-01");
    if (!result.preview) throw new Error("Expected resume preview");
    const preview = result.preview;
    vi.mocked(storage.listSwimPlans).mockClear();
    vi.mocked(storage.listSwimWorkouts).mockClear();
    return { returnedPlan, mutation: storage.resumeSwimPlan, call: () => resumeSwimPlan(preview), planReads: 2 };
  }

  it.each([
    [false, false], [true, false], [false, true], [true, true],
  ])("keeps committed success for refresh failure=%s and view failure=%s", async (refreshFails, viewFails) => {
    const { returnedPlan, mutation, call, planReads } = await prepare();
    if (refreshFails) vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Private refresh failure"); });
    if (viewFails) vi.mocked(queries.loadSwimHubView).mockRejectedValueOnce(new Error("Private view failure"));
    const result = await call();
    expect(result).toEqual({
      ok: true, ...(refreshFails || viewFails ? { warning: SWIM_REFRESH_WARNING } : {}),
      ...(viewFails ? {} : { view: confirmedView }),
    });
    if (!result.view) expect(result.warning || ("refreshWarning" in result && result.refreshWarning)).toBeTruthy();
    expect(mutation).toHaveBeenCalledOnce();
    expect(queries.loadSwimHubView).toHaveBeenCalledOnce();
    expect(queries.loadSwimHubView).toHaveBeenCalledWith(mock.client, userId, returnedPlan);
    expect(vi.mocked(queries.loadSwimHubView).mock.calls[0]![2]).toBe(returnedPlan);
    expect(storage.listSwimPlans).toHaveBeenCalledTimes(planReads);
    expect(vi.mocked(mutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    expect(vi.mocked(revalidatePath).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(queries.loadSwimHubView).mock.invocationCallOrder[0]!);
  });

  it("projects the returned revision/status/dates and reads workouts after the commit without returning raw rows", async () => {
    const { returnedPlan, mutation, call, planReads } = await prepare();
    vi.mocked(queries.loadSwimHubView).mockImplementation(loadSwimHubView);
    const committedWorkouts = swimFixture().workouts.map((row) => ({ ...row, scheduled_date: "2026-10-15" }));
    vi.mocked(storage.setSwimPlanStatus).mockImplementationOnce(async () => {
      vi.mocked(storage.listSwimWorkouts).mockResolvedValue(committedWorkouts);
      return returnedPlan;
    });
    vi.mocked(storage.resumeSwimPlan).mockImplementationOnce(async () => {
      vi.mocked(storage.listSwimWorkouts).mockResolvedValue(committedWorkouts);
      return { plan: returnedPlan, workouts: [] };
    });
    const result = await call();
    expect(result.ok).toBe(true);
    expect(result).not.toHaveProperty("warning");
    expect(Object.keys(result).sort()).toEqual(["ok", "view"]);
    expect(result.view).toMatchObject({
      id: planId, revision: 7, status: returnedPlan.status, dates: "2026-09-07 – 2026-10-31",
    });
    expect(result.view?.workouts).toHaveLength(committedWorkouts.length);
    expect(result.view?.workouts.every((row) => row.date === "2026-10-15" &&
      row.status === (operation === "resume" ? "Scheduled" : "Unscheduled"))).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/user_id|definition|created_at|updated_at|pauseSnapshot/);
    expect(storage.listSwimPlans).toHaveBeenCalledTimes(planReads);
    expect(storage.listSwimWorkouts).toHaveBeenCalledTimes(planReads + 1);
    expect(vi.mocked(mutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(storage.listSwimWorkouts).mock.invocationCallOrder.at(-1)!);
  });

  it.each([
    [undefined, "transient"], ["42501", "forbidden"], ["40001", "validation"],
  ])("preserves write rejection (%s) without refresh or view reads", async (code, errorCode) => {
    const { call, mutation } = await prepare();
    vi.mocked(mutation).mockRejectedValueOnce(new Error("RPC reply unavailable", { cause: { code } }));
    expect(await call()).toEqual({
      error: code === "42501" ? "You cannot change this swim." : "RPC reply unavailable", errorCode,
    });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
  });

  it.each(["auth", "ownership", "revision"] as const)("preserves %s rejection before writing", async (failure) => {
    const { call, mutation } = await prepare();
    if (failure === "auth") mock.user = null;
    else {
      const [plan] = await storage.listSwimPlans(mock.client as never);
      vi.mocked(storage.listSwimPlans).mockResolvedValue([{
        ...plan!, ...(failure === "ownership" ? { user_id: receiptId } : { revision: 3 }),
      }]);
    }
    expect(await call()).toEqual(failure === "auth"
      ? { error: "Sign in to save your swim.", errorCode: "auth" }
      : failure === "ownership"
        ? { error: "Swim plan not found.", errorCode: "not_found" }
        : { error: "Your swim plan changed. Reload and try again.", errorCode: "validation" });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
  });

  if (operation === "resume") it("B9 DC-SW5/DC-SW7/DC-SW8: matches the real resume schedule and generator versions", async () => {
    const { call } = await prepare();
    expect(await call()).toEqual({ ok: true, view: confirmedView });
    expect(storage.resumeSwimPlan).toHaveBeenCalledOnce();
    const input = vi.mocked(storage.resumeSwimPlan).mock.calls[0]![1];
    expect(input.state.decisions).toHaveLength(swimFixture().plan.state.decisions.length + 1);
    const schedule = input.state.decisions.at(-1)!;
    expect([schedule.kind, schedule.decision]).toEqual(["schedule", "accepted"]);
    expect([schedule.ruleVersion, schedule.generatorVersion]).toEqual([SWIM_SCHEDULE_VERSION, SWIM_GENERATOR_VERSION]);
    expect(SWIM_SCHEDULE_VERSION).not.toBe(SWIM_GENERATOR_VERSION);

    const source = readFileSync(resolve(__dirname, "../../../../e2e/swimming-decisions-offline-mobile.spec.ts"), "utf8");
    const boundary = source.indexOf('\n  test("B9 ');
    expect(boundary).toBeGreaterThan(0);
    const comparisons = source.slice(boundary).match(/same\(\[schedule\.ruleVersion, schedule\.generatorVersion\], \[[^\n]+\]\);/g);
    expect(comparisons).toHaveLength(1);
    const oracle = comparisons![0]!;
    const context = {
      schedule, SWIM_SCHEDULE_VERSION, SWIM_GENERATOR_VERSION,
      same: (actual: unknown, expected: unknown) => expect(isDeepStrictEqual(actual, expected)).toBe(true),
    };
    const oldOracle = oracle.replace("[SWIM_SCHEDULE_VERSION, SWIM_GENERATOR_VERSION]", "[SWIM_GENERATOR_VERSION, SWIM_GENERATOR_VERSION]");
    expect(() => runInNewContext(oldOracle, context)).toThrow();
    runInNewContext(oracle, context);
  });

  if (operation === "resume") it("retains resume safety rejection before the mutation", async () => {
    const { call, mutation } = await prepare();
    vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Safety unavailable"));
    expect(await call()).toEqual({ error: "Safety unavailable", errorCode: "transient" });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
  });
});

describe.each([
  ["progression", "accepted"], ["progression", "rejected"], ["progression", "overridden"],
  ["assessment", "accepted"], ["assessment", "rejected"],
] as const)("DC-SW5/DC-K4 confirmed %s %s", (kind, choice) => {
  async function prepare() {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, history } = swimFixture();
    vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(history);
    const returnedPlan = { ...plan, revision: 7 };
    vi.mocked(storage.updateSwimPlan).mockResolvedValue({ plan: returnedPlan, workouts: [] });
    const candidate = queries.deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    const form = new FormData();
    for (const [key, value] of Object.entries({
      time200: "3:20.000", time400: "7:00.000", verified: "on",
      benchmarkStroke: "freestyle", benchmarkDate: "2026-09-05",
    })) form.set(key, value);
    const preview = (await proposeSwimBenchmark(planId, 1, form)).preview!;
    vi.mocked(storage.listSwimPlans).mockClear();
    vi.mocked(storage.listSwimWorkouts).mockClear();
    return {
      returnedPlan,
      call: () => kind === "progression"
        ? decideSwimProposal(planId, 1, candidate.id, choice, String(candidate.proposal.from.mainRepeats + 5), "More repeats")
        : decideSwimBenchmark(planId, preview, choice as "accepted" | "rejected"),
    };
  }

  it.each([[false, false], [true, false], [false, true], [true, true]])(
    "preserves the single commit and both warnings: refresh failure=%s view failure=%s",
    async (refreshFails, viewFails) => {
      const { returnedPlan, call } = await prepare();
      if (refreshFails) vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Refresh unavailable"); });
      if (viewFails) vi.mocked(queries.loadSwimHubView).mockRejectedValueOnce(new Error("View unavailable"));
      const result = await call();
      const input = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
      const principleWarning = choice === "overridden" ? expect.any(String) : undefined;
      expect(result).toEqual({
        ok: true, ...(viewFails ? {} : { view: confirmedView }),
        ...(principleWarning ? { warning: principleWarning } : {}),
        ...(refreshFails || viewFails ? { [kind === "progression" ? "refreshWarning" : "warning"]: SWIM_REFRESH_WARNING } : {}),
      });
      if (choice === "overridden") {
        expect(result.warning).toBeTruthy();
        expect(input.state.decisions.at(-1)?.inputSnapshot).toMatchObject({ engineDecision: { warning: result.warning } });
      }
      if (!result.view) expect(result.warning || ("refreshWarning" in result && result.refreshWarning)).toBeTruthy();
      else expect(result.view).toBe(confirmedView);
      expect(storage.updateSwimPlan).toHaveBeenCalledOnce();
      expect(queries.loadSwimHubView).toHaveBeenCalledOnce();
      expect(vi.mocked(queries.loadSwimHubView).mock.calls[0]![2]).toBe(returnedPlan);
      expect(storage.listSwimPlans).toHaveBeenCalledOnce();
      expect(storage.listSwimWorkouts).toHaveBeenCalledOnce();
      expect(input.expectedRevision).toBe(1);
      expect(input.state.decisions.at(-1)).toMatchObject({
        decision: choice, ruleVersion: expect.any(String), generatorVersion: expect.any(String),
      });
      if (choice === "rejected") expect(input.workouts).toEqual([]);
      else {
        expect(input.workouts.length).toBeGreaterThan(0);
        expect(input.workouts.every((row) => row.scheduled_date > "2026-09-12")).toBe(true);
      }
      expect(revalidatePath).toHaveBeenCalledTimes(refreshFails ? 1 : 6);
      const calls = [storage.updateSwimPlan, revalidatePath, queries.loadSwimHubView]
        .map((fn) => vi.mocked(fn).mock.invocationCallOrder[0]!);
      expect(calls).toEqual([...calls].sort((a, b) => a - b));
    },
  );

  it("projects the actual returned plan without a second plan read", async () => {
    const { returnedPlan, call } = await prepare();
    vi.mocked(queries.loadSwimHubView).mockImplementation(loadSwimHubView);
    const result = await call();
    expect(result.view).toMatchObject({ id: returnedPlan.id, revision: returnedPlan.revision, status: returnedPlan.status });
    expect(storage.listSwimPlans).toHaveBeenCalledOnce();
    expect(storage.listSwimWorkouts).toHaveBeenCalledTimes(2);
    expect(storage.updateSwimPlan).toHaveBeenCalledOnce();
  });

  it.each([undefined, "42501", "40001", "P0001", "23505", "23514"])(
    "preserves RPC rejection %s, without projection, refresh, or retry", async (code) => {
      const { call } = await prepare();
      vi.mocked(storage.updateSwimPlan).mockRejectedValueOnce(new Error("RPC unavailable", { cause: { code } }));
      expect(await call()).toEqual({
        error: code === "42501" ? "You cannot change this swim." : "RPC unavailable",
        errorCode: code === undefined ? "transient" : code === "42501" ? "forbidden" : "validation",
      });
      expect(storage.updateSwimPlan).toHaveBeenCalledOnce();
      expect(queries.loadSwimHubView).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it.each(["auth", "ownership", "revision", "read", "safety"] as const)(
    "retains pre-write %s rejection", async (failure) => {
      if (failure === "safety" && choice === "rejected") return;
      const { call } = await prepare();
      if (failure === "auth") mock.user = null;
      if (failure === "ownership") vi.mocked(storage.listSwimPlans).mockResolvedValue([]);
      if (failure === "revision") vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...swimFixture().plan, revision: 3 }]);
      if (failure === "read") vi.mocked(storage.listSwimPlans).mockRejectedValueOnce(new Error("Read unavailable"));
      if (failure === "safety") vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Safety unavailable"));
      const result = await call();
      expect(result).toHaveProperty("error");
      expect(result).not.toHaveProperty("ok");
      expect(result).not.toHaveProperty("warning");
      expect(result).not.toHaveProperty("refreshWarning");
      expect(storage.updateSwimPlan).not.toHaveBeenCalled();
      expect(queries.loadSwimHubView).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("DC-SW4 read-only week review", () => {
  it.each(["success", "view", "history", "candidate", "revision"] as const)(
    "returns a canonical view or ordinary %s error without invalidation or mutation", async (outcome) => {
      vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
      const { plan, history } = swimFixture();
      vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(history);
      if (outcome === "view") vi.mocked(queries.loadSwimHubView).mockRejectedValueOnce(new Error("View unavailable"));
      if (outcome === "history") vi.mocked(queries.loadSwimHistory).mockRejectedValueOnce(new Error("History unavailable"));
      if (outcome === "candidate") vi.spyOn(queries, "deriveSwimWeekCandidate").mockReturnValueOnce(null);
      const result = await proposeSwimWeek(planId, outcome === "revision" ? 3 : 1);
      if (outcome === "success") {
        expect(result).toEqual({ ok: true, view: confirmedView });
        expect(queries.loadSwimHubView).toHaveBeenCalledWith(mock.client, userId, plan);
        expect(storage.listSwimPlans).toHaveBeenCalledOnce();
      } else {
        expect(result).toHaveProperty("error");
        expect(result).not.toHaveProperty("ok");
        expect(result).not.toHaveProperty("view");
        expect(result).not.toHaveProperty("warning");
        expect(result).not.toHaveProperty("refreshWarning");
      }
      expect(storage.updateSwimPlan).not.toHaveBeenCalled();
      expect(storage.setSwimPlanStatus).not.toHaveBeenCalled();
      expect(storage.resumeSwimPlan).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("guarded edit phases and unchanged refresh callers", () => {
  it("DC-SW9 keeps edit recompute rejection an ordinary error after one mutation", async () => {
    vi.mocked(recomputeAfterCompletedSessionMutation).mockRejectedValueOnce(new Error("Recompute unavailable"));
    expect(await editSwimResult(actualForm())).toEqual({ error: "Recompute unavailable", errorCode: "transient" });
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
  });

  it("keeps an edit result-read rejection an error before mutation", async () => {
    vi.mocked(storage.getSwimResult).mockRejectedValueOnce(new Error("Read unavailable"));
    expect(await editSwimResult(actualForm())).toEqual({ error: "Read unavailable", errorCode: "transient" });
    expect(storage.editSwimResult).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
    expect(queries.swimWorkoutViewFromRow).not.toHaveBeenCalled();
  });

  it("DC-SW9 completion warns after a committed save if refresh fails, without retrying", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    expect(await completeSwimWorkoutResult(actualForm())).toMatchObject({
      ok: true, completion: { receiptId, sessionId, userId, warning: SWIM_REFRESH_WARNING },
    });
    expect(storage.completeSwimWorkout).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
  });

  it("DC-SW7 skip retains its existing refresh-error behavior", async () => {
    const workout = swimFixture().workouts[0]!;
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(workout);
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    expect(await skipSwimWorkout(workout.id, 1, "No pool access")).toEqual({ error: "Cache unavailable", errorCode: "transient" });
    expect(storage.skipSwimWorkout).toHaveBeenCalledOnce();
  });
});
