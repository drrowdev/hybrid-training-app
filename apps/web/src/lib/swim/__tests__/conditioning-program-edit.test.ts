import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import type { ProgramInstanceWrite } from "../../platform/program-instance";
import { prepareConditioningProgramEdit, readConditioningEditRows } from "../conditioning-program-edit";
import type { ConditioningSwimRow } from "../conditioning-view";
import { swimFixture, userId } from "./fixtures";

const row = (): ConditioningSwimRow => ({
  ...swimFixture().workouts[0]!, scheduled_date: "2026-09-16",
  planned_session_id: "planned", block_id: "block", plan_status: "active", plan_revision: 2,
  block_status: "active", block_deleted_at: null, visible_session_id: null, native_completed_at: null,
  outcome_match_id: null, outcome_metadata: null, current_match_id: null, matched_import_id: null,
  matched_workout_revision: null, latest_import_id: null, recording_date: null,
});
function fixture() {
  const write: ProgramInstanceWrite = {
    weeks: 1, daysPerWeek: 1, dayIndexOverrides: { days: [0], twoADay: false },
    tmPercents: [], skipped: [], sessions: [{
      ref: "cardio", weekIndex: 0, dayIndex: 3, slot: "single", title: "Conditioning", role: "cardio",
      prescription: { items: [{ movementId: "", kind: "cardio_external" }], programRef: "cardio" },
      sessionModality: "pure_z2_aerobic", effectiveStressLoad: 0, skipped: [],
    }],
  };
  return {
    rows: [row()], write, conditioning: { choices: [{ weekday: 2, activity: "swimming" }], skipped: 2 },
    startedOn: "2026-09-14", today: "2026-09-14",
    primary: [{
      id: "planned", week_index: 0, day_index: 2, slot: "single", planned_at: null, notes: "Keep this note",
      prescription: { items: [{ kind: "cardio_external" }] }, role: "cardio", completed_session_id: null,
    }],
  };
}
describe("DC-SW5/SW7 coordinated edit preparation", () => {
  it("keeps source and primary identities, preserves metadata and produces an exact snapshot", () => {
    const input = fixture();
    const original = structuredClone(input);
    const result = prepareConditioningProgramEdit(input);
    expect(input).toEqual(original);
    expect(result.moves).toEqual([{ id: input.rows[0]!.id, plannedSessionId: "planned", date: "2026-09-17" }]);
    expect([...result.retainedIds]).toEqual(["planned"]);
    expect([...result.claimedIndices]).toEqual([0]);
    expect(result.conditioning).toEqual({ choices: [{ weekday: 3, activity: "swimming" }], skipped: 2 });
    expect(Object.keys(result.expected[0]!.primary).sort()).toEqual([
      "day_index", "id", "notes", "planned_at", "prescription", "slot", "week_index",
    ]);
    expect(result.expected[0]!.primary.prescription).toEqual(input.primary[0]!.prescription);
  });
  it.each(["paused", "active"])("moves unstarted work without changing a %s plan's status", (plan_status) => {
    const input = fixture();
    input.rows[0]!.plan_status = plan_status;
    expect(prepareConditioningProgramEdit(input).moves).toHaveLength(1);
    expect(input.rows[0]!.plan_status).toBe(plan_status);
  });
  it("preserves native-started, claimed, skipped, finished and today's work", () => {
    const frozen: Partial<ConditioningSwimRow>[] = [
      { session_id: "native" }, { status: "skipped" }, { plan_status: "finished" },
      { outcome_metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 1 } },
    ];
    for (const change of frozen) {
      const input = fixture();
      Object.assign(input.rows[0]!, change);
      const result = prepareConditioningProgramEdit(input);
      expect(result.moves).toEqual([]);
      expect([...result.claimedIndices]).toEqual([0]);
    }
    const input = fixture();
    input.today = input.rows[0]!.scheduled_date;
    expect(prepareConditioningProgramEdit(input).moves).toEqual([]);
  });
  it("refuses stale placement and nonpositive revisions before saving", () => {
    for (const change of [{ plan_revision: -1 }, { revision: 0 }, { scheduled_date: "2026-09-15" }]) {
      const input = fixture();
      Object.assign(input.rows[0]!, change);
      expect(() => prepareConditioningProgramEdit(input)).toThrow();
    }
  });
  it("does not silently drop strength when a confirmed swim must keep its date", () => {
    const input = fixture();
    input.rows[0]!.session_id = "native";
    input.write.sessions.push({ ...input.write.sessions[0]!, dayIndex: 2, role: "strength", prescription: { items: [] } });
    expect(() => prepareConditioningProgramEdit(input)).toThrow();
  });
});

describe("DC-SW8 owner-scoped edit reads", () => {
  function clientFor(response: (url: URL) => Response) {
    return createClient("https://conditioning.test", "synthetic-test-key", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: async (url) => response(new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url)) },
    });
  }
  it("bounds the owned block read and requires the installed edit capability", async () => {
    const calls: string[] = [];
    const client = clientFor((url) => {
      calls.push(url.pathname);
      if (url.pathname.endsWith("_ready")) return Response.json(true);
      expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);
      expect(url.searchParams.get("block_id")).toBe("eq.block");
      expect(url.searchParams.get("limit")).toBe("367");
      return Response.json([row()]);
    });
    expect(await readConditioningEditRows(client, userId, "block")).toEqual([row()]);
    expect(calls.at(-1)).toBe("/rest/v1/rpc/swim_conditioning_program_edit_ready");
  });
  it("refuses foreign, duplicate or excessive rows and unavailable editing", async () => {
    for (const rows of [[{ ...row(), user_id: "foreign" }], [row(), row()], Array(367).fill(row())]) {
      const client = clientFor((url) => Response.json(url.pathname.endsWith("_ready") ? true : rows));
      await expect(readConditioningEditRows(client, userId, "block")).rejects.toThrow();
    }
    const client = clientFor((url) => url.pathname.endsWith("program_edit_ready")
      ? Response.json({ code: "PGRST202" }, { status: 404 })
      : Response.json(url.pathname.endsWith("_ready") ? true : [row()]));
    await expect(readConditioningEditRows(client, userId, "block")).rejects.toThrow();
  });
});
