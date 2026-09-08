import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import { startSwimWorkout, changeSwimPlanStatus, editSwimResult, completeSwimWorkoutResult, skipSwimWorkout, previewSwimResume, resumeSwimPlan } from "../actions";
import * as storage from "../storage";
import * as queries from "../queries";
import { assertSwimSafety } from "../safety";
import { SWIM_REFRESH_WARNING } from "../action-feedback";
import type { SwimHubView } from "../view-types";
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
  resumeSwimPlan: vi.fn(),
}));

const loadSwimHubView = queries.loadSwimHubView;
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

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
  vi.spyOn(queries, "loadSwimHubView").mockResolvedValue(confirmedView);
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
  vi.mocked(storage.startSwimWorkout).mockResolvedValue(workout);
  vi.mocked(storage.setSwimPlanStatus).mockResolvedValue({ ...plan, revision: 7, status: "paused" });
  const reply = { workout, session_id: sessionId, cardio_log_id: receiptId, transitioned: false };
  vi.mocked(storage.editSwimResult).mockResolvedValue(reply);
  vi.mocked(storage.completeSwimWorkout).mockResolvedValue(reply);
  vi.mocked(recomputeAfterCompletedSessionMutation).mockResolvedValue({ recomputed: true });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const actions = [
  { name: "Start", call: () => startSwimWorkout(swimFixture().workouts[0]!.id, 1), mutation: storage.startSwimWorkout },
  { name: "Plan status", call: () => changeSwimPlanStatus(planId, 1, "paused"), mutation: storage.setSwimPlanStatus },
  { name: "Edit", call: () => editSwimResult(actualForm()), mutation: storage.editSwimResult },
];

describe.each(actions)("$name post-save refresh boundary", ({ name, call, mutation }) => {
  it("returns confirmed success and a nonempty warning when cache refresh throws, without retrying", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    const result = await call();
    expect(result).toEqual({ ok: true, warning: expect.stringMatching(/\S/), ...(name === "Plan status" ? { view: confirmedView } : {}) });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledOnce();
    expect(vi.mocked(mutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    if (name === "Edit") {
      expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
      expect(vi.mocked(recomputeAfterCompletedSessionMutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    }
  });

  it("returns success without a warning after normal refresh", async () => {
    expect(await call()).toEqual({ ok: true, ...(name === "Plan status" ? { view: confirmedView } : {}) });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledWith("/app/swim/[workoutId]", "page");
    if (name === "Edit") expect(revalidatePath).toHaveBeenCalledWith(`/app/sessions/${sessionId}`);
  });

  it.each([
    [undefined, "transient"], ["42501", "forbidden"], ["40001", "validation"],
  ])("preserves RPC/reply rejection classification (%s), without refresh or retry", async (code, errorCode) => {
    vi.mocked(mutation).mockRejectedValueOnce(new Error("RPC reply unavailable", { cause: { code } }));
    expect(await call()).toEqual({
      error: code === "42501" ? "You cannot change this swim." : "RPC reply unavailable", errorCode,
    });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
  });

  it("preserves auth failure without mutation or warning", async () => {
    mock.user = null;
    expect(await call()).toEqual({ error: "Sign in to save your swim.", errorCode: "auth" });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
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

  if (operation === "resume") it("retains resume safety rejection before the mutation", async () => {
    const { call, mutation } = await prepare();
    vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Safety unavailable"));
    expect(await call()).toEqual({ error: "Safety unavailable", errorCode: "transient" });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(queries.loadSwimHubView).not.toHaveBeenCalled();
  });
});

describe("guarded edit phases and unchanged refresh callers", () => {
  it("DC-SW9 keeps edit recompute rejection an ordinary error after one mutation", async () => {
    vi.mocked(recomputeAfterCompletedSessionMutation).mockRejectedValueOnce(new Error("Recompute unavailable"));
    expect(await editSwimResult(actualForm())).toEqual({ error: "Recompute unavailable", errorCode: "transient" });
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("keeps an edit result-read rejection an error before mutation", async () => {
    vi.mocked(storage.getSwimResult).mockRejectedValueOnce(new Error("Read unavailable"));
    expect(await editSwimResult(actualForm())).toEqual({ error: "Read unavailable", errorCode: "transient" });
    expect(storage.editSwimResult).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("DC-SW9 completion retains its existing refresh-error behavior", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    expect(await completeSwimWorkoutResult(actualForm())).toEqual({ error: "Cache unavailable", errorCode: "transient" });
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
