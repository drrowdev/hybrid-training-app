import { describe, expect, it, vi } from "vitest";
import { summarizeSwimWeek } from "@hta/domain";
import { deriveSwimWeekCandidate, loadSwimHistory, settledSwimResult } from "../queries";
import { swimFixture, sessionId } from "./fixtures";

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
