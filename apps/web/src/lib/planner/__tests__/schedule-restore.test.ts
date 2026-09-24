import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingCommitment } from "@hta/domain";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(),
  revision: "a".repeat(32), entries: [] as TrainingCommitment[],
  user: { id: "11111111-2222-4222-8222-222222222222" } as { id: string } | null,
  block: { id: "11111111-1111-4111-8111-111111111111", started_on: "2026-09-14", status: "active", deleted_at: "2026-09-14" as string | null },
  rows: [] as { id: string; block_id: string; week_index: number; day_index: number; role: string; completed_session_id: string | null; skipped_at: string | null }[],
  sessions: [] as { id: string; performed_at: string }[],
  failedTable: "",
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mock.rpc, from: mock.from }),
  getAuthUser: async () => ({ data: { user: mock.user } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../queries", async (original) => ({
  ...await original<typeof import("../queries")>(), getUserTimezone: async () => "Pacific/Kiritimati",
}));
import { previewTrainingRestore, restoreBlock, unskipPlannedSession } from "../actions";

const workoutId = "22222222-2222-4222-8222-222222222222";
const swim: TrainingCommitment = {
  id: "swim", source: "swim", programId: "swim-plan", date: "2026-09-14", title: "Swimming", state: "scheduled",
};

beforeEach(() => {
  mock.user = { id: "11111111-2222-4222-8222-222222222222" };
  mock.block.status = "active"; mock.block.deleted_at = "2026-09-14";
  mock.revision = "a".repeat(32); mock.entries = [swim]; mock.sessions = []; mock.failedTable = "";
  mock.rows = [{ id: workoutId, block_id: mock.block.id, week_index: 0, day_index: 0, role: "strength", completed_session_id: null, skipped_at: null }];
  mock.rpc.mockReset().mockImplementation(async (name: string) => ({
    data: name === "training_schedule_snapshot" ? { revision: mock.revision, entries: mock.entries } : { id: mock.block.id }, error: null,
  }));
  mock.from.mockReset().mockImplementation((table: string) => {
    const filters = new Map<string, string>();
    const error = mock.failedTable === table ? { message: "Unavailable" } : null;
    const query = { select: vi.fn(), eq: vi.fn(), maybeSingle: vi.fn(), then: vi.fn(), in: vi.fn() };
    query.select.mockReturnValue(query);
    query.eq.mockImplementation((key: string, value: string) => { filters.set(key, value); return query; });
    query.maybeSingle.mockImplementation(async () => ({
      data: table === "training_blocks" ? mock.block : mock.rows.find((row) => row.id === filters.get("id")) ?? null, error,
    }));
    query.then.mockImplementation((resolve) => Promise.resolve({ data: mock.rows, error }).then(resolve));
    query.in.mockResolvedValue({ data: mock.sessions, error });
    return query;
  });
});

describe("DC-K4 restored schedule review", () => {
  it("previews a restored block's actual dates without writing and binds explicit consent to the receipt", async () => {
    const preview = await previewTrainingRestore({ kind: "block", id: mock.block.id });
    expect(preview.dates).toEqual(["2026-09-14"]);
    expect(preview.overlaps).toEqual([swim]);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
    await restoreBlock(mock.block.id, { revision: preview.revision, requestId: preview.requestId, acceptOverlap: true });
    expect(mock.rpc).toHaveBeenLastCalledWith("independent_program_schedule_commit", expect.objectContaining({
      p_operation: "primary-restore", p_args: { id: mock.block.id }, p_expected_revision: preview.revision,
      p_request_id: preview.requestId, p_accept_overlap: true,
    }));
  });
  it("includes skipped workout dates for undo and excludes rest, paused and out-of-range work", async () => {
    mock.block.deleted_at = null; mock.rows[0]!.skipped_at = "2026-09-14";
    mock.entries.push({ ...swim, id: "rest", state: "rest" }, { ...swim, id: "paused", state: "paused" },
      { ...swim, id: "later", date: "2026-09-21" });
    const preview = await previewTrainingRestore({ kind: "workout", id: workoutId });
    expect(preview.overlaps).toEqual([swim]);
    const form = new FormData(); form.set("id", workoutId);
    form.set("scheduleReview", JSON.stringify({ revision: preview.revision, requestId: preview.requestId, acceptOverlap: true }));
    await unskipPlannedSession(form);
    expect(mock.rpc).toHaveBeenLastCalledWith("independent_program_schedule_commit", expect.objectContaining({
      p_operation: "primary-unskip", p_args: { id: workoutId }, p_request_id: preview.requestId, p_accept_overlap: true,
    }));
  });
  it("does not ask again for a day already occupied by this program", async () => {
    mock.entries.push({ ...swim, id: "other-primary-slot", source: "primary", programId: mock.block.id });
    expect((await previewTrainingRestore({ kind: "block", id: mock.block.id })).overlaps).toEqual([]);
  });
  it("keeps completed-session occupancy while restoring its block", async () => {
    mock.rows[0]!.completed_session_id = "logged";
    mock.sessions = [{ id: "logged", performed_at: "2026-09-13T12:30:00Z" }];
    mock.entries.push({ ...swim, id: "logged", source: "session", programId: null, state: "completed" });
    expect((await previewTrainingRestore({ kind: "block", id: mock.block.id })).dates).toEqual([]);
  });
  it("uses the account timezone for a previously hidden logged workout", async () => {
    mock.rows[0]!.completed_session_id = "hidden";
    mock.rows[0]!.day_index = 2;
    mock.sessions = [{ id: "hidden", performed_at: "2026-09-13T12:30:00Z" }];
    const preview = await previewTrainingRestore({ kind: "block", id: mock.block.id });
    expect(preview.dates).toEqual(["2026-09-14"]);
    expect(preview.overlaps).toEqual([swim]);
  });
  it("does not add training dates when recovering an archived program or planned rest", async () => {
    mock.block.status = "archived";
    expect((await previewTrainingRestore({ kind: "block", id: mock.block.id })).dates).toEqual([]);
    mock.block.status = "active"; mock.rows[0]!.role = "rest";
    expect((await previewTrainingRestore({ kind: "block", id: mock.block.id })).dates).toEqual([]);
  });
  it("keeps preview identities stable for retries but changes them with calendar state", async () => {
    const first = await previewTrainingRestore({ kind: "block", id: mock.block.id });
    expect(await previewTrainingRestore({ kind: "block", id: mock.block.id })).toEqual(first);
    mock.revision = "b".repeat(32);
    expect((await previewTrainingRestore({ kind: "block", id: mock.block.id })).requestId).not.toBe(first.requestId);
  });
  it("refuses unreadable schedules, unauthenticated calls and started-workout undo", async () => {
    mock.failedTable = "planned_sessions";
    await expect(previewTrainingRestore({ kind: "block", id: mock.block.id })).rejects.toThrow();
    mock.failedTable = ""; mock.block.deleted_at = null; mock.rows[0]!.completed_session_id = "logged";
    await expect(previewTrainingRestore({ kind: "workout", id: workoutId })).rejects.toThrow();
    mock.user = null;
    await expect(previewTrainingRestore({ kind: "block", id: mock.block.id })).rejects.toThrow("Not signed in");
    expect(mock.rpc.mock.calls.every(([name]) => name === "training_schedule_snapshot")).toBe(true);
  });
});
