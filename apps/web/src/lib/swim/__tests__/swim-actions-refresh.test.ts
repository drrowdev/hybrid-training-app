import { beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import { startSwimWorkout, changeSwimPlanStatus, editSwimResult, completeSwimWorkoutResult, skipSwimWorkout } from "../actions";
import * as storage from "../storage";
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
}));

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
  mock.user = { id: userId };
  const { plan, workouts, history } = swimFixture();
  const workout = { ...workouts[0]!, session_id: sessionId, status: "started" as const };
  const query = { select: vi.fn(), in: vi.fn() };
  query.select.mockReturnValue(query);
  query.in.mockResolvedValue({ data: [{ id: receiptId, slug: "swim-easy" }], error: null });
  mock.client.from.mockReturnValue(query);
  vi.mocked(storage.getSwimWorkout).mockResolvedValue(workout);
  vi.mocked(storage.listSwimPlans).mockResolvedValue([plan]);
  vi.mocked(storage.listSwimWorkouts).mockResolvedValue(workouts);
  vi.mocked(storage.getSwimResult).mockResolvedValue(history[0]!.result!);
  vi.mocked(storage.startSwimWorkout).mockResolvedValue(workout);
  vi.mocked(storage.setSwimPlanStatus).mockResolvedValue({ ...plan, status: "paused" });
  const reply = { workout, session_id: sessionId, cardio_log_id: receiptId, transitioned: false };
  vi.mocked(storage.editSwimResult).mockResolvedValue(reply);
  vi.mocked(storage.completeSwimWorkout).mockResolvedValue(reply);
  vi.mocked(recomputeAfterCompletedSessionMutation).mockResolvedValue({ recomputed: true });
});

const actions = [
  { name: "Start", call: () => startSwimWorkout(swimFixture().workouts[0]!.id, 1), mutation: storage.startSwimWorkout },
  { name: "Plan status", call: () => changeSwimPlanStatus(planId, 1, "paused"), mutation: storage.setSwimPlanStatus },
  { name: "Edit", call: () => editSwimResult(actualForm()), mutation: storage.editSwimResult },
];

describe.each(actions)("$name post-save refresh boundary", ({ name, call, mutation }) => {
  it("returns confirmed success and a nonempty warning when cache refresh throws, without retrying", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Cache unavailable"); });
    const result = await call();
    expect(result).toEqual({ ok: true, warning: expect.stringMatching(/\S/) });
    expect(mutation).toHaveBeenCalledOnce();
    expect(revalidatePath).toHaveBeenCalledOnce();
    expect(vi.mocked(mutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    if (name === "Edit") {
      expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledOnce();
      expect(vi.mocked(recomputeAfterCompletedSessionMutation).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(revalidatePath).mock.invocationCallOrder[0]!);
    }
  });

  it("returns success without a warning after normal refresh", async () => {
    expect(await call()).toEqual({ ok: true });
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
  });

  it("preserves auth failure without mutation or warning", async () => {
    mock.user = null;
    expect(await call()).toEqual({ error: "Sign in to save your swim.", errorCode: "auth" });
    expect(mutation).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
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
