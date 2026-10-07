import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authoredProgramDates, compileAuthoredWorkout, type AuthoredProgramDefinitionV2 } from "@hta/domain";
import { previewAuthoredProgram, reloadAuthoredProgram, saveAuthoredProgram } from "./actions";
import { loadAuthoredStartDateState } from "./edit-state";
import type { AuthoredSaveInput } from "./schema";
import type { ScheduleSnapshot } from "@/lib/schedule/storage";
import type { Prescription } from "@hta/db";

const mock = vi.hoisted(() => ({ client: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mock.client,
  getAuthUser: async () => ({ data: { user: { id: "10000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidate }));
vi.mock("server-only", () => ({}));
const id = (n: number) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const userId = id(1), blockId = id(2), movementId = id(3);
const revision = "a".repeat(32);
const catalog = [{ id: movementId, slug: "back-squat", displayName: "Back squat", pattern: "squat" }];
const definition: AuthoredProgramDefinitionV2 = {
  version: 2, activity: "strength", name: "Saved program",
  weeks: [
    { type: "Build", sets: "3", reps: "5", pct: 75 },
    { type: "Deload", sets: "2", reps: "5", pct: 60 },
  ],
  workouts: [{ id: id(4), name: "Monday", weekday: 0, parts: [{
    id: id(5), kind: "movement", movement: {
      id: id(6), movementId, role: "main", sets: 3, dose: { kind: "reps", reps: 5 },
      restSeconds: 90, notes: "", overrides: { 1: { sets: "1", load: { kind: "pct", value: 55 } } },
    },
  }] }],
};
type Planned = {
  id: string; week_index: number; day_index: number; slot: string; title: string; role: string;
  prescription: Prescription; completed_session_id: string | null; skipped_at: string | null;
  planned_at: string | null; notes: string | null;
};
let startedOn: string;
let snapshot: ScheduleSnapshot;
let planned: Planned[];
let requests: { endpoint: string; method: string; body: Record<string, unknown> | null; query: URLSearchParams }[];
let failure: string | null;
let commitError: { code: string; message: string } | null;
const input = (date = "2026-10-14"): AuthoredSaveInput => ({
  definition, startedOn: date, editBlockId: blockId, editRevision: revision, scope: "program",
});
const review = { revision, requestId: id(90), acceptOverlap: false };
const writes = () => requests.filter((request) => request.method !== "GET" &&
  !["training_schedule_snapshot", "independent_programs_ready"].includes(request.endpoint));

afterEach(() => vi.useRealTimers());

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-07T12:00:00Z"));
  startedOn = "2026-10-05";
  snapshot = { revision, entries: [], authoredStartDateChanges: true };
  failure = null; commitError = null; requests = [];
  mock.revalidate.mockReset();
  planned = authoredProgramDates(definition, startedOn).map((row, index) => ({
    id: id(100 + index), week_index: row.weekIndex, day_index: row.dayIndex, slot: "single",
    title: row.workout.name, role: "strength",
    prescription: { ...compileAuthoredWorkout(row.workout, catalog, undefined, definition.weeks[row.authoredWeekIndex], row.authoredWeekIndex),
      programRef: row.ref },
    completed_session_id: null, skipped_at: null, planned_at: null, notes: null,
  }));
  mock.client.mockResolvedValue(createClient("https://synthetic.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (target, init) => {
      const url = new URL(target instanceof Request ? target.url : String(target));
      const endpoint = url.pathname.split("/").at(-1)!;
      const method = init?.method ?? "GET";
      requests.push({ endpoint, method, query: url.searchParams,
        body: init?.body ? JSON.parse(String(init.body)) : null });
      if (endpoint === failure) return Response.json({ code: "08006", message: "Synthetic read failure" }, { status: 400 });
      if (endpoint === "independent_programs_ready") return Response.json(true);
      if (endpoint === "training_schedule_snapshot") return Response.json(snapshot);
      if (endpoint === "independent_program_schedule_commit") {
        return commitError ? Response.json(commitError, { status: 400 }) : Response.json({ block_id: blockId });
      }
      expect(method).toBe("GET");
      if (endpoint === "movements") return Response.json(catalog.map((row) => ({
        ...row, display_name: row.displayName, metadata: null, primary_region: "knee",
      })));
      if (endpoint === "profiles") {
        expect(url.searchParams.get("id")).toBe(`eq.${userId}`);
        return Response.json({ timezone: "UTC" });
      }
      expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);
      if (endpoint === "engine_override_events") return Response.json([]);
      if (endpoint === "limitations") return Response.json([]);
      if (endpoint === "training_blocks") {
        const row = { id: blockId, started_on: startedOn, program_id: "authored", program_kind: "strength", notes: definition.name };
        return Response.json(url.searchParams.get("id") ? row : [row]);
      }
      if (endpoint === "program_instances") return Response.json({ block_id: blockId, instance: definition });
      if (endpoint === "planned_sessions") {
        expect(url.searchParams.get("block_id")).toBe(`eq.${blockId}`);
        return Response.json(url.searchParams.get("completed_session_id")
          ? planned.filter((row) => row.completed_session_id !== null).slice(0, 1).map(({ id }) => ({ id }))
          : planned);
      }
      throw new Error(`Unexpected synthetic request: ${endpoint}`);
    } },
  }));
});

describe("DC-R5/DC-K4 authored start-date save boundary", () => {
  it("saves the changed date, same row identities and complete definition in one schedule RPC", async () => {
    const preview = await previewAuthoredProgram(input());
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("Expected preview");
    expect(preview.preview.dates.map((row) => row.date)).toEqual(["2026-10-19", "2026-10-26"]);
    expect(await saveAuthoredProgram(input(), preview.preview.id, review)).toEqual({ ok: true, blockId });
    expect(writes()).toHaveLength(1);
    expect(writes()[0]).toMatchObject({
      endpoint: "independent_program_schedule_commit", body: {
        p_operation: "authored-start-date", p_expected_revision: revision,
        p_args: {
          p_block_id: blockId, p_deletions: [], p_insertions: [],
          p_block_metadata: { started_on: "2026-10-14", weeks: 3, authored_start_date_change: {
            expected_started_on: startedOn,
            updates: [{ id: id(100), week_index: 1, day_index: 0 }, { id: id(101), week_index: 2, day_index: 0 }],
          } },
          p_program_instance: { instance: definition, setup_input: { startedOn: "2026-10-14", definition } },
        },
      },
    });
  });
  it("keeps unchanged historical-date edits backward compatible while the migration is absent", async () => {
    delete snapshot.authoredStartDateChanges;
    const unchanged = input(startedOn);
    const preview = await previewAuthoredProgram(unchanged);
    expect(preview.ok).toBe(true);
    if (!preview.ok) throw new Error("Expected preview");
    expect(await saveAuthoredProgram(unchanged, preview.preview.id, review)).toEqual({ ok: true, blockId });
    const args = writes()[0]?.body?.p_args as Record<string, unknown>;
    expect(args.p_block_metadata).not.toHaveProperty("started_on");
    expect(args.p_block_metadata).not.toHaveProperty("authored_start_date_change");
  });
  it("does not submit a changed date while the capability is absent", async () => {
    delete snapshot.authoredStartDateChanges;
    expect(await previewAuthoredProgram(input())).toMatchObject({ ok: false });
    expect(await saveAuthoredProgram(input(), "unused", review)).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });
  it.each(["workout", "future"] as const)("rejects changed dates in %s scope before writing", async (scope) => {
    expect(await previewAuthoredProgram({ ...input(), scope, workoutId: id(4), plannedSessionId: id(100) })).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });
  it.each([false, true])("rejects begun links even when the row is hidden/skipped (%s)", async (hidden) => {
    planned[0]!.completed_session_id = id(80);
    if (hidden) planned[0]!.skipped_at = "2026-10-07T10:00:00Z";
    expect(await previewAuthoredProgram(input())).toMatchObject({ ok: false });
    const state = await loadAuthoredStartDateState(await mock.client(), userId, blockId, snapshot);
    expect(state.canChangeStartDate).toBe(false);
    const eligibility = requests.find((row) => row.query.has("completed_session_id"))!;
    expect(eligibility.query.get("completed_session_id")).toBe("not.is.null");
    expect(eligibility.query.has("skipped_at")).toBe(false);
    expect(writes()).toEqual([]);
  });
  it("rejects stale tabs and dates before today without mutation", async () => {
    expect(await previewAuthoredProgram({ ...input(), editRevision: "b".repeat(32) })).toMatchObject({ ok: false });
    expect(await previewAuthoredProgram(input("2026-10-06"))).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
  });
  it("requires new overlap consent before saving the changed dates", async () => {
    snapshot.entries = [{ id: "swim", source: "swim", programId: id(70), date: "2026-10-19", title: "Swim", state: "scheduled" }];
    const preview = await previewAuthoredProgram(input());
    if (!preview.ok) throw new Error("Expected preview");
    expect(preview.preview.overlaps).toHaveLength(1);
    expect(await saveAuthoredProgram(input(), preview.preview.id, review)).toMatchObject({ ok: false });
    expect(writes()).toEqual([]);
    expect(await saveAuthoredProgram(input(), preview.preview.id, { ...review, acceptOverlap: true })).toEqual({ ok: true, blockId });
  });
  it("preserves notes, manual placement and custom prescriptions in the retained update payload", async () => {
    planned[0]!.week_index = 2; planned[0]!.day_index = 1;
    planned[0]!.prescription.meta = { userRescheduled: true };
    planned[0]!.notes = "Keep";
    planned[1]!.prescription.userEdited = true;
    const preview = await previewAuthoredProgram(input());
    if (!preview.ok) throw new Error("Expected preview");
    expect(preview.preview.dates.map((row) => row.date)).toEqual(["2026-10-20", "2026-10-26"]);
    expect(await saveAuthoredProgram(input(), preview.preview.id, review)).toMatchObject({ ok: true });
    expect(writes()[0]?.body).toMatchObject({ p_args: { p_block_metadata: { authored_start_date_change: {
      updates: [{ id: id(100), week_index: 1, day_index: 1 }, { id: id(101), week_index: 2, day_index: 0 }],
    } } } });
    const args = writes()[0]!.body!.p_args as { p_block_metadata: { authored_start_date_change: { updates: object[] } } };
    for (const update of args.p_block_metadata.authored_start_date_change.updates) expect(update).not.toHaveProperty("prescription");
  });
  it("surfaces the transactional concurrent-start rejection without a separate date write or success", async () => {
    const preview = await previewAuthoredProgram(input());
    if (!preview.ok) throw new Error("Expected preview");
    commitError = { code: "40001", message: "Your schedule changed. Review the dates again." };
    expect(await saveAuthoredProgram(input(), preview.preview.id, review)).toEqual({ ok: false, error: commitError.message });
    expect(writes()).toHaveLength(1);
    expect(mock.revalidate).not.toHaveBeenCalled();
  });
  it("reloads the authoritative date and eligibility with the revision", async () => {
    startedOn = "2026-10-14";
    expect(await reloadAuthoredProgram(blockId)).toMatchObject({ startedOn, canChangeStartDate: true, revision, definition });
    planned[0]!.completed_session_id = id(80);
    expect(await reloadAuthoredProgram(blockId)).toMatchObject({ startedOn, canChangeStartDate: false, revision });
  });
  it("does not infer unused-program eligibility from a failed read", async () => {
    failure = "planned_sessions";
    expect(await previewAuthoredProgram(input())).toMatchObject({ ok: false });
    await expect(loadAuthoredStartDateState(await mock.client(), userId, blockId, snapshot)).rejects.toThrow();
    expect(writes()).toEqual([]);
  });
});
