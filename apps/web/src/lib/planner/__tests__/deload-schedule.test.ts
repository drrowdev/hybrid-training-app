import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrainingCommitment } from "@hta/domain";
import type { DeloadWeekPreview } from "../deload-week-preview";

const mock = vi.hoisted(() => ({
  rpc: vi.fn(), from: vi.fn(), preview: null as DeloadWeekPreview | null,
  user: { id: "11111111-2222-4222-8222-222222222222" } as { id: string } | null,
  block: { id: "11111111-1111-4111-8111-111111111111", started_on: "2026-09-14", status: "active", deleted_at: null as string | null },
  rows: [] as { id: string; week_index: number; day_index: number; role: string; completed_session_id: string | null }[],
  entries: [] as TrainingCommitment[], revision: "a".repeat(32), failedTable: "", missingSchedule: false,
  commitError: null as { message: string } | null,
  receipt: null as { context: Record<string, unknown> } | null,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mock.rpc, from: mock.from }),
  getAuthUser: async () => ({ data: { user: mock.user } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("Sign in"); } }));
vi.mock("../queries", async (original) => ({
  ...await original<typeof import("../queries")>(), getUserTimezone: async () => "Pacific/Kiritimati",
}));
vi.mock("../deload-week-preview", () => ({ getDeloadWeekPreview: async () => mock.preview }));
import {
  insertDeloadWeekAction, previewDeloadWeekAction, previewRemoveDeloadWeekAction, removeDeloadWeekAction,
  type ReviewedDeloadWeekPreview,
} from "../deload-week-actions";
import { dayDate } from "../queries";

const swim = (date: string): TrainingCommitment => ({
  id: `swim-${date}`, source: "swim", programId: "swim-plan", date, title: "Swimming", state: "scheduled",
});
const review = (preview: ReviewedDeloadWeekPreview, acceptOverlap = false) => ({
  previewId: preview.review.id, revision: preview.review.revision, requestId: preview.review.requestId, acceptOverlap,
});
function ownEntries(): TrainingCommitment[] {
  return mock.rows.map((row) => ({
    id: row.id, source: "primary", programId: mock.block.id,
    date: dayDate(mock.block.started_on, row.week_index, row.day_index), title: row.id, state: "scheduled",
  }));
}
beforeEach(() => {
  mock.user = { id: "11111111-2222-4222-8222-222222222222" };
  mock.block.status = "active"; mock.block.deleted_at = null;
  mock.revision = "a".repeat(32); mock.failedTable = ""; mock.missingSchedule = false;
  mock.receipt = null; mock.commitError = null;
  mock.rows = [0, 1, 2].map((week) => ({
    id: `row-${week}`, week_index: week, day_index: week === 2 ? 2 : 0, role: "strength", completed_session_id: null,
  }));
  mock.entries = [...ownEntries(), swim("2026-09-28"), swim("2026-10-07")];
  mock.preview = {
    blockId: mock.block.id, afterWeek: 0, deloadWeekIndex: 1, percent: 60, eventWarning: false,
    outsideRecommended: false, restOnly: false, sessions: [{
      dayIndex: 1, slot: "single", title: "Recovery", sessionModality: "strength",
      prescription: { items: [{ kind: "main", movementId: "squat", reps: 5 }] },
    }],
  };
  mock.rpc.mockReset().mockImplementation(async (name: string, args?: Record<string, unknown>) => {
    if (name === "training_schedule_snapshot") return mock.missingSchedule
      ? { data: null, error: { code: "PGRST202", message: "training_schedule_snapshot unavailable" } }
      : { data: { revision: mock.revision, entries: mock.entries }, error: null };
    if (name !== "training_schedule_commit" || !args) throw new Error(`Unexpected RPC ${name}`);
    const result = args.p_operation === "primary-insert-deload"
      ? { deloadWeekIndex: 1, sessions: 1 } : { blockId: mock.block.id };
    if (!mock.commitError) mock.receipt = { context: {
      kind: "training-schedule-v1", operation: args.p_operation, inputHash: args.p_input_hash, result,
    } };
    return { data: mock.commitError ? null : result, error: mock.commitError };
  });
  mock.from.mockReset().mockImplementation((table: string) => {
    if (!["training_blocks", "planned_sessions", "engine_override_events"].includes(table)) throw new Error(`Unexpected table ${table}`);
    const error = mock.failedTable === table ? { message: "Unavailable" } : null;
    const query = { select: vi.fn(), eq: vi.fn(), is: vi.fn(), maybeSingle: vi.fn(), then: vi.fn() };
    query.select.mockReturnValue(query); query.eq.mockReturnValue(query); query.is.mockReturnValue(query);
    query.maybeSingle.mockImplementation(async () => ({
      data: table === "engine_override_events" ? mock.receipt : mock.block, error,
    }));
    query.then.mockImplementation((resolve) => Promise.resolve({ data: mock.rows, error }).then(resolve));
    return query;
  });
});

