import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { conditioningSwimView, loadConditioningSwims, loadBoundSwimIds, type ConditioningSwimRow } from "../conditioning-view";
import { swimReturnDestination } from "../conditioning-presentation";
import { swimFixture, userId, planId } from "./fixtures";
import { actionablePlannedSessions, isTodayFullyLogged } from "@/lib/sessions/today-hero";
import { isOverdue } from "@/lib/planner/overdue";

const row = (): ConditioningSwimRow => ({
  ...swimFixture().workouts[0]!, planned_session_id: "planned", block_id: "block", plan_status: "active", plan_revision: 1,
  block_status: "active", block_deleted_at: null, visible_session_id: null, native_completed_at: null,
  outcome_match_id: "match", outcome_metadata: {
    outcome: "stopped_early", previousOutcomeId: null, workoutRevision: 1,
  },
  current_match_id: "match", matched_import_id: "recording", matched_workout_revision: 1,
  latest_import_id: "recording", recording_date: "2026-09-07",
});
function clientFor(reply: (url: URL) => Response) {
  return createClient("https://conditioning.test", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url) => reply(new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url)) },
  });
}
describe("shared conditioning projection", () => {
  it("offers linked controls only on an installed active parent and protects claimed work", () => {
    const fixture = { ...row(), plan_revision: 2 };
    expect(conditioningSwimView(fixture)).not.toHaveProperty("controls");
    expect(conditioningSwimView(fixture, true).controls).toMatchObject({ planRevision: 2, editable: false });
    expect(conditioningSwimView({ ...fixture, outcome_metadata: null }, true).controls?.editable).toBe(true);
    expect(conditioningSwimView({ ...fixture, block_status: "archived" }, true)).not.toHaveProperty("controls");
    expect(conditioningSwimView({ ...fixture, plan_status: "paused" }, true).controls?.planStatus).toBe("paused");
  });
  it("uses the same settled state in Today and overdue without a native completion", () => {
    const swim = conditioningSwimView(row());
    const planned = { swim, completedAt: null, completedSessionId: null, skippedAt: null, date: "2026-09-07" };
    expect(swim).toMatchObject({ completed: false, settled: true, status: "stopped_early" });
    expect(actionablePlannedSessions([planned])).toEqual([]);
    expect(isOverdue(planned, "2026-09-15")).toBe(false);
    expect(isTodayFullyLogged({ completedTodayCount: 0, plannedToday: [planned] })).toBe(false);
    expect(swim).not.toHaveProperty("completedAt");
    expect(swim).not.toHaveProperty("sessionId");
    expect(swim).not.toHaveProperty("duration");
    expect(swim).not.toHaveProperty("load");
  });
  it("does not trust a removed match or a newer import", () => {
    for (const change of [{ current_match_id: null }, { latest_import_id: "new" }]) {
      const swim = conditioningSwimView({ ...row(), ...change });
      expect(swim).toMatchObject({ status: "needs_review", completed: false, recordingDate: null });
      expect(isOverdue({ swim, date: "2026-09-07", completedSessionId: null, skippedAt: null }, "2026-09-15")).toBe(true);
    }
  });
  it("batches requested identities and scopes every read to the owner", async () => {
    let reads = 0;
    const ids = Array.from({ length: 201 }, (_, i) => `planned-${i}`);
    const client = clientFor((url) => {
      if (url.pathname.endsWith("_ready")) return Response.json(true);
      expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);
      expect(url.searchParams.get("limit")).toBe("101");
      const start = reads++ * 100;
      return Response.json(ids.slice(start, start + 100).map((planned_session_id) => ({ ...row(), planned_session_id })));
    });
    expect((await loadConditioningSwims(client, userId, ids)).size).toBe(201);
    expect(reads).toBe(3);
  });
  it("keeps legacy databases readable but never hides a broken installed view", async () => {
    const legacy = clientFor(() => Response.json({ code: "PGRST202", message: "Missing function" }, { status: 404 }));
    expect((await loadConditioningSwims(legacy, userId, ["planned"])).size).toBe(0);
    const broken = clientFor((url) => url.pathname.endsWith("_ready") ? Response.json(true) : Response.json({}, { status: 500 }));
    await expect(loadConditioningSwims(broken, userId, ["planned"])).rejects.toThrow("could not be loaded");
  });
  it("rejects duplicate or foreign responses", async () => {
    for (const rows of [[row(), row()], [{ ...row(), user_id: planId }]]) {
      const client = clientFor((url) => Response.json(url.pathname.endsWith("_ready") ? true : rows));
      await expect(loadConditioningSwims(client, userId, ["planned"])).rejects.toThrow();
    }
  });
  it("excludes retained bindings as well as live links from the standalone schedule", async () => {
    const client = clientFor((url) => {
      if (url.pathname.endsWith("_ready")) return Response.json(true);
      expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);
      expect(url.searchParams.has("planned_session_id")).toBe(false);
      return Response.json([{ swim_workout_id: "retained" }, { swim_workout_id: "live" }]);
    });
    expect([...await loadBoundSwimIds(client, userId)]).toEqual(["retained", "live"]);
  });
  it("limits return navigation to known app destinations", () => {
    expect(swimReturnDestination("today").href).toBe("/app");
    expect(swimReturnDestination("history").href).toBe("/app/plan/history");
    expect(swimReturnDestination("https://elsewhere.test").href).toBe("/app/swim");
  });
});
