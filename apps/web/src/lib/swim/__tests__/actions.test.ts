import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { swimFixture, userId, planId, sessionId, receiptId } from "./fixtures";
import { completeSwimWorkoutResult, createSwimPlan, previewSwimPlan, startSwimWorkout, editSwimResult, decideSwimProposal, previewSwimResume, resumeSwimPlan, proposeSwimBenchmark, decideSwimBenchmark, skipSwimWorkout, previewSwimWeekEdit, applySwimWeekEdit, previewSwimDateEdit, applySwimDateEdit } from "../actions";
import { revalidatePath } from "next/cache";
import { SWIM_ASSESSMENT_VERSION, swimScheduleAdvice, type SwimWorkout } from "@hta/domain";
import { loadSwimStrengthContext } from "../strength-schedule";
import * as queries from "../queries";
import * as storage from "../storage";
import type { SwimDateEditInput, SwimHubView, SwimWeekEditInput } from "../view-types";
import { workoutPresentation } from "../presentation";
import { requireSwimSetup, requireSwimStorage } from "../capability";
import { assertSwimSafety } from "../safety";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import { swimPlanDefinition, swimWorkoutDefinition, type StandaloneWorkoutDefinition } from "../model";

const mock = vi.hoisted(() => ({
  user: { id: "00000000-0000-4000-8000-000000000001" } as { id: string } | null,
  client: { from: vi.fn() },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => mock.client,
  getAuthUser: async () => ({ data: { user: mock.user } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../strength-schedule", () => ({ loadSwimStrengthContext: vi.fn() }));
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

function weekEditInput(overrides: Partial<SwimWeekEditInput> = {}): SwimWeekEditInput {
  return {
    planId, revision: 1, week: 2,
    mainRepeats: swimPlanDefinition(swimFixture().plan).initialDose.mainRepeats + 1,
    reason: "Adjusting pool time.", ...overrides,
  };
}

function dateEditInput(overrides: Partial<SwimDateEditInput> = {}): SwimDateEditInput {
  return {
    planId, revision: 1, workoutId: swimFixture().workouts[2]!.id, workoutRevision: 1,
    date: "2026-09-15", reason: "Pool access changed.", ...overrides,
  };
}

function benchmarkForm() {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    time200: "3:20.000", time400: "7:00.000", verified: "on",
    benchmarkStroke: "freestyle", benchmarkDate: "2026-09-05",
  })) form.set(key, value);
  return form;
}

function mockSavedPlan() {
  const returnedPlan = { ...swimFixture().plan, revision: 7 };
  const view: SwimHubView = {
    id: returnedPlan.id, revision: returnedPlan.revision, status: returnedPlan.status,
    goal: "Technique & base", course: "25 yd", dates: "2026-09-07 – 2026-09-27", today: "2026-09-12",
    workouts: [], proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
  };
  vi.mocked(storage.updateSwimPlan).mockResolvedValueOnce({ plan: returnedPlan, workouts: [] });
  vi.spyOn(queries, "loadSwimHubView").mockImplementationOnce(async (_client, _userId, row) => {
    expect(row).toBe(returnedPlan);
    return view;
  });
  return view;
}

function mockSavedEdit() {
  let workout = { ...swimFixture().history[0]!.workout, revision: 1 };
  let notes: string | null = "Existing note";
  vi.mocked(storage.getSwimWorkout).mockImplementation(async () => workout);
  vi.mocked(storage.editSwimResult).mockImplementation(async (_client, input) => {
    workout = { ...workout, revision: workout.revision + 1 };
    if (input.notes !== undefined) notes = input.notes;
    mock.client.from.mockImplementation((table: string) => ({
      select: () => ({
        in: async () => ({ error: null, data: table === "sessions" ? [{
          id: sessionId, completed_at: "2026-09-07T12:20:00Z", deleted_at: null, notes,
        }] : [{ session_id: sessionId, swim_result: input.result }] }),
      }),
    }));
    return { workout, session_id: sessionId, cardio_log_id: receiptId, transitioned: false };
  });
  return workout;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadSwimStrengthContext).mockResolvedValue({ blockId: null, sessions: [] });
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
  it("DC-K4/DC-SW5 previews conflicts and explicitly moves only one swim while retaining issued work", async () => {
    const { plan, workouts } = swimFixture();
    const other = { ...workouts[3]!, scheduled_date: "2026-09-15" };
    vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts.map((row, index) => index === 3 ? other : row));
    const strengthContext = { blockId: "primary", sessions: [{ id: "strength", date: "2026-09-15" }] };
    vi.mocked(loadSwimStrengthContext).mockResolvedValue(strengthContext);
    const response = await previewSwimDateEdit(dateEditInput());
    expect(response.error).toBeUndefined();
    expect(response.preview).toMatchObject({ previousDate: "2026-09-14", date: "2026-09-15" });
    expect(response.preview!.warnings).toHaveLength(2);
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    const view = mockSavedPlan();
    expect(await applySwimDateEdit(response.preview!)).toEqual({ ok: true, view });
    const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
    expect(saved.definition).toEqual(plan.definition);
    expect(saved.workouts).toEqual([{
      id: workouts[2]!.id, expected_revision: 1, scheduled_date: "2026-09-15",
      slot: workouts[2]!.slot, definition: workouts[2]!.definition,
    }]);
    expect(saved.state.decisions.at(-1)).toMatchObject({
      id: response.preview!.id, kind: "schedule", decision: "overridden",
      inputSnapshot: { operation: "reschedule", previousDate: "2026-09-14", strengthContext, warnings: response.preview!.warnings },
    });
    expect(assertSwimSafety).toHaveBeenCalledTimes(2);
  });
  it.each(["2026-09-14", "2026-09-21", "2026-09-13", "2026-02-30", "not-a-date"])(
    "DC-SW3/DC-SW5 rejects unchanged or out-of-week date %s", async (date) => {
      expect(await previewSwimDateEdit(dateEditInput({ date }))).toMatchObject({ errorCode: "validation" });
      expect(storage.updateSwimPlan).not.toHaveBeenCalled();
    },
  );
  it.each(["paused", "finished", "archived"] as const)("DC-SW7 rejects moving a swim in a %s plan", async (status) => {
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...swimFixture().plan, status }]);
    expect(await previewSwimDateEdit(dateEditInput())).toMatchObject({ errorCode: "validation" });
  });
  it.each(["strength", "workout", "date", "limitation"] as const)("DC-SW5/DC-SW9 rejects %s changes since date preview", async (change) => {
    const result = await previewSwimDateEdit(dateEditInput());
    expect(result.preview).toBeDefined();
    if (change === "strength") vi.mocked(loadSwimStrengthContext).mockResolvedValue({ blockId: "new", sessions: [] });
    if (change === "workout") vi.mocked(storage.listSwimWorkouts).mockResolvedValue(swimFixture().workouts.map((row, index) => index === 2 ? { ...row, session_id: sessionId } : row));
    if (change === "date") result.preview!.date = "2026-09-16";
    if (change === "limitation") vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Review an active limitation."));
    expect(await applySwimDateEdit(result.preview!)).toHaveProperty("error");
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-K4/DC-SW5 previews an explicit week before any results, then saves only that reviewed week", async () => {
    const { plan, workouts } = swimFixture();
    const before = JSON.stringify({ plan, workouts });
    const result = await previewSwimWeekEdit(weekEditInput());
    expect(result.error).toBeUndefined();
    expect(result.ok).toBe(true);
    expect(result.preview).toMatchObject({ planId, week: 2, excludedCount: 0, plan: { workoutCount: 2 } });
    expect(result.preview!.warning).toBeTruthy();
    expect(result.preview!.changes.every((change) => change.before !== change.after)).toBe(true);
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
    const view = mockSavedPlan();
    expect(await applySwimWeekEdit(result.preview!)).toEqual({ ok: true, view });
    const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
    expect(saved.definition).toEqual(plan.definition);
    expect(saved.workouts.map((row) => row.id)).toEqual(workouts.slice(2, 4).map((row) => row.id));
    for (const update of saved.workouts) {
      const original = workouts.find((row) => row.id === update.id)!;
      expect(update.definition.original).toEqual(original.definition.original);
      expect(update.definition.modifications).toEqual([
        expect.objectContaining({ decisionId: result.preview!.id, reason: weekEditInput().reason, previous: original.definition.issued }),
      ]);
      expect(update.definition).toMatchObject({ provisional: false });
    }
    expect(saved.state.decisions.at(-1)).toMatchObject({
      id: result.preview!.id, kind: "progression", decision: "overridden",
      inputSnapshot: { manual: true, targetWeek: 1, appliedDose: { mainRepeats: weekEditInput().mainRepeats } },
    });
    expect(assertSwimSafety).toHaveBeenCalledTimes(2);
    expect(JSON.stringify({ plan, workouts })).toBe(before);
  });
  it("DC-SW5 excludes linked, non-scheduled and today's workouts from a manual week edit", async () => {
    const { workouts } = swimFixture();
    vi.mocked(storage.listSwimWorkouts).mockResolvedValue([
      { ...workouts[0]!, session_id: sessionId }, workouts[1]!, ...workouts.slice(2),
    ]);
    const result = await previewSwimWeekEdit(weekEditInput({ week: 1 }));
    expect(result.preview).toMatchObject({ excludedCount: 1, plan: { workoutCount: 1 } });
    expect(result.preview!.changes.map((change) => change.date)).toEqual([workouts[1]!.scheduled_date]);
    for (const status of ["started", "completed", "skipped"] as const) {
      vi.mocked(storage.listSwimWorkouts).mockResolvedValue([{ ...workouts[0]!, status }, { ...workouts[1]!, status }]);
      expect(await previewSwimWeekEdit(weekEditInput({ week: 1 }))).toMatchObject({ errorCode: "validation" });
    }
    vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts);
    vi.setSystemTime(new Date("2026-09-10T12:00:00Z"));
    expect(await previewSwimWeekEdit(weekEditInput({ week: 1 }))).toMatchObject({ errorCode: "validation" });
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
  });
  it.each(["started", "revised", "plan-revised", "tampered"] as const)("DC-SW5 rejects a %s manual preview at apply", async (change) => {
    const result = await previewSwimWeekEdit(weekEditInput());
    expect(result.preview).toBeDefined();
    if (change === "tampered") result.preview!.changes[0]!.after = "1 yd";
    else if (change === "plan-revised") vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...swimFixture().plan, revision: 2 }]);
    else vi.mocked(storage.listSwimWorkouts).mockResolvedValue(swimFixture().workouts.map((row, index) =>
      index === 2 ? { ...row, ...(change === "started" ? { status: "started" as const, session_id: sessionId } : { revision: 2 }) } : row));
    expect(await applySwimWeekEdit(result.preview!)).toMatchObject({ errorCode: "validation" });
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
  });
  it.each(["finished", "archived"] as const)("DC-SW7 rejects manual editing of a %s plan", async (status) => {
    vi.mocked(storage.listSwimPlans).mockResolvedValue([{ ...swimFixture().plan, status }]);
    expect(await previewSwimWeekEdit(weekEditInput())).toMatchObject({ errorCode: "validation" });
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-SW9 rechecks limitations on apply and retains a failed atomic-save result", async () => {
    const result = await previewSwimWeekEdit(weekEditInput());
    vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Review an active limitation."));
    expect(await applySwimWeekEdit(result.preview!)).toHaveProperty("error");
    expect(storage.updateSwimPlan).not.toHaveBeenCalled();
    vi.mocked(storage.updateSwimPlan).mockRejectedValueOnce(new Error("Workout changed.", { cause: { code: "40001" } }));
    expect(await applySwimWeekEdit(result.preview!)).toMatchObject({ errorCode: "validation" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each([{ mainRepeats: 0 }, { mainRepeats: 1.5 }, { mainRepeats: 2001 }, { reason: "" }, { week: 100 }, { revision: 0 }])(
    "DC-K4/DC-SW3 rejects invalid manual input %j", async (input) => {
      expect(await previewSwimWeekEdit(weekEditInput(input))).toMatchObject({ errorCode: "validation" });
      expect(storage.updateSwimPlan).not.toHaveBeenCalled();
    },
  );
  it.each([false, true])("DC-SW1/DC-SW2/DC-SW3 previews the exact saved prescriptions without writes (assessment=%s)", async (assessed) => {
    const form = setupForm();
    form.append("weekdays", "4");
    if (assessed) {
      form.set("comfortableLengths", "16");
      for (const [name, value] of benchmarkForm()) form.set(name, value);
    }
    const response = await previewSwimPlan(form);
    expect(response.ok).toBe(true);
    expect(response.planId).toBeUndefined();
    expect(response.preview).toMatchObject({ course: "25 yd", workoutCount: 6 });
    expect(response.preview!.weeks.map((week) => [week.week, week.startDate, week.provisional])).toEqual([
      [1, "2026-09-07", false], [2, "2026-09-14", true], [3, "2026-09-21", true],
    ]);
    expect(Object.values(storage).every((method) => vi.mocked(method).mock.calls.length === 0)).toBe(true);
    expect(revalidatePath).not.toHaveBeenCalled();
    expect(assertSwimSafety).toHaveBeenCalledOnce();

    expect(await createSwimPlan(form)).toEqual({ ok: true, planId });
    const saved = vi.mocked(storage.createSwimPlan).mock.calls[0]![1];
    const previewWorkouts = response.preview!.weeks.flatMap((week) => week.workouts);
    expect(previewWorkouts).toHaveLength(saved.workouts.length);
    expect(previewWorkouts.map(({ slotId, ...view }, index) => {
      expect(saved.workouts[index]!.definition).toMatchObject({ slotId });
      return view;
    })).toEqual(saved.workouts.map((row) => {
      const { title, total, budgetMinutes, calibrationLabel, steps } = workoutPresentation(row.definition.issued);
      return { date: row.scheduled_date, title, total, budgetMinutes, calibrationLabel, steps };
    }));
    expect(response.preview!.weeks.flatMap((week) => week.workouts.flatMap((workout) => workout.steps))
      .some((step) => step.pace !== undefined)).toBe(assessed);
    expect(assertSwimSafety).toHaveBeenCalledTimes(2);
  });
  it("DC-SW3 regenerates the preview from edited setup without saving a plan", async () => {
    const form = setupForm();
    const before = await previewSwimPlan(form);
    form.set("pool", "50m");
    form.set("weeks", "4");
    form.set("weekdays", "3");
    form.set("startDate", "2026-09-14");
    const after = await previewSwimPlan(form);
    expect(before.preview).toMatchObject({ course: "25 yd", workoutCount: 3 });
    expect(after.preview).toMatchObject({ course: "50 m", workoutCount: 4 });
    expect(after.preview!.weeks.flatMap((week) => week.workouts.map((workout) => workout.date))).toEqual([
      "2026-09-16", "2026-09-23", "2026-09-30", "2026-10-07",
    ]);
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-SW1/DC-SW3 includes the entire supported horizon and exact custom pool", async () => {
    const form = setupForm();
    form.set("pool", "custom"); form.set("poolLength", "33 1/3"); form.set("poolUnit", "m");
    form.set("weeks", "16");
    form.delete("weekdays");
    for (let day = 0; day < 7; day++) form.append("weekdays", String(day));
    const result = await previewSwimPlan(form);
    expect(result.ok).toBe(true);
    expect(result.preview!.weeks).toHaveLength(16);
    expect(result.preview!.workoutCount).toBe(112);
    expect(result.preview!.weeks.every((week) => week.workouts.length === 7)).toBe(true);
    expect(result.preview!.weeks[15]!.workouts[6]!.date).toBe("2026-12-27");
    expect(result.preview!.course).toBe("100/3 m");
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-SW9 rechecks current safety at save even after a successful preview", async () => {
    const form = setupForm();
    expect(await previewSwimPlan(form)).toHaveProperty("preview");
    vi.mocked(assertSwimSafety).mockRejectedValueOnce(new Error("Review an active limitation."));
    expect(await createSwimPlan(form)).toHaveProperty("error");
    expect(assertSwimSafety).toHaveBeenCalledTimes(2);
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-SW8 requires authentication and the setup capability for a preview", async () => {
    mock.user = null;
    expect(await previewSwimPlan(setupForm())).toHaveProperty("error");
    mock.user = { id: userId };
    vi.mocked(requireSwimSetup).mockRejectedValueOnce(new Error("Setup disabled"));
    expect(await previewSwimPlan(setupForm())).toHaveProperty("error");
    expect(assertSwimSafety).not.toHaveBeenCalled();
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-K4 returns current strength context for preview and rechecks it when saving", async () => {
    const form = setupForm();
    expect(await previewSwimPlan(form)).toHaveProperty("preview");
    const context = { blockId: "primary", sessions: [{ id: "strength", date: "2026-09-07" }] };
    vi.mocked(loadSwimStrengthContext).mockResolvedValue(context);
    expect(await previewSwimPlan(form)).toMatchObject({ errorCode: "validation", strengthContext: context });
    expect(await createSwimPlan(form)).toMatchObject({ errorCode: "validation", strengthContext: context });
    form.set("strengthOverlap", swimScheduleAdvice(context, "2026-09-07", 3, [1]).confirmationKey);
    expect(await previewSwimPlan(form)).toHaveProperty("preview");
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it.each([createSwimPlan, previewSwimPlan])("DC-SW2/DC-SW3 retains validation and learning guidance in %s", async (action) => {
    const form = setupForm();
    form.set("startDate", "2026-09-01");
    expect(await action(form)).toMatchObject({ errorCode: "validation" });
    form.set("startDate", "2026-09-07");
    for (const [name, value] of benchmarkForm()) form.set(name, value);
    form.set("benchmarkDate", "2026-09-06");
    expect(await action(form)).toMatchObject({ errorCode: "validation" });
    form.delete("time200"); form.delete("time400"); form.delete("verified"); form.delete("benchmarkDate");
    form.set("comfortableLengths", "0");
    expect(await action(form)).toHaveProperty("guidance");
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
  it("DC-K4 rechecks overlap on submit, rejects a tampered or stale acknowledgement, and audits current context", async () => {
    const context = { blockId: "primary", sessions: [{ id: "strength", date: "2026-09-07" }] };
    vi.mocked(loadSwimStrengthContext).mockResolvedValue(context);
    const form = setupForm();
    form.set("strengthOverlap", "on");
    expect(await createSwimPlan(form)).toMatchObject({ errorCode: "validation", strengthContext: context });
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
    form.set("strengthOverlap", swimScheduleAdvice(context, "2026-09-07", 3, [1]).confirmationKey);
    const changed = { ...context, blockId: "replacement" };
    vi.mocked(loadSwimStrengthContext).mockResolvedValue(changed);
    expect(await createSwimPlan(form)).toMatchObject({ errorCode: "validation", strengthContext: changed });
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
    form.set("strengthOverlap", swimScheduleAdvice(changed, "2026-09-07", 3, [1]).confirmationKey);
    expect(await createSwimPlan(form)).toEqual({ ok: true, planId });
    const saved = vi.mocked(storage.createSwimPlan).mock.calls[0]![1];
    expect(saved.state.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "schedule", decision: "overridden", inputSnapshot: expect.objectContaining({ strengthContext: changed, weekdays: [1] }) }),
    ]));
    expect(assertSwimSafety).toHaveBeenCalled();
    expect(saved.definition).toMatchObject({ schedule: { weekdays: [1] } });
  });
  it("DC-K4 fails closed when strength schedule cannot be read", async () => {
    vi.mocked(loadSwimStrengthContext).mockRejectedValue(new Error("Unavailable"));
    expect(await createSwimPlan(setupForm())).toHaveProperty("error");
    expect(storage.createSwimPlan).not.toHaveBeenCalled();
  });
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
    expect(await completeSwimWorkoutResult(actualForm())).toMatchObject({ ok: true,
      completion: { receiptId, workoutId: swimFixture().workouts[0]!.id, sessionId, userId } });
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
    expect(await completeSwimWorkoutResult(actualForm())).toMatchObject({ ok: true,
      completion: { receiptId, workoutId: swimFixture().workouts[0]!.id, sessionId, userId } });
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
    const returnedWorkout: storage.SwimWorkoutRow = {
      ...swimFixture().workouts[0]!, session_id: sessionId, status: "started", revision: 2,
    };
    const view = {
      ...workoutPresentation(returnedWorkout.definition.issued),
      id: returnedWorkout.id, revision: 2, sessionId, status: returnedWorkout.status,
      planStatus: "active" as const, date: returnedWorkout.scheduled_date,
      provisional: false, deleted: false, sourceGone: false, result: null,
    };
    vi.mocked(storage.getSwimWorkout).mockResolvedValue(returnedWorkout);
    vi.mocked(storage.startSwimWorkout).mockResolvedValueOnce(returnedWorkout);
    vi.spyOn(queries, "swimWorkoutViewFromRow").mockResolvedValueOnce(view);
    expect(await startSwimWorkout(returnedWorkout.id, 2)).toEqual({ ok: true, view });
    expect(storage.startSwimWorkout).toHaveBeenCalledOnce();
    expect(storage.startSwimWorkout).toHaveBeenCalledWith(mock.client, returnedWorkout.id, 2);
    expect(vi.mocked(queries.swimWorkoutViewFromRow).mock.calls[0]![2]).toBe(returnedWorkout);
  });
  it("routes a native result edit through its boundary and recomputes shared load", async () => {
    const existing = swimFixture().history[0]!.result!;
    vi.mocked(storage.getSwimResult).mockResolvedValue(existing);
    const workout = mockSavedEdit();
    expect(await editSwimResult(actualForm())).toEqual({
      ok: true, view: {
        ...workoutPresentation(workout.definition.issued),
        id: workout.id, revision: 2, sessionId, status: "completed", planStatus: "active",
        date: workout.scheduled_date, provisional: false, deleted: false, sourceGone: false, notes: "Easy",
        result: {
          lengths: 12, timeMs: 900123, rpe: 6, notes: "Easy", splits: "",
          stroke: "freestyle", strokes: ["freestyle"], equipment: [],
          course: "25 yd", distance: "300 yd", pool: existing.snapshot.course,
        },
      },
    });
    expect(storage.editSwimResult).toHaveBeenCalledOnce();
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
    expect(storage.getSwimWorkout).toHaveBeenCalledOnce();
  });
  it("requires a reason for a changed pool and retains that confirmed pool on later edits", async () => {
    const form = actualForm(); form.set("pool", "25m"); form.set("confirmPool", "on");
    expect(await completeSwimWorkoutResult(form)).toMatchObject({ errorCode: "validation" });
    expect(storage.completeSwimWorkout).not.toHaveBeenCalled();
    form.set("reason", "Different pool");
    expect(await completeSwimWorkoutResult(form)).toMatchObject({ ok: true,
      completion: { receiptId, workoutId: swimFixture().workouts[0]!.id, sessionId, userId } });
    const actual = vi.mocked(storage.completeSwimWorkout).mock.calls[0]![1].result;
    expect(actual.snapshot.course.unit).toBe("m");
    vi.mocked(storage.getSwimResult).mockResolvedValue(actual);
    const workout = mockSavedEdit();
    form.set("pool", "planned"); form.delete("confirmPool");
    expect(await editSwimResult(form)).toMatchObject({
      ok: true, view: { id: workout.id, revision: 2, sessionId, status: "completed", result: { pool: actual.snapshot.course } },
    });
    expect(storage.editSwimResult).toHaveBeenCalledWith(mock.client, expect.objectContaining({
      allowChangedCourse: true, result: expect.objectContaining({ snapshot: actual.snapshot }),
    }));
  });
  it("preserves omitted result-edit notes and distinguishes explicit clearing", async () => {
    vi.mocked(storage.getSwimResult).mockResolvedValue(swimFixture().history[0]!.result!);
    mockSavedEdit();
    const form = actualForm(); form.delete("notes");
    expect(await editSwimResult(form)).toMatchObject({ ok: true, view: { revision: 2, notes: "Existing note", result: { notes: "Existing note" } } });
    expect(vi.mocked(storage.editSwimResult).mock.calls[0]![1]).not.toHaveProperty("notes");
    form.set("expectedRevision", "2");
    form.set("notes", "");
    const cleared = await editSwimResult(form);
    expect(cleared).toMatchObject({ ok: true, view: { revision: 3, status: "completed" } });
    expect(cleared.view).not.toHaveProperty("notes");
    expect(cleared.view?.result).not.toHaveProperty("notes");
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
    const view = mockSavedPlan();
    expect(await decideSwimProposal(plan.id, plan.revision, candidate.id, "accepted")).toEqual({ ok: true, view });
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
  it.each(["provisional", "confirmed", "started", "past", "today"] as const)(
    "DC-SW4/DC-SW5 accepts a key-reordered HOLD with a %s target without fabricating history",
    async (targetState) => {
      vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
      const { plan, workouts, history } = swimFixture();
      const persisted = workouts.map((row, index): storage.SwimWorkoutRow => {
        const { sections, snapshot, budget, ...issued } = row.definition.issued;
        const reordered: SwimWorkout = {
          ...issued,
          budget: { accountedMs: budget.accountedMs, minutes: budget.minutes },
          snapshot: {
            ...snapshot,
            course: { unit: snapshot.course.unit, denominator: snapshot.course.denominator, numerator: snapshot.course.numerator },
            versions: { assessment: snapshot.versions.assessment, generator: snapshot.versions.generator, model: snapshot.versions.model },
          },
          sections: sections.map(({ items, ...section }) => ({
            items: items.map(({ equipment, ...item }) => ({ equipment, ...item })), ...section,
          })),
        };
        expect(reordered).toEqual(row.definition.issued);
        expect(JSON.stringify(reordered)).not.toBe(JSON.stringify(row.definition.issued));
        expect(Object.keys(reordered.snapshot.course)).not.toEqual(Object.keys(snapshot.course));
        expect(Object.keys(reordered.sections[0]!.items[0]!)).not.toEqual(Object.keys(sections[0]!.items[0]!));
        const definition: StandaloneWorkoutDefinition = {
          ...swimWorkoutDefinition(row), issued: reordered,
          provisional: index === 2 && targetState === "confirmed" ? false : swimWorkoutDefinition(row).provisional,
          modifications: index === 3 ? [{
            id: receiptId, recordedAt: plan.created_at, decisionId: planId, reason: "Earlier decision",
            previous: row.definition.original,
          }] : [],
        };
        return {
          ...row,
          ...(index === 2 && targetState === "started" ? { session_id: sessionId, status: "started" } : {}),
          ...(index === 2 && targetState === "past" ? { scheduled_date: "2026-09-11" } : {}),
          ...(index === 2 && targetState === "today" ? { scheduled_date: "2026-09-12" } : {}),
          definition,
        };
      });
      const plateau = history.map((row, index) => ({
        ...row, workout: index < 2 ? { ...persisted[index]!, status: row.workout.status, session_id: row.workout.session_id } : persisted[index]!,
        result: row.result ? { ...row.result, rpe: null } : null,
      }));
      const before = structuredClone({ persisted, plateau, plan });
      vi.mocked(storage.listSwimWorkouts).mockResolvedValue(persisted);
      vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(plateau);
      const candidate = queries.deriveSwimWeekCandidate(plan, plateau, "2026-09-12")!;
      expect(candidate.proposal.decision).toBe("hold");
      const view = mockSavedPlan();
      expect(await decideSwimProposal(plan.id, plan.revision, candidate.id, "accepted")).toEqual({ ok: true, view });
      expect(storage.updateSwimPlan).toHaveBeenCalledOnce();
      const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
      expect(saved.workouts.map((row) => row.id)).toEqual(
        (targetState === "provisional" ? persisted.slice(2, 4) : persisted.slice(3, 4)).map((row) => row.id),
      );
      for (const update of saved.workouts) {
        const prior = persisted.find((row) => row.id === update.id)!;
        expect(update).toEqual({
          id: prior.id, expected_revision: prior.revision, scheduled_date: prior.scheduled_date, slot: prior.slot,
          definition: { ...prior.definition, provisional: false },
        });
        expect(update.definition.modifications).toEqual(prior.definition.modifications);
      }
      expect(saved.state.decisions).toHaveLength(1);
      expect(saved.state.decisions[0]).toMatchObject({ id: candidate.id, decision: "accepted" });
      expect({ persisted, plateau, plan }).toEqual(before);
    },
  );
  it.each(["dose", "array content", "array order"] as const)(
    "DC-SW5 records exactly one prior issued snapshot for a real %s change",
    async (change) => {
      vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
      const { plan, workouts, history } = swimFixture();
      const target = workouts[3]!;
      if (change === "array content") {
        target.definition = {
          ...target.definition,
          issued: {
            ...target.definition.issued,
            snapshot: { ...target.definition.issued.snapshot, equipment: ["fins"] },
            sections: target.definition.issued.sections.map((section) => ({
              ...section, items: section.items.map((item) => ({ ...item, equipment: ["fins"] })),
            })),
          },
        };
      } else if (change === "array order") {
        target.definition = { ...target.definition, issued: {
          ...target.definition.issued, sections: [...target.definition.issued.sections].reverse(),
        } };
      }
      target.definition.modifications = [{
        id: receiptId, recordedAt: plan.created_at, decisionId: planId, reason: "Earlier decision",
        previous: target.definition.original,
      }];
      const settled = history.map((row) => ({
        ...row, result: row.result ? { ...row.result, rpe: change === "dose" ? 5 : 7 } : null,
      }));
      const before = structuredClone({ workouts, settled, plan });
      vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts);
      vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(settled);
      const candidate = queries.deriveSwimWeekCandidate(plan, settled, "2026-09-12")!;
      const expected = candidate.generated.weeks[1]!.slots.find((slot) => slot.slotId === swimWorkoutDefinition(target).slotId)!;
      if (expected.kind !== "workout") throw new Error("Expected workout");
      expect(expected.issued).not.toEqual(target.definition.issued);
      if (change === "dose") expect(expected.issued.totalLengths).toBeGreaterThan(target.definition.issued.totalLengths);
      else expect(expected.issued.totalLengths).toBe(target.definition.issued.totalLengths);
      const view = mockSavedPlan();
      expect(await decideSwimProposal(plan.id, plan.revision, candidate.id, "accepted")).toEqual({ ok: true, view });
      expect(storage.updateSwimPlan).toHaveBeenCalledOnce();
      const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
      expect(saved.workouts.map((row) => row.id)).toEqual(workouts.slice(2, 4).map((row) => row.id));
      const update = saved.workouts.find((row) => row.id === target.id)!;
      expect(update.definition.issued).toEqual(expected.issued);
      expect(update.definition.original).toEqual(target.definition.original);
      expect(update.expected_revision).toBe(target.revision);
      expect(update.definition).toHaveProperty("provisional", false);
      expect(update.definition.modifications).toEqual([
        ...target.definition.modifications,
        { id: expect.any(String), recordedAt: new Date().toISOString(), decisionId: candidate.id,
          reason: `Week 2: ${candidate.proposal.decision}`, previous: target.definition.issued },
      ]);
      expect(saved.state.decisions[0]).toMatchObject({ id: candidate.id, decision: "accepted" });
      expect({ workouts, settled, plan }).toEqual(before);
    },
  );
  it("rejects a week without touching any future prescriptions", async () => {
    vi.setSystemTime(new Date("2026-09-12T12:00:00Z"));
    const { plan, history } = swimFixture();
    vi.spyOn(queries, "loadSwimHistory").mockResolvedValue(history);
    const candidate = queries.deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    const view = mockSavedPlan();
    expect(await decideSwimProposal(plan.id, plan.revision, candidate.id, "rejected")).toEqual({ ok: true, view });
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
    const view = mockSavedPlan();
    const result = await decideSwimProposal(plan.id, plan.revision, candidate.id, "overridden", String(repeats), "More repeats");
    expect(result.ok).toBe(true);
    expect(result.warning).toBeTruthy();
    expect(result.view).toBe(view);
    expect(result).not.toHaveProperty("refreshWarning");
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
    vi.mocked(storage.listSwimPlans)
      .mockResolvedValueOnce([paused])
      .mockResolvedValueOnce([paused])
      .mockResolvedValueOnce([paused]);
    const result = await previewSwimResume(plan.id, 1, "2026-10-01");
    expect(result.preview?.dates).toHaveLength(4);
    expect(result.preview?.dates.every((row) => row.date >= "2026-10-01")).toBe(true);
    expect(result.preview?.dates.map((row) => row.id)).not.toContain(workouts[0]!.id);
    expect(storage.resumeSwimPlan).not.toHaveBeenCalled();
    const resumed: storage.SwimPlanWithWorkouts = {
      plan: {
        ...plan, status: "active", revision: plan.revision + 1,
        ends_on: result.preview!.dates.at(-1)!.date, updated_at: new Date().toISOString(),
      },
      workouts: workouts.map((row) => {
        const date = result.preview!.dates.find((entry) => entry.id === row.id);
        return date ? {
          ...row, scheduled_date: date.date, revision: row.revision + 1, updated_at: new Date().toISOString(),
        } : row;
      }),
    };
    const view: SwimHubView = {
      id: resumed.plan.id, revision: resumed.plan.revision, status: resumed.plan.status,
      goal: "Technique & base", course: "25 yd",
      dates: `${resumed.plan.started_on} – ${resumed.plan.ends_on}`, today: "2026-09-12",
      workouts: [], proposals: [], analytics: { weeks: [], bests: [], benchmarks: [] },
    };
    vi.mocked(storage.resumeSwimPlan).mockResolvedValueOnce(resumed);
    const loadView = vi.spyOn(queries, "loadSwimHubView").mockResolvedValueOnce(view);
    expect(await resumeSwimPlan(result.preview!)).toEqual({ ok: true, view });
    expect(storage.resumeSwimPlan).toHaveBeenCalledOnce();
    expect(loadView).toHaveBeenCalledOnce();
    expect(loadView).toHaveBeenCalledWith(mock.client, userId, resumed.plan);
    expect(loadView.mock.calls[0]![2]).toBe(resumed.plan);
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
    const view = mockSavedPlan();
    expect(await decideSwimBenchmark(plan.id, proposed.preview!, "accepted")).toEqual({ ok: true, view });
    const saved = vi.mocked(storage.updateSwimPlan).mock.calls[0]![1];
    expect(saved.state.observations).toEqual([proposed.preview!.observation]);
    expect(saved.state.acceptedCalibration).toHaveProperty("unit", "yd");
    expect(saved.state.decisions[0]).toMatchObject({ decision: "accepted", ruleVersion: SWIM_ASSESSMENT_VERSION });
    expect(saved.workouts).toHaveLength(3);
    expect(saved.workouts.every((row) => row.id !== workouts[2]!.id && row.scheduled_date > "2026-09-12")).toBe(true);
    expect(saved.workouts.every((row) => row.definition.modifications.length === 1)).toBe(true);
    for (const update of saved.workouts) {
      const prior = workouts.find((row) => row.id === update.id)!;
      expect(update.definition.issued.sections).not.toEqual(prior.definition.issued.sections);
      expect(update.definition.issued.sections.some((section) =>
        section.items.some((item) => item.targetMsPerRepeat !== undefined))).toBe(true);
      expect(update.definition.original).toEqual(prior.definition.original);
      expect(update.expected_revision).toBe(prior.revision);
      expect(update.definition.modifications[0]).toEqual({
        id: expect.any(String), recordedAt: new Date().toISOString(), decisionId: saved.state.decisions[0]!.id,
        reason: "Accepted assessment", previous: prior.definition.issued,
      });
    }
    expect(assertSwimSafety).toHaveBeenCalledOnce();
  });
  it("retains a rejected assessment without changing pace targets or requiring new safety clearance", async () => {
    const proposed = await proposeSwimBenchmark(planId, 1, benchmarkForm());
    const view = mockSavedPlan();
    expect(await decideSwimBenchmark(planId, proposed.preview!, "rejected")).toEqual({ ok: true, view });
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