describe("DC-K4 recovery-week shared schedule review", () => {
  it("reviews inserted dates and every shifted week before writing", async () => {
    const preview = await previewDeloadWeekAction();
    expect(preview!.review.dates).toEqual(["2026-09-22", "2026-09-28", "2026-10-07"]);
    expect(preview!.review.overlaps).toEqual([swim("2026-09-28"), swim("2026-10-07")]);
    expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it("does not renew consent on an already occupied primary date or on planned rest", async () => {
    mock.preview!.sessions[0]!.dayIndex = 0;
    mock.entries.push(swim("2026-09-21"));
    mock.entries = mock.entries.map((entry) => entry.date === "2026-09-28" || entry.date === "2026-10-07"
      ? { ...entry, state: "rest" } : entry);
    const preview = await previewDeloadWeekAction();
    expect(preview!.review.dates).not.toContain("2026-09-21");
    expect(preview!.review.overlaps).toEqual([]);
  });
  it.each(["started", "completed"] as const)("retains actual account-date occupancy for %s history", async (state) => {
    mock.rows[2]!.completed_session_id = "history";
    mock.entries = mock.entries.map((entry) => entry.id === "row-2" ? { ...entry, date: "2026-09-16", state } : entry);
    expect((await previewDeloadWeekAction())!.review.dates).toEqual(["2026-09-22", "2026-09-28"]);
  });
  it("requires fresh explicit overlap consent and uses the shared atomic writer", async () => {
    const preview = (await previewDeloadWeekAction())!;
    expect(await insertDeloadWeekAction()).toMatchObject({ ok: false });
    expect(await insertDeloadWeekAction(undefined, undefined, undefined, review(preview))).toMatchObject({ ok: false });
    expect(mock.rpc.mock.calls.every(([name]) => name === "training_schedule_snapshot")).toBe(true);
    expect(await insertDeloadWeekAction(undefined, undefined, undefined, review(preview, true)))
      .toEqual({ ok: true, deloadWeekIndex: 1, sessions: 1 });
    expect(mock.rpc).toHaveBeenLastCalledWith("training_schedule_commit", expect.objectContaining({
      p_operation: "primary-insert-deload", p_expected_revision: preview.review.revision,
      p_request_id: preview.review.requestId, p_accept_overlap: true,
      p_args: { blockId: mock.block.id, afterWeek: 0, sessions: [{
        day_index: 1, slot: "single", title: "Recovery", session_modality: "strength", prescription: mock.preview!.sessions[0]!.prescription,
      }] },
    }));
  });
  it("rejects a stale calendar or changed recovery prescription without saving", async () => {
    const preview = (await previewDeloadWeekAction())!;
    mock.revision = "b".repeat(32);
    expect(await insertDeloadWeekAction(undefined, undefined, undefined, review(preview, true))).toMatchObject({ ok: false });
    mock.revision = preview.review.revision; mock.preview!.sessions[0]!.prescription.items[0]!.reps = 3;
    expect(await insertDeloadWeekAction(undefined, undefined, undefined, review(preview, true))).toMatchObject({ ok: false });
    expect(mock.rpc.mock.calls.every(([name]) => name === "training_schedule_snapshot")).toBe(true);
  });
  it("replays confirmed insertion before rebuilding a changed schedule and rejects receipt reuse", async () => {
    const preview = (await previewDeloadWeekAction())!, accepted = review(preview, true);
    await insertDeloadWeekAction(undefined, undefined, undefined, accepted);
    mock.rpc.mockClear(); mock.failedTable = "planned_sessions"; mock.revision = "b".repeat(32);
    expect(await insertDeloadWeekAction(undefined, undefined, undefined, accepted)).toEqual({ ok: true, deloadWeekIndex: 1, sessions: 1 });
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(await insertDeloadWeekAction(61, undefined, undefined, accepted)).toMatchObject({ ok: false });
  });
  it("keeps a retry's receipt identity after an unconfirmed save", async () => {
    const preview = (await previewDeloadWeekAction())!, accepted = review(preview, true);
    mock.commitError = { message: "Could not save." };
    expect(await insertDeloadWeekAction(undefined, undefined, undefined, accepted)).toEqual({ ok: false, error: "Could not save." });
    mock.commitError = null;
    await insertDeloadWeekAction(undefined, undefined, undefined, accepted);
    const commits = mock.rpc.mock.calls.filter(([name]) => name === "training_schedule_commit");
    expect(commits).toHaveLength(2); expect(commits[0]).toEqual(commits[1]);
  });
  it("previews and atomically removes a recovery week with shifted-week consent and replay", async () => {
    mock.rows[1]!.role = "deload"; mock.rows[1]!.day_index = 1;
    mock.entries = [...ownEntries(), swim("2026-09-23")];
    const preview = (await previewRemoveDeloadWeekAction({ weekIndex: 1 }))!;
    expect(preview.review.dates).toEqual(["2026-09-23"]);
    expect(preview.review.overlaps).toEqual([swim("2026-09-23")]);
    const accepted = { previewId: preview.review.id, revision: preview.review.revision, requestId: preview.review.requestId, acceptOverlap: false };
    expect(await removeDeloadWeekAction({ weekIndex: 1 })).toMatchObject({ ok: false });
    expect(await removeDeloadWeekAction({ weekIndex: 1 }, accepted)).toMatchObject({ ok: false });
    accepted.acceptOverlap = true;
    expect(await removeDeloadWeekAction({ weekIndex: 1 }, accepted)).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenLastCalledWith("training_schedule_commit", expect.objectContaining({
      p_operation: "primary-remove-deload", p_args: { blockId: mock.block.id, weekIndex: 1 }, p_accept_overlap: true,
    }));
    mock.rpc.mockClear(); mock.rows = [];
    expect(await removeDeloadWeekAction({ weekIndex: 1 }, accepted)).toEqual({ ok: true });
    expect(mock.rpc).not.toHaveBeenCalled();
  });
  it("refuses removal of ordinary or already-started recovery weeks", async () => {
    await expect(previewRemoveDeloadWeekAction({ weekIndex: 1 })).rejects.toThrow();
    mock.rows[1]!.role = "deload"; mock.rows[1]!.completed_session_id = "history";
    await expect(previewRemoveDeloadWeekAction({ weekIndex: 1 })).rejects.toThrow();
  });
  it("keeps app-first recovery unavailable, rather than assuming an empty schedule", async () => {
    mock.missingSchedule = true;
    expect(await previewDeloadWeekAction()).toBeNull();
  });
  it.each(["training_blocks", "planned_sessions"])("reports failed %s reads", async (table) => {
    mock.failedTable = table;
    await expect(previewDeloadWeekAction()).rejects.toThrow();
  });
  it("refuses inactive/deleted programs, missing graph rows and unauthenticated changes", async () => {
    mock.block.status = "archived"; await expect(previewDeloadWeekAction()).rejects.toThrow();
    mock.block.status = "active"; mock.block.deleted_at = "2026-09-14"; await expect(previewDeloadWeekAction()).rejects.toThrow();
    mock.block.deleted_at = null; mock.rows = []; await expect(previewDeloadWeekAction()).rejects.toThrow();
    mock.user = null; await expect(insertDeloadWeekAction()).rejects.toThrow("Sign in");
  });
});
