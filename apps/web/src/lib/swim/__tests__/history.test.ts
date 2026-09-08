import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeSwimWeek } from "@hta/domain";
import { deriveSwimWeekCandidate, loadSwimHistory, loadSwimWorkoutView, settledSwimResult, swimWorkoutViewFromRow } from "../queries";
import { getSwimWorkout, listSwimPlans } from "../storage";
import { workoutPresentation } from "../presentation";
import { swimWorkoutDefinition } from "../model";
import { swimFixture, sessionId, userId } from "./fixtures";

vi.mock("../storage", () => ({
  getSwimWorkout: vi.fn(), listSwimPlans: vi.fn(), listSwimWorkouts: vi.fn(),
}));

function historyClient(result: unknown, sessionNotes: string | null = "Latest session note") {
  return {
    from: (table: string) => ({
      select: () => ({
        in: async () => ({ error: null, data: table === "sessions" ? [{
          id: sessionId, performed_at: "2026-09-07T12:00:00Z", completed_at: "2026-09-07T12:20:00Z",
          deleted_at: null, notes: sessionNotes,
        }] : [{ session_id: sessionId, swim_result: result, notes: "Earlier cardio note" }] }),
      }),
    }),
  };
}

describe("ADR0079 authoritative swim history", () => {
  it("excludes hard-purged sources rather than inventing missed swims", async () => {
    const { plan, workouts } = swimFixture();
    const rows = workouts.map((row, index) => index < 2 ? { ...row, status: "completed" as const, session_id: null } : row);
    const from = vi.fn();
    const history = await loadSwimHistory({ from } as never, rows);
    expect(from).not.toHaveBeenCalled();
    expect(history.slice(0, 2).every((row) => row.sourceGone && !row.deleted)).toBe(true);
    expect(history[0]!.workout.definition).toEqual(workouts[0]!.definition);
    const candidate = deriveSwimWeekCandidate(plan, history, "2026-09-12")!;
    expect(candidate.proposal.decision).toBe("hold");
    expect(candidate.proposal.snapshot.missedSessions).toBe(0);
    expect(candidate.proposal.snapshot.excludedResults.map((entry) => entry.result.workoutId)).toEqual(workouts.slice(0, 2).map((row) => row.id));
    const week = summarizeSwimWeek({ weekStartISO: "2026-09-07", results: history.map((row) => settledSwimResult(row, plan)) });
    expect(week.sessionsPlanned).toBe(0);
    expect(week.adherence).toBeNull();
  });

  describe("DC-SW5/SW7 canonical workout row projection", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      vi.mocked(listSwimPlans).mockResolvedValue([swimFixture().plan]);
    });

    it("loads once and matches the row projection without a second workout read", async () => {
      const row = swimFixture().workouts[0]!;
      vi.mocked(getSwimWorkout).mockResolvedValue(row);
      const client = { from: vi.fn() };
      const view = await swimWorkoutViewFromRow(client as never, userId, row);
      expect(getSwimWorkout).not.toHaveBeenCalled();
      expect(view).toEqual({
        ...workoutPresentation(row.definition.issued),
        id: row.id, revision: row.revision, sessionId: null, status: "scheduled",
        planStatus: "active", date: row.scheduled_date, provisional: swimWorkoutDefinition(row).provisional,
        deleted: false, sourceGone: false, result: null,
      });
      expect(await loadSwimWorkoutView(client as never, userId, row.id)).toEqual(view);
      expect(getSwimWorkout).toHaveBeenCalledOnce();
      expect(getSwimWorkout).toHaveBeenCalledWith(client, row.id);
      expect(client.from).not.toHaveBeenCalled();
    });

    it.each(["missing", "foreign"] as const)("retains %s workout handling before plan/history reads", async (kind) => {
      const row = { ...swimFixture().workouts[0]!, user_id: "another-user" };
      const client = { from: vi.fn() };
      vi.mocked(getSwimWorkout).mockResolvedValue(kind === "missing" ? null : row);
      expect(await loadSwimWorkoutView(client as never, userId, row.id)).toBeNull();
      if (kind === "foreign") expect(await swimWorkoutViewFromRow(client as never, userId, row)).toBeNull();
      expect(listSwimPlans).not.toHaveBeenCalled();
      expect(client.from).not.toHaveBeenCalled();
    });

    it.each(["missing", "foreign", "unrelated"] as const)("retains %s plan handling without reading history", async (kind) => {
      const { plan, workouts } = swimFixture();
      const row = { ...workouts[0]!, status: "started" as const, session_id: sessionId };
      vi.mocked(getSwimWorkout).mockResolvedValue(row);
      vi.mocked(listSwimPlans).mockResolvedValue(kind === "missing" ? [] : [{
        ...plan, ...(kind === "foreign" ? { user_id: "another-user" } : { id: "another-plan" }),
      }]);
      const client = { from: vi.fn() };
      expect(await swimWorkoutViewFromRow(client as never, userId, row)).toBeNull();
      expect(await loadSwimWorkoutView(client as never, userId, row.id)).toBeNull();
      expect(client.from).not.toHaveBeenCalled();
    });

    it.each(["started", "completed", "deleted", "restored", "sourceGone", "purged"] as const)(
      "preserves session/log/result and %s projection equivalence", async (state) => {
        const { history, plan } = swimFixture();
        const row = {
          ...history[0]!.workout, revision: 7,
          status: state === "started" ? "started" as const : "completed" as const,
          session_id: state === "purged" ? null : sessionId,
        };
        const result = {
          ...history[0]!.result!, lengths: 12, timeMs: 900123,
          snapshot: { ...history[0]!.result!.snapshot, course: { numerator: 25, denominator: 1, unit: "m" as const }, strokes: ["backstroke" as const], equipment: ["fins" as const] },
          splits: [{ lengths: 4, timeMs: 300123 }],
          provenance: { ...history[0]!.result!.provenance, deviationReason: "Different pool" },
        };
        const inSessions = vi.fn().mockResolvedValue({ error: null, data: state === "sourceGone" ? [] : [{
          id: sessionId, performed_at: "2026-09-07T12:00:00Z",
          completed_at: state === "started" ? null : "2026-09-07T12:20:00Z",
          deleted_at: state === "deleted" ? "2026-09-08T12:00:00Z" : null, notes: "Latest session note",
        }] });
        const inLogs = vi.fn().mockResolvedValue({ error: null, data: [
          { session_id: "unrelated", swim_result: { invalid: true } },
          { session_id: sessionId, swim_result: null, notes: "Generic log" },
          { session_id: sessionId, swim_result: result, notes: "Earlier cardio note" },
        ] });
        const client = { from: vi.fn((table: string) => ({ select: () => ({ in: table === "sessions" ? inSessions : inLogs }) })) };
        vi.mocked(listSwimPlans).mockResolvedValue([{ ...plan, status: "archived" }]);
        vi.mocked(getSwimWorkout).mockResolvedValue(row);
        const view = await swimWorkoutViewFromRow(client as never, userId, row);
        expect(getSwimWorkout).not.toHaveBeenCalled();
        expect(view).toEqual({
          ...workoutPresentation(row.definition.issued),
          id: row.id, revision: 7, sessionId: row.session_id, status: row.status,
          planStatus: "archived", date: row.scheduled_date, provisional: swimWorkoutDefinition(row).provisional,
          deleted: state === "deleted", sourceGone: state === "sourceGone" || state === "purged",
          ...(state === "purged" ? {} : { notes: state === "sourceGone" ? "Earlier cardio note" : "Latest session note" }),
          result: ["started", "sourceGone", "purged"].includes(state) ? null : {
            lengths: 12, timeMs: 900123, rpe: 5, notes: "Latest session note", reason: "Different pool",
            splits: "4, 5:00.123", stroke: "backstroke", equipment: ["fins"], strokes: ["backstroke"],
            course: "25 m", distance: "300 m", pool: result.snapshot.course,
          },
        });
        expect(await loadSwimWorkoutView(client as never, userId, row.id)).toEqual(view);
        expect(getSwimWorkout).toHaveBeenCalledOnce();
        if (state === "purged") expect(client.from).not.toHaveBeenCalled();
        else {
          expect(inSessions).toHaveBeenCalledWith("id", [sessionId]);
          expect(inLogs).toHaveBeenCalledWith("session_id", [sessionId]);
        }
      },
    );

    it.each(["", null])("preserves an explicit session note clear (%s)", async (notes) => {
      const { history } = swimFixture();
      const row = history[0]!.workout;
      const result = { ...history[0]!.result!, rpe: null };
      const client = historyClient(result, notes);
      vi.mocked(getSwimWorkout).mockResolvedValue(row);
      const view = await swimWorkoutViewFromRow(client as never, userId, row);
      expect(await loadSwimWorkoutView(client as never, userId, row.id)).toEqual(view);
      if (notes === "") expect(view?.notes).toBe("");
      else expect(view).not.toHaveProperty("notes");
      expect(view?.result).not.toHaveProperty("notes");
      expect(view?.result).not.toHaveProperty("rpe");
      expect(view?.result).not.toHaveProperty("reason");
      expect(view?.result?.splits).toBe("");
    });

    it.each(["plan", "sessions", "cardio_logs", "malformed", "missing-result"] as const)(
      "propagates %s failures through both projection entry points", async (failure) => {
        const row = swimFixture().history[0]!.workout;
        vi.mocked(getSwimWorkout).mockResolvedValue(row);
        if (failure === "plan") vi.mocked(listSwimPlans).mockRejectedValue(new Error("Plan read failed"));
        const client = { from: (table: string) => ({ select: () => ({ in: async () => ({
          error: table === failure ? new Error("History read failed") : null,
          data: table === "sessions" ? [{ id: sessionId, completed_at: "2026-09-07T12:20:00Z" }]
            : [{ session_id: sessionId, swim_result: failure === "malformed" ? { invalid: true } : null }],
        }) }) }) };
        const message = failure === "plan" ? "Plan read failed" : failure === "malformed"
          ? "Invalid swimming history" : failure === "missing-result" ? "saved swim result" : "Could not read your swim history";
        await expect(swimWorkoutViewFromRow(client as never, userId, row)).rejects.toThrow(message);
        await expect(loadSwimWorkoutView(client as never, userId, row.id)).rejects.toThrow(message);
      },
    );

    it("propagates the loader's workout-read error without reading the plan", async () => {
      vi.mocked(getSwimWorkout).mockRejectedValueOnce(new Error("Workout read failed"));
      await expect(loadSwimWorkoutView({} as never, userId, "workout")).rejects.toThrow("Workout read failed");
      expect(listSwimPlans).not.toHaveBeenCalled();
    });
  });
  it("decodes native results and prefers the current session note", async () => {
    const { workouts, history: fixture } = swimFixture();
    const row = { ...workouts[0]!, status: "completed" as const, session_id: sessionId };
    const [history] = await loadSwimHistory(historyClient(fixture[0]!.result) as never, [row]);
    expect(history!.result).toEqual(fixture[0]!.result);
    expect(history!.notes).toBe("Latest session note");
    expect(history!.sourceGone).toBe(false);
    const [cleared] = await loadSwimHistory(historyClient(fixture[0]!.result, "") as never, [row]);
    expect(cleared!.notes).toBe("");
  });
  it("preserves an explicit session-note clear instead of reviving the earlier cardio note", async () => {
    const { history } = swimFixture();
    const [cleared] = await loadSwimHistory(historyClient(history[0]!.result, null) as never, [history[0]!.workout]);
    expect(cleared!.notes).toBeNull();
  });
  it.each([0, { version: 1, lengths: 2 }])("fails loudly for malformed structured actuals", async (result) => {
    const row = { ...swimFixture().workouts[0]!, status: "completed" as const, session_id: sessionId };
    await expect(loadSwimHistory(historyClient(result) as never, [row])).rejects.toThrow("Invalid swimming history");
  });
  it("does not turn a missing result on a retained completed session into a miss", async () => {
    const row = { ...swimFixture().workouts[0]!, status: "completed" as const, session_id: sessionId };
    await expect(loadSwimHistory(historyClient(null) as never, [row])).rejects.toThrow("saved swim result");
  });
});
