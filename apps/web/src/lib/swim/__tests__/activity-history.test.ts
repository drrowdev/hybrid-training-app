import { describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { loadSwimActivity } from "../activity-history";
import { formatActivityDate, mergeTrainingActivity, trainingActivityHref, type NativeActivity, type SwimActivity } from "../activity-presentation";
import type { ConditioningSwimRow } from "../conditioning-view";
import { parseSwimOrigin, swimReturnDestination } from "../conditioning-presentation";
import { swimFixture, userId, sessionId } from "./fixtures";

const row = (): ConditioningSwimRow & { claim_recording_date: string | null } => ({
  ...swimFixture().workouts[0]!, planned_session_id: "planned", block_id: "block",
  plan_status: "active", block_status: "active", block_deleted_at: null,
  visible_session_id: null, native_completed_at: null,
  outcome_match_id: "match", outcome_metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 1 },
  current_match_id: "match", matched_import_id: "recording", matched_workout_revision: 1,
  latest_import_id: "recording", recording_date: "2026-09-07", claim_recording_date: "2026-09-07",
});
const native: NativeActivity = {
  id: sessionId, title: "Strength", performed_at: "2026-09-08T01:00:00Z",
  completed_at: "2026-09-08T02:00:00Z", session_rpe: 7, duration_min: 60,
};
const swim: SwimActivity = { kind: "swim", id: "swim", title: "Week 1 A", date: "2026-09-07", status: "completed" };
function clientFor(reply: (url: URL) => Response) {
  return createClient("https://conditioning.test", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: async (url) => reply(new URL(typeof url === "string" ? url : url instanceof URL ? url.href : url.url)) },
  });
}

