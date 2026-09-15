import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { ProgramInstanceWrite } from "../program-instance";
import { swimFixture, userId } from "../../swim/__tests__/fixtures";
import type { ConditioningSwimRow } from "../../swim/conditioning-view";

const mocks = vi.hoisted(() => ({ client: vi.fn(), auth: vi.fn(), materialize: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.client, getAuthUser: mocks.auth }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.refresh }));
vi.mock("@/lib/seasons/activation", () => ({ activateSeasonBlock: vi.fn() }));
vi.mock("@/lib/platform/context", () => ({
  buildPlatformContext: async () => ({ ctx: {}, resolveMovement: () => null }),
}));
vi.mock("@/lib/platform/registry", () => ({
  isNativeProgram: () => false,
  getProgramEngine: () => ({ meta: { name: "Synthetic programme" }, setup: () => ({ version: 1 }) }),
}));
vi.mock("@/lib/platform/program-instance", () => ({ buildProgramInstanceWrite: mocks.materialize }));
import { createProgramInstance } from "../actions";
import { getBlockEditContext } from "../edit-context";

const blockId = "00000000-0000-4000-8000-000000000010";
const instanceId = "00000000-0000-4000-8000-000000000011";
let linked: ConditioningSwimRow[];
let saved: Record<string, unknown>;
let rpcError: { code: string; message: string } | null;
let write: ProgramInstanceWrite;
const calls: { path: string; method: string; body: Record<string, unknown> | null }[] = [];
const primary = () => linked.map((row) => ({
  id: row.planned_session_id, week_index: 0, day_index: 2, slot: "single", role: "cardio",
  prescription: { items: [{ movementId: "", kind: "cardio_external" }], programRef: "cardio" },
  planned_at: null, notes: null, completed_session_id: null, skipped_at: null,
}));
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-14T12:00:00Z"));
  calls.length = 0; rpcError = null; mocks.refresh.mockReset();
  linked = [{
    ...swimFixture().workouts[0]!, scheduled_date: "2026-09-16",
    planned_session_id: "00000000-0000-4000-8000-000000000012", block_id: blockId,
    plan_status: "active", plan_revision: 2, block_status: "active", block_deleted_at: null,
    visible_session_id: null, native_completed_at: null, outcome_match_id: null, outcome_metadata: null,
    current_match_id: null, matched_import_id: null, matched_workout_revision: null,
    latest_import_id: null, recording_date: null,
  }];
  saved = { startWeekIndex: 0, weekdays: [0], conditioning: { choices: [{ weekday: 2, activity: "swimming" }], skipped: 2 } };
  write = {
    weeks: 1, daysPerWeek: 1, dayIndexOverrides: { days: [0], twoADay: false }, tmPercents: [], skipped: [],
    sessions: [{
      ref: "cardio", weekIndex: 0, dayIndex: 3, slot: "single", title: "Conditioning", role: "cardio",
      prescription: { items: [{ movementId: "", kind: "cardio_external" }], programRef: "cardio" },
      sessionModality: "pure_z2_aerobic", effectiveStressLoad: 0, skipped: [],
    }],
  };
  mocks.materialize.mockImplementation(() => structuredClone(write));
  const client = createClient("https://conditioning.test", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url, init) => {
      const address = new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url);
      const path = address.pathname;
      calls.push({ path, method: init?.method ?? "GET", body: init?.body ? JSON.parse(String(init.body)) : null });
      if (path.endsWith("_ready")) return Response.json(true);
      if (path.includes("/rpc/")) return rpcError ? Response.json(rpcError, { status: 400 }) : Response.json(instanceId);
      if (path.endsWith("training_blocks")) return Response.json({
        id: blockId, started_on: "2026-09-14", weeks: 1, program_id: "tactical-barbell", status: "active", deleted_at: null,
      });
      if (path.endsWith("program_instances")) return Response.json({ setup_input: saved, instance: {} });
      if (path.endsWith("profiles")) return Response.json({ timezone: "UTC" });
      if (path.endsWith("swim_conditioning_sessions")) return Response.json(linked);
      if (path.endsWith("planned_sessions")) {
        if (address.searchParams.get("select") === "day_index") return Response.json([{ day_index: 2 }, { day_index: 3 }]);
        if (address.searchParams.get("limit") === "1") return Response.json(primary()[0]);
        return Response.json(primary());
      }
      return Response.json([]);
    } },
  });
  mocks.client.mockResolvedValue(client);
  mocks.auth.mockResolvedValue({ data: { user: { id: userId } }, error: null });
});
afterEach(() => vi.useRealTimers());
const save = () => createProgramInstance({
  programId: "tactical-barbell", setupValues: {}, weekdays: [0], cardioWeekdays: [3],
  startedOn: "2026-09-14", editBlockId: blockId,
});
describe("DC-SW5/SW7/SW8 Edit plan integration", () => {
  it("saves one paired rewrite, retaining bound rows and suppressing their replacement", async () => {
    expect(await save()).toMatchObject({ ok: true, blockId, programInstanceId: instanceId });
    const writes = calls.filter((call) => call.path.includes("/rpc/") && !call.path.endsWith("_ready"));
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({ path: "/rest/v1/rpc/swim_update_conditioning_program", body: {
      p_block_id: blockId, p_deletions: [], p_insertions: [],
      p_moves: [{ id: linked[0]!.id, plannedSessionId: linked[0]!.planned_session_id, date: "2026-09-17" }],
      p_program_instance: { setup_input: { conditioning: { choices: [{ weekday: 3, activity: "swimming" }], skipped: 2 } } },
    } });
    expect(mocks.refresh).toHaveBeenCalledWith("/app/swim", "layout");
    expect(mocks.refresh).toHaveBeenCalledWith("/app/plan/history");
  });
  it.each(["40001", "22023", "PGRST202"])("does not fall back to partial writes after %s", async (code) => {
    rpcError = { code, message: "Synthetic private diagnostic" };
    const result = await save();
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain(rpcError.message);
    expect(calls.filter((call) => call.method !== "GET").map((call) => call.path)).toEqual([
      "/rest/v1/rpc/swim_conditioning_ready", "/rest/v1/rpc/swim_conditioning_program_edit_ready",
      "/rest/v1/rpc/swim_update_conditioning_program",
    ]);
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
  it("refuses a length change before any mutation", async () => {
    write.weeks = 2;
    expect((await save()).ok).toBe(false);
    expect(calls.filter((call) => call.method !== "GET").every((call) => call.path.endsWith("_ready"))).toBe(true);
  });
  it("leaves the ordinary native edit route unchanged", async () => {
    delete saved.conditioning;
    linked = [];
    expect((await save()).ok).toBe(true);
    expect(calls.some((call) => call.path.endsWith("update_program_instance_atomically"))).toBe(true);
    expect(calls.some((call) => call.path.endsWith("swim_update_conditioning_program"))).toBe(false);
  });
  it("refuses missing links or missing saved choices rather than taking a primary-only fallback", async () => {
    linked = [];
    expect((await save()).ok).toBe(false);
    expect(calls.filter((call) => call.method !== "GET").every((call) => call.path.endsWith("_ready"))).toBe(true);
  });
  it("reopens the current conditioning weekdays without resurrecting historical days", async () => {
    saved.conditioning = { choices: [{ weekday: 3, activity: "swimming" }] };
    expect((await getBlockEditContext(blockId))?.cardioWeekdays).toEqual([3]);
  });
  it("does not guess weekdays from history when the saved choices are invalid", async () => {
    saved.conditioning = { choices: [{ weekday: 8, activity: "swimming" }] };
    await expect(getBlockEditContext(blockId)).rejects.toThrow();
  });
});
