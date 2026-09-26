import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingCommitment } from "@hta/domain";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), unavailable: false,
  targetStarted: false, sourceStarted: false, completed: true,
  entries: [] as TrainingCommitment[],
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    if (mock.unavailable) throw new Error("private connection detail; digest: 12345");
    return { rpc: mock.rpc, from: mock.from };
  },
  getAuthUser: async () => ({ data: { user: { id: "owner" } } }),
}));
import { movePlannedSession, previewPlannedMove, skipPlannedSession, unskipPlannedSession } from "../actions";
import { markExternalCardioComplete, updatePlannedSessionNotes } from "@/lib/sessions/actions";
import { addPlannedMovement, removePlannedMovement, swapPlannedMovement } from "@/lib/sessions/planned-movement-actions";
import { setHyroxStationOverride } from "@/lib/hyrox/station-swap-actions";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const target = { id, weekIndex: 4, dayIndex: 4 };
function form(values: Record<string, string | number> = target) {
  const data = new FormData();
  Object.entries(values).forEach(([key, value]) => data.set(key, String(value)));
  return data;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-26T12:00:00Z"));
  vi.spyOn(console, "error").mockImplementation(() => {});
  mock.unavailable = false; mock.targetStarted = false; mock.sourceStarted = false; mock.completed = true;
  mock.entries = [];
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "training_schedule_snapshot" ? { revision: "a".repeat(32), entries: mock.entries } : { id },
    error: null,
  }));
  mock.from.mockReset().mockImplementation((table: string) => {
    const filters = new Map<string, unknown>();
    const query = {
      select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(),
    };
    query.select.mockReturnValue(query);
    query.is.mockReturnValue(query);
    query.eq.mockImplementation((key: string, value: unknown) => { filters.set(key, value); return query; });
    query.maybeSingle.mockImplementation(async () => ({
      error: null,
      data: table === "training_blocks" ? { started_on: "2026-08-24", weeks: 6 }
        : table === "sessions" ? { completed_at: mock.completed ? "2026-09-26T10:00:00Z" : null }
        : filters.has("id") ? { id, block_id: "block", week_index: 4, day_index: 5, slot: "single",
          completed_session_id: mock.sourceStarted ? "source-session" : null }
        : { id: otherId, completed_session_id: mock.targetStarted ? "target-session" : null },
    }));
    return query;
  });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe("DC-K4: drawer moves preserve explicit scheduling and return typed failures", () => {
  it("allows yesterday within the program, previewing and committing the same dates", async () => {
    const preview = await previewPlannedMove(target);
    expect(preview).toMatchObject({ dates: ["2026-09-25", "2026-09-26"], overlaps: [] });
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(await movePlannedSession(form())).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenLastCalledWith("independent_program_schedule_commit", expect.objectContaining({
      p_operation: "primary-move", p_args: target, p_accept_overlap: false,
    }));
  });
  it.each([true, false])("rejects an already-started target (finished=%s) without writing", async (completed) => {
    mock.targetStarted = true; mock.completed = completed;
    const preview = await previewPlannedMove(target);
    expect(preview.error).toMatch(completed ? /finished workout/i : /in progress/i);
    expect(await movePlannedSession(form())).toEqual({ error: preview.error });
    expect(mock.rpc.mock.calls.every(([name]) => name === "training_schedule_snapshot")).toBe(true);
  });
  it("does not move an already-started source or an invalid date", async () => {
    mock.sourceStarted = true;
    expect(await previewPlannedMove(target)).toMatchObject({ error: expect.any(String) });
    mock.sourceStarted = false;
    expect(await movePlannedSession(form({ ...target, weekIndex: -1 }))).toMatchObject({ error: expect.any(String) });
    expect(await previewPlannedMove({ ...target, weekIndex: 6 })).toMatchObject({ error: expect.any(String) });
    expect(mock.rpc.mock.calls.every(([name]) => name === "training_schedule_snapshot")).toBe(true);
  });
  it("requires overlap consent and preserves it in the existing atomic commit", async () => {
    mock.entries = [{ id: "swim", source: "swim", programId: "pool", title: "Swim",
      date: "2026-09-25", state: "scheduled" }];
    expect(await movePlannedSession(form())).toMatchObject({ error: expect.any(String) });
    const preview = await previewPlannedMove(target);
    if (preview.error !== undefined) throw new Error(preview.error);
    const data = form();
    data.set("scheduleReview", JSON.stringify({ revision: preview.revision, requestId: preview.requestId, acceptOverlap: true }));
    expect(await movePlannedSession(data)).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenLastCalledWith("independent_program_schedule_commit", expect.objectContaining({ p_accept_overlap: true }));
  });
  it("returns malformed review and commit failures, never raw SQL or render details", async () => {
    const data = form(); data.set("scheduleReview", "not-json");
    expect(await movePlannedSession(data)).toMatchObject({ error: expect.any(String) });
    mock.rpc.mockResolvedValue({ data: null, error: { message: "SQL private table; digest: 54321" } });
    for (const action of [movePlannedSession, skipPlannedSession, unskipPlannedSession]) {
      const result = await action(form());
      expect(result.error).toBeTruthy();
      expect(result.error).not.toMatch(/SQL|private|digest/);
    }
  });
  it("returns typed success for skip and unskip", async () => {
    expect(await skipPlannedSession(form())).toEqual({ ok: true });
    expect(await unskipPlannedSession(form())).toEqual({ ok: true });
  });
});

describe("drawer action boundaries", () => {
  it("contains unexpected failures for move, swap preview, mark done, skip, unskip, notes and every editor", async () => {
    mock.unavailable = true;
    const edit = form({ plannedSessionId: id, movementId: otherId, newMovementId: id,
      expectedRevision: "0", stationKey: "ski_erg", itemIndex: 0 });
    const results = await Promise.all([
      movePlannedSession(form()), previewPlannedMove(target), skipPlannedSession(form()), unskipPlannedSession(form()),
      markExternalCardioComplete(edit), updatePlannedSessionNotes(id, "Keep this note"),
      addPlannedMovement(edit), removePlannedMovement(edit), swapPlannedMovement(edit), setHyroxStationOverride(edit),
    ]);
    for (const result of results) {
      expect(result.error).toBeTruthy();
      expect(result.error).not.toMatch(/private|digest|Server Components/);
    }
    expect(mock.rpc).not.toHaveBeenCalled();
  });
});