describe("DC-SW3/SW7 shared swimming activity", () => {
  it("loads bounded owner-scoped claims and excludes native duplicates and cleared outcomes", async () => {
    const paths: string[] = [];
    const client = clientFor((url) => {
      paths.push(url.pathname);
      if (url.pathname.endsWith("_ready")) return Response.json(true);
      expect(url.pathname).toBe("/rest/v1/swim_conditioning_sessions");
      expect(url.searchParams.get("user_id")).toBe(`eq.${userId}`);
      expect(url.searchParams.get("session_id")).toBe("is.null");
      expect(url.searchParams.get("outcome_match_id")).toBe("not.is.null");
      expect(url.searchParams.get("order")).toBe("claim_recording_date.desc,id.desc");
      expect(url.searchParams.get("limit")).toBe("8");
      return Response.json([row()]);
    });
    const activity = await loadSwimActivity(client, userId, 8);
    expect(paths).toHaveLength(2);
    expect(activity).toEqual([{
      kind: "swim", id: row().id, title: expect.any(String), date: "2026-09-07", status: "completed",
    }]);
    expect(Object.keys(activity[0]!).sort()).toEqual(["date", "id", "kind", "status", "title"]);
  });
  it.each(["completed", "stopped_early"] as const)("retains %s work after the primary programme ends or is removed", async (outcome) => {
    const fixture = { ...row(), plan_status: "finished", block_status: null,
      outcome_metadata: { ...row().outcome_metadata!, outcome } };
    const result = await loadSwimActivity(clientFor((url) => Response.json(url.pathname.endsWith("_ready") ? true : [fixture])), userId, 8);
    expect(result[0]?.status).toBe(outcome);
  });
  it.each([{ current_match_id: null }, { latest_import_id: "correction", recording_date: "2026-09-08" }])(
    "keeps stale evidence on the original claimed day for review (%j)", async (change) => {
      const client = clientFor((url) => Response.json(url.pathname.endsWith("_ready") ? true : [{ ...row(), ...change }]));
      expect(await loadSwimActivity(client, userId, 8)).toEqual([{
        kind: "swim", id: row().id, title: expect.any(String), date: "2026-09-07", status: "needs_review",
      }]);
    },
  );
  it.each([0, 101, 1.5, NaN])("refuses invalid bounds before reading (%s)", async (limit) => {
    await expect(loadSwimActivity(clientFor(() => { throw new Error("Unexpected request"); }), userId, limit)).rejects.toThrow("Invalid activity limit");
  });
  it("allows a legacy missing function, but fails visibly on installed or transport errors", async () => {
    expect(await loadSwimActivity(clientFor(() => Response.json({ code: "PGRST202" }, { status: 404 })), userId, 8)).toEqual([]);
    for (const reply of [() => Response.json(false), () => Response.json({ code: "42501" }, { status: 403 }),
      (url: URL) => url.pathname.endsWith("_ready") ? Response.json(true) : Response.json({}, { status: 500 })]) {
      await expect(loadSwimActivity(clientFor(reply), userId, 8)).rejects.toThrow("could not be loaded");
    }
  });
  it.each([
    [row(), row()],
    [{ ...row(), user_id: "foreign" }],
    [{ ...row(), session_id: sessionId }],
    [{ ...row(), outcome_metadata: { ...row().outcome_metadata!, outcome: null } }],
    [{ ...row(), claim_recording_date: null }],
    [{ ...row(), claim_recording_date: "2026-02-30" }],
  ])("rejects duplicate, foreign or malformed returned claims (%#)", async (...rows) => {
    const client = clientFor((url) => Response.json(url.pathname.endsWith("_ready") ? true : rows));
    await expect(loadSwimActivity(client, userId, 8)).rejects.toThrow();
  });
  it("keeps empty history empty", async () => {
    expect(await loadSwimActivity(clientFor((url) => Response.json(url.pathname.endsWith("_ready") ? true : [])), userId, 8)).toEqual([]);
  });
  it("merges actual dates, caps the list and never adds native measurements to imported work", () => {
    const result = mergeTrainingActivity([native, { ...native, id: "old", performed_at: "2026-09-06T12:00:00Z" }],
      [swim], "America/Los_Angeles", 2);
    expect(result.map(({ kind, date }) => ({ kind, date }))).toEqual([
      { kind: "session", date: "2026-09-07" }, { kind: "swim", date: "2026-09-07" },
    ]);
    expect(result[0]).toMatchObject({ session: native });
    expect(result[1]).toBe(swim);
    expect(swim).not.toHaveProperty("session");
    expect(mergeTrainingActivity([{ ...native, completed_at: null }], [], "UTC", 1)[0]?.status).toBe("started");
  });
  it("formats imported calendar days without shifting them to the previous day", () => {
    expect(formatActivityDate(swim, { timezone: "America/Los_Angeles" })).toBe("09/07/2026");
    expect(formatActivityDate(swim, { timezone: "Europe/Helsinki" })).toBe("07/09/2026");
    expect(formatActivityDate(swim, { timezone: "America/Los_Angeles", date_format: "iso" })).toBe("2026-09-07");
    const [activity] = mergeTrainingActivity([native], [], "America/Los_Angeles", 1);
    expect(formatActivityDate(activity!, { timezone: "America/Los_Angeles", date_format: "iso" })).toBe("2026-09-07");
  });
  it("keeps native links and whitelists the swimming return path", () => {
    const [activity] = mergeTrainingActivity([native], [], "UTC", 1);
    expect(trainingActivityHref(activity!, "sessions")).toBe(`/app/sessions/${sessionId}`);
    expect(trainingActivityHref(swim, "sessions")).toBe("/app/swim/swim?from=sessions");
    expect(trainingActivityHref(swim, "today")).toBe("/app/swim/swim?from=today");
    expect(swimReturnDestination(parseSwimOrigin("sessions")).href).toBe("/app/sessions");
    for (const origin of ["https://elsewhere.test", "/app/settings", ["sessions"], null]) {
      expect(parseSwimOrigin(origin)).toBeUndefined();
      expect(swimReturnDestination(parseSwimOrigin(origin)).href).toBe("/app/swim");
    }
  });
});
