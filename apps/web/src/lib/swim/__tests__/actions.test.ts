import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swimFixture, userId, planId, sessionId, receiptId } from "./fixtures";
import { completeSwimWorkoutResult, createSwimPlan, startSwimWorkout, editSwimResult, decideSwimProposal, previewSwimResume, resumeSwimPlan, proposeSwimBenchmark, decideSwimBenchmark, skipSwimWorkout } from "../actions";
import { SWIM_ASSESSMENT_VERSION } from "@hta/domain";
import * as queries from "../queries";
import * as storage from "../storage";
import { requireSwimSetup, requireSwimStorage } from "../capability";
import { assertSwimSafety } from "../safety";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";

const mock = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  client: { from: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mock.client,
  getAuthUser: async () => ({ data: { user: mock.user } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../capability", () => ({ requireSwimSetup: vi.fn(), requireSwimStorage: vi.fn() }));
vi.mock("../safety", async (importOriginal) => ({
  ...await importOriginal<typeof import("../safety")>(), assertSwimSafety: vi.fn(),
}));
vi.mock("@/lib/sessions/post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: vi.fn(async () => ({ recomputed: true })),
}));
vi.mock("../storage", () => ({
  createSwimPlan: vi.fn(), getSwimWorkout: vi.fn(), startSwimWorkout: vi.fn(),
  completeSwimWorkout: vi.fn(), editSwimResult: vi.fn(), getSwimResult: vi.fn(),
  listSwimPlans: vi.fn(), listSwimWorkouts: vi.fn(), skipSwimWorkout: vi.fn(),
  setSwimPlanStatus: vi.fn(), updateSwimPlan: vi.fn(), resumeSwimPlan: vi.fn(),
}));

function actualForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    workoutId: swimFixture().workouts[0]!.id, sessionId, clientLogId: receiptId, expectedRevision: "1",
    lengths: "12", timeMs: "900123", rpe: "6", notes: "Easy", stroke: "freestyle", equipment: "[]",
  })) form.set(key, value);
  return form;
}
function setupForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    goal: "base", experience: "beginner", pool: "25yd", comfortableLengths: "4", timeBudgetMinutes: "30",
    weeks: "3", startDate: "2026-09-07", weekdays: "1", strokes: "freestyle",
  })) form.set(key, value);
  return form;
}

function benchmarkForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    time200: "3:20.000", time400: "7:00.000", verified: "on",
    benchmarkStroke: "freestyle", benchmarkDate: "2026-09-05",
  })) form.set(key, value);
  return form;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-05T12:00:00Z"));
  mock.user = { id: userId };
  const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), in: vi.fn() };
  query.select.mockReturnValue(query); query.eq.mockReturnValue(query);
  query.maybeSingle.mockResolvedValue({ data: { timezone: "UTC" }, error: null });
  query.in.mockResolvedValue({ data: [{ id: "00000000-0000-4000-8000-000000000008", slug: "swim-easy" }], error: null });
  mock.client.from.mockReturnValue(query);
  vi.mocked(requireSwimSetup).mockResolvedValue();
  vi.mocked(requireSwimStorage).mockResolvedValue();
  vi.mocked(assertSwimSafety).mockResolvedValue();
  const { plan, workouts } = swimFixture();
  vi.mocked(storage.getSwimWorkout).mockResolvedValue({ ...workouts[0]!, session_id: sessionId, status: "started" });
  vi.mocked(storage.listSwimPlans).mockResolvedValue([plan]);
  vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts);
  vi.mocked(storage.createSwimPlan).mockResolvedValue({ plan, workouts });
  vi.mocked(storage.completeSwimWorkout).mockResolvedValue({
    workout: { ...workouts[0]!, session_id: sessionId, status: "completed" },
    session_id: sessionId, cardio_log_id: receiptId, transitioned: true,
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("ADR0079 server actions", () => {
  it.each(["paused", "finished", "archived"] as const)("DC-SW7 rejects a skip on a %s plan before storage mutation", async (status) => {
    const { plan, workouts } = swimFixture();
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(workouts[0]!);
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...plan, status }]);
    expect(await skipSwimWorkout(workouts[0]!.id, 1, "No pool access")).toMatchObject({ errorCode: "validation" });
    expect(storage.skipSwimWorkout).not.toHaveBeenCalled();
  });
  it("DC-SW7 still skips an unstarted workout in an active plan", async () => {
    const workout = swimFixture().workouts[0]!;
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(workout);
    expect(await skipSwimWorkout(workout.id, 1, "No pool access")).toEqual({ ok: true });
    expect(storage.skipSwimWorkout).toHaveBeenCalledWith(mock.client, workout.id, 1, "No pool access");
  });
  it("DC-SW7 reports a plan-status race as a validation error", async () => {
    const workout = swimFixture().workouts[0]!;
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(workout);
    vi.mocked(storage.skipSwimWorkout).mockRejectedValueOnce(
      new Error("Plan became inactive", { cause: { code: "P0001" } }),
    );
    expect(await skipSwimWorkout(workout.id, 1, "No pool access")).toMatchObject({ errorCode: "validation" });
  });
  it("completion bypasses setup/safety gates and accepts late archived work through the durable boundary", async () => {
    vi.mocked(requireSwimSetup).mockRejectedValue(new Error("Setup disabled"));
    vi.mocked(assertSwimSafety).mockRejectedValue(new Error("New limitation"));
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...swimFixture().plan, status: "archived" }]);
    expect(await completeSwimWorkoutResult(actualForm())).toEqual({ ok: true });
    expect(requireSwimSetup).not.toHaveBeenCalled();
    expect(assertSwimSafety).not.toHaveBeenCalled();
    expect(storage.completeSwimWorkout).toHaveBeenCalledWith(mock.client, expect.objectContaining({
      completionEntryId: receiptId, clientLogId: receiptId,
      result: expect.objectContaining({ lengths: 12, timeMs: 900123 }),
    }));
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledWith({ supabase: mock.client, userId, sessionId });
  });
  it("replays the same receipt without adding a second log or incremental load", async () => {
    const completed = vi.mocked(storage.completeSwimWorkout).getMockImplementation()!;
    await completeSwimWorkoutResult(actualForm());
    vi.mocked(storage.completeSwimWorkout).mockResolvedValue({ ...(await completed(mock.client as never, {} as never)), transitioned: false });
    expect(await completeSwimWorkoutResult(actualForm())).toEqual({ ok: true });
    expect(storage.completeSwimWorkout).toHaveBeenCalledTimes(2);
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledTimes(2);
  });
  it("fails closed on missing storage and never falls back to generic cardio", async () => {
    vi.mocked(requireSwimStorage).mockRejectedValue(new Error("Swimming storage is not available."));
    expect(await completeSwimWorkoutResult(actualForm())).toMatchObject({ errorCode: "transient" });
    expect(storage.completeSwimWorkout).not.toHaveBeenCalled();
    expect(recomputeAfterCompletedSessionMutation).not.toHaveBeenCalled();
  });
  it("does not permit an unrelated session identity", async () => {
    const form = actualForm(); form.set("sessionId", planId);
    expect(await completeSwimWorkoutResult(form)).toMatchObject({ errorCode: "forbidden" });
    expect(storage.completeSwimWorkout).not.toHaveBeenCalled();
  });
  it("classifies invalid splits as editable validation failures, not FIFO-blocking retries", async () => {
    const form = actualForm(); form.set("splits", "20, 2:00");
    expect(await completeSwimWorkoutResult(form)).toMatchObject({ errorCode: "validation" });
    form.set("splits", "2, bad-time");
    expect(await completeSwimWorkoutResult(form)).toMatchObject({ errorCode: "validation" });
    expect(storage.completeSwimWorkout).not.toHaveBeenCalled();
  });
  it("blocks new setup while retaining existing finish actions", async () => {
    vi.mocked(requireSwimSetup).mockRejectedValue(new Error("Setup disabled"));
    expect(await createSwimPlan(setupForm())).toHaveProperty("error");
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("generates and saves every issued week only after the current safety check", async () => {
    expect(await createSwimPlan(setupForm())).toEqual({ ok: true, planId });
    const input = vi.mocked(storage.createSwimPlan).mock.calls[0]![1];
    expect(input.workouts).toHaveLength(3);
    expect(input.workouts[0]!.definition.original).toEqual(input.workouts[0]!.definition.issued);
    expect(input.state.acceptedCalibration).toBeNull();
    expect(assertSwimSafety).toHaveBeenCalledOnce();
    expect(assertSwimSafety).toHaveBeenCalledWith(mock.client, userId, expect.objectContaining({
      movementIds: ["00000000-0000-4000-8000-000000000008"],
    }));
  });
  it("returns learning guidance rather than forcing a test or prescribing a whole length", async () => {
    const form = setupForm(); form.set("comfortableLengths", "0");
    form.delete("strokes");
    expect(await createSwimPlan(form)).toHaveProperty("guidance");
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("returns actionable conflict options without persisting an infeasible event plan", async () => {
    const form = setupForm();
    form.set("eventDate", "2026-09-06"); form.set("eventNumerator", "500");
    form.set("eventDenominator", "1"); form.set("eventUnit", "yd");
    const result = await createSwimPlan(form);
    expect(result.errorCode).toBe("validation");
    expect(result.options?.length).toBeGreaterThan(0);
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("does not bypass explicit movement restrictions when the swim catalog lookup fails", async () => {
    mock.client.from().in.mockResolvedValue({ data: null, error: { message: "unavailable" } });
    expect(await createSwimPlan(setupForm())).toMatchObject({ errorCode: "transient" });
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
    expect(assertSwimSafety).not.toHaveBeenCalled();
  });
  it("rechecks safety for a new start, but does not strand an already-started workout", async () => {
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(swimFixture().workouts[0]!);
    vi.mocked(assertSwimSafety).mockRejectedValue(new Error("Review an active limitation."));
    expect(await startSwimWorkout(swimFixture().workouts[0]!.id, 1)).toHaveProperty("error");
    expect(storage.startSwimWorkout).not.toHaveBeenCalled();
    vi.mocked(storage.getSwimWorkout).mockResolvedValue({ ...swimFixture().workouts[0]!, session_id: sessionId });
    expect(await startSwimWorkout(swimFixture().workouts[0]!.id, 1)).toEqual({ ok: true });
  });
  it("routes a native result edit through its boundary and recomputes shared load", async () => {
    const existing = swimFixture().history[0]!.result!;
    vi.mocked(storage.getSwimResult).mockResolvedValue(existing);
    vi.mocked(storage.editSwimResult).mockResolvedValue({
      workout: swimFixture().workouts[0]!, session_id: sessionId, cardio_log_id: receiptId, transitioned: false,
    });
    expect(await editSwimResult(actualForm())).toEqual({ ok: true });
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
  });
  it("requires a reason for a changed pool and retains that confirmed pool on later edits", async () => {
    const form = actualForm(); form.set("pool", "25m"); form.set("confirmPool", "on");
    expect(await completeSwimWorkoutResult(form)).toMatchObject({ errorCode: "validation" });
    expect(storage.completeSwimWorkout).not.toHaveBeenCalled();
    form.set("reason", "Different pool");
    expect(await completeSwimWorkoutResult(form)).toEqual({ ok: true });
    const actual = vi.mocked(storage.completeSwimWorkout).mock.calls[0]![1].result;
    expect(actual.snapshot.course.unit).toBe("m");
    vi.mocked(storage.getSwimResult).mockResolvedValue(actual);
    vi.mocked(storage.editSwimResult).mockResolvedValue({
      workout: swimFixture().workouts[0]!, session_id: sessionId, cardio_log_id: receiptId, transitioned: false,
    });
    form.set("pool", "planned"); form.delete("confirmPool");
    expect(await editSwimResult(form)).toEqual({ ok: true });
    expect(storage.editSwimResult).toHaveBeenCalledWith(mock.client, expect.objectContaining({
      allowChangedCourse: true, result: expect.objectContaining({ snapshot: actual.snapshot }),
    }));
  });
  it("preserves omitted result-edit notes and distinguishes explicit clearing", async () => {
    vi.mocked(storage.getSwimResult).mockResolvedValue(swimFixture().history[0]!.result!);
    vi.mocked(storage.editSwimResult).mockResolvedValue({
      workout: swimFixture().workouts[0]!, session_id: sessionId, cardio_log_id: receiptId, transitioned: false,
    });
    const form = actualForm(); form.delete("notes");
    expect(await editSwimResult(form)).toEqual({ ok: true });
    expect(vi.mocked(storage.editSwimResult).mock.calls[0]![1]).not.toHaveProperty("notes");
    form.set("notes", "");
    expect(await editSwimResult(form)).toEqual({ ok: true });
    expect(vi.mocked(storage.editSwimResult).mock.calls[1]![1]).toHaveProperty("notes", null);
  });
  it("requires authentication before touching owned swimming storage", async () => {
    mock.user = null;
    expect(await completeSwimWorkoutResult(actualForm())).toMatchObject({ errorCode: "auth" });
    expect(storage.getSwimWorkout).not.toHaveBeenCalled();
  });
  it("accepts a hold with its exact evidence and confirms only the next unstarted week", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, history } = swimFixture();
    const plateau = history.map((row) => ({ ...row, result: row.result ? { ...row.result, rpe: 7 } : null }));
    vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(plateau);
    const candidate = queries.deriveSwimWeekCandidate(plan, plateau, "2026-09-12")!;
    expect(await decideSwimProposal(plan.id, plan.revision, candidate.id, "accepted")).toEqual({ ok: true });
    const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
    expect(saved.state.decisions[0]).toMatchObject({
      id: candidate.id, decision: "accepted", inputSnapshot: { sourceFingerprint: candidate.exactInputs.sourceFingerprint },
    });
    expect(saved.workouts).toHaveLength(2);
    for (const workout of saved.workouts) {
      expect(workout.scheduled_date > "2026-09-12").toBe(true);
      expect(workout.definition.issued).toEqual(workout.definition.original);
      expect(workout.definition.modifications).toEqual([]);
      expect(workout.definition).toHaveProperty("provisional", false);
    }
  });
  it("rejects a week without touching any future prescriptions", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, history } = swimFixture();
    vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(history);
    const candidate = queries.deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    expect(await decideSwimProposal(plan.id, plan.revision, candidate.id, "rejected")).toEqual({ ok: true });
    expect(vi.mocked(storage.updateSwimPlan).mock.calls[0]![1]).toMatchObject({
      workouts: [], state: { decisions: [expect.objectContaining({ decision: "rejected" })] },
    });
  });
  it("DC-K4 records and returns the applied override warning without a second confirmation", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, history } = swimFixture();
    vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(history);
    const candidate = queries.deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    const repeats = candidate.proposal.from.mainRepeats + 5;
    const result = await decideSwimProposal(plan.id, plan.revision, candidate.id, "overridden", String(repeats), "More repeats");
    expect(result.ok).toBe(true);
    expect(result.warning).toBeTruthy();
    const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
    expect(saved.state.decisions[0]).toMatchObject({
      decision: "overridden", inputSnapshot: {
        appliedDose: { mainRepeats: repeats }, engineDecision: { warning: result.warning },
      },
    });
    expect(saved.workouts).toHaveLength(2);
  });
  it("previews only suspended future dates, never pre-pause missed swims", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, workouts } = swimFixture();
    const paused = { ...plan, status: "paused" as const, state: { ...plan.state, pauseSnapshot: { pausedAt: "2026-09-12T12:00:00Z", workoutIds: workouts.slice(2).map((row) => row.id) } } };
    vi.mocked(storage.listSwimPlans).mockResolvedValue([paused]);
    const result = await previewSwimResume(plan.id, 1, "2026-10-01");
    expect(result.preview?.dates).toHaveLength(4);
    expect(result.preview?.dates.every((row) => row.date >= "2026-10-01")).toBe(true);
    expect(result.preview?.dates.map((row) => row.id)).not.toContain(workouts[0]!.id);
    expect(storage.resumeSwimPlan).not.toHaveBeenCalled();
    expect(await resumeSwimPlan(result.preview!)).toEqual({ ok: true });
    expect(storage.resumeSwimPlan).toHaveBeenCalledOnce();
  });
  it("rejects modified resume preview dates instead of silently rescheduling", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, workouts } = swimFixture();
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{
      ...plan, status: "paused", state: { ...plan.state, pauseSnapshot: { pausedAt: "2026-09-12T12:00:00Z", workoutIds: workouts.slice(2).map((row) => row.id) } } as typeof plan.state,
    }]);
    const result = await previewSwimResume(plan.id, 1, "2026-10-01");
    const preview = result.preview!;
    preview.dates[0]!.date = "2026-12-01";
    expect(await resumeSwimPlan(preview)).toHaveProperty("error");
    expect(storage.resumeSwimPlan).not.toHaveBeenCalled();
  });
  it("preserves partial-week spacing instead of packing two issued weeks together on resume", async () => {
    vi.setSystemTime(new Date("2026-09-08T12:00:00Z"));
    const { plan, workouts } = swimFixture();
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{
      ...plan, status: "paused",
      state: { ...plan.state, pauseSnapshot: {
        pausedAt: "2026-09-08T12:00:00Z", workoutIds: workouts.slice(1).map((row) => row.id),
      } },
    }]);
    const result = await previewSwimResume(plan.id, plan.revision, "2026-10-01");
    expect(result.preview!.dates.map((row) => row.date)).toEqual([
      "2026-10-01", "2026-10-08", "2026-10-12", "2026-10-15", "2026-10-19",
    ]);
    expect(result.preview!.dates.map((row) => row.id)).not.toContain(workouts[0]!.id);
  });
  it("accepts a verified native assessment only for future unstarted swims", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, workouts } = swimFixture();
    vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts.map((row, index) =>
      index === 2 ? { ...row, session_id: sessionId, status: "started" } : row));
    const proposed = await proposeSwimBenchmark(plan.id, plan.revision, benchmarkForm());
    expect(proposed.preview).toBeDefined();
    expect(proposed.preview?.observation.verified).toBe(true);
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
    expect(await decideSwimBenchmark(plan.id, proposed.preview!, "accepted")).toEqual({ ok: true });
    const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
    expect(saved.state.observations).toEqual([proposed.preview!.observation]);
    expect(saved.state.acceptedCalibration).toHaveProperty("unit", "yd");
    expect(saved.state.decisions[0]).toMatchObject({ decision: "accepted", ruleVersion: SWIM_ASSESSMENT_VERSION });
    expect(saved.workouts).toHaveLength(3);
    expect(saved.workouts.every((row) => row.id !== workouts[2]!.id && row.scheduled_date > "2026-09-12")).toBe(true);
    expect(saved.workouts.every((row) => row.definition.modifications.length === 1)).toBe(true);
    expect(assertSwimSafety).toHaveBeenCalledOnce();
  });
  it("retains a rejected assessment without changing pace targets or requiring new safety clearance", async () => {
    const proposed = await proposeSwimBenchmark(planId, 1, benchmarkForm());
    expect(await decideSwimBenchmark(planId, proposed.preview!, "rejected")).toEqual({ ok: true });
    expect(vi.mocked(storage.updateSwimPlan).mock.calls[0]![1]).toMatchObject({
      workouts: [], state: { acceptedCalibration: null, observations: [proposed.preview!.observation],
        decisions: [expect.objectContaining({ decision: "rejected" })] },
    });
    expect(assertSwimSafety).not.toHaveBeenCalled();
  });
  it("revalidates assessment evidence on acceptance and rejects future observation dates", async () => {
    const proposed = await proposeSwimBenchmark(planId, 1, benchmarkForm());
    const changed = { ...proposed.preview!, observation: { ...proposed.preview!.observation, trials: [] } };
    expect(await decideSwimBenchmark(planId, changed, "accepted")).toHaveProperty("error");
    const future = benchmarkForm(); future.set("benchmarkDate", "2026-09-06");
    expect(await proposeSwimBenchmark(planId, 1, future)).toHaveProperty("error");
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
  });
});
