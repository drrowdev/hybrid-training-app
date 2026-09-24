import { createClient } from "@supabase/supabase-js";
import { swimCourseWorkoutTitle } from "@hta/domain";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadSwimActivity } from "../activity-history";
import { formatActivityDate, mergeTrainingActivity, trainingActivityHref, type NativeActivity, type SwimActivity } from "../activity-presentation";
import { parseSwimOrigin, swimReturnDestination, swimWorkoutHref, swimRecordingHref } from "../return-context";
import { swimFocusTitle } from "../presentation";
import { standaloneSwimStateColumns } from "../standalone-state";
import { loadRecordingSwimClaims } from "../recording-claims";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1);
const row = {
  id: id(2), user_id: user, plan_id: id(3), revision: 1, status: "scheduled", plan_status: "active",
  scheduled_date: "2026-09-22", session_id: null, visible_session_id: null, native_completed_at: null,
  outcome_id: id(4), outcome_match_id: id(5),
  outcome_metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 1 },
  current_match_id: id(5), matched_import_id: id(6), matched_workout_revision: 1, latest_import_id: id(6),
  recording_date: "2026-09-21", claim_import_id: id(6), claim_recording_date: "2026-09-21",
  definition: { slotId: "course-0-0", issued: { focus: "endurance" }, courseSource: { title: "Synthetic practice" } },
};
const missingMatch = {
  current_match_id: null, matched_import_id: null, matched_workout_revision: null,
  latest_import_id: null, recording_date: null,
};
const transport = vi.fn<typeof fetch>();
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
const loaded = (): SwimActivity => ({
  kind: "swim", id: row.id, importId: row.claim_import_id,
  title: swimCourseWorkoutTitle(row.definition.courseSource.title, row.definition.slotId),
  date: row.claim_recording_date, scheduledDate: row.scheduled_date, status: "completed",
});
const native: NativeActivity = {
  id: id(20), title: "Strength", performed_at: "2026-09-22T01:00:00Z",
  completed_at: "2026-09-22T02:00:00Z", session_rpe: 7, duration_min: 60,
};
beforeEach(() => transport.mockReset());

describe("DC-SW5/SW7/SW8 independent imported activity", () => {
  it("reads bounded owned claims and excludes native duplicates without a primary-program join", async () => {
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([row]));
    expect(await loadSwimActivity(client, user, 8)).toEqual([loaded()]);
    const url = new URL(String(transport.mock.calls[1]![0]));
    expect(url.pathname).toBe("/rest/v1/swim_import_outcome_activity");
    expect(url.searchParams.get("select")).toBe(`${standaloneSwimStateColumns},definition`);
    expect(url.searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(url.searchParams.get("session_id")).toBe("is.null");
    expect(url.searchParams.get("outcome_match_id")).toBe("not.is.null");
    expect(url.searchParams.get("order")).toBe("claim_recording_date.desc,id.desc");
    expect(url.searchParams.get("limit")).toBe("8");
    expect(transport).toHaveBeenCalledTimes(2);
  });
  it.each(["paused", "finished", "archived"])("retains completed and stopped-early history for %s plans", async (plan_status) => {
    for (const outcome of ["completed", "stopped_early"]) {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([{
        ...row, plan_status, outcome_metadata: { ...row.outcome_metadata, outcome },
      }]));
      expect(await loadSwimActivity(client, user, 8)).toEqual([{ ...loaded(), status: outcome }]);
    }
  });
  it.each([missingMatch, { latest_import_id: id(9), recording_date: "2026-09-23" }, { revision: 2 }])(
    "keeps the original claim date and recording navigation when evidence becomes stale: %j", async (change) => {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([{ ...row, ...change }]));
      const result = await loadSwimActivity(client, user, 8);
      expect(result).toEqual([{ ...loaded(), status: "needs_review" }]);
      expect(trainingActivityHref(result[0]!, "sessions")).toBe(`/app/swim/recordings/${id(6)}?workout=${row.id}&from=sessions`);
    },
  );
  it("reuses generated-workout display titles", async () => {
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([{
      ...row, definition: { slotId: "swim-0-0", issued: { focus: "technique_base" } },
    }]));
    expect((await loadSwimActivity(client, user, 8))[0]?.title).toBe(swimFocusTitle("technique_base"));
  });
  it.each([0, 101, -1, 1.5, NaN, Infinity])("rejects invalid bounds before reading (%s)", async (limit) => {
    await expect(loadSwimActivity(client, user, limit)).rejects.toThrow("Invalid activity limit.");
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects an invalid owner before reading", async () => {
    await expect(loadSwimActivity(client, "invalid", 8)).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { user_id: id(99) }, { session_id: id(20) }, { visible_session_id: id(20) },
    { claim_recording_date: "2026-02-30" }, { claim_import_id: null }, { outcome_metadata: null },
    { outcome_metadata: { ...row.outcome_metadata, outcome: null } },
    { definition: null }, { definition: { ...row.definition, slotId: "" } },
    { definition: { ...row.definition, courseSource: { title: "" } } },
    { definition: { ...row.definition, issued: { focus: "unknown" } } },
    { private_column: "private-value" },
  ])("rejects foreign, native, cleared and malformed rows without concealing them: %j", async (change) => {
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([{ ...row, ...change }]));
    await expect(loadSwimActivity(client, user, 8)).rejects.toThrow();
  });
  it.each([
    { data: null }, { data: {} }, { data: [row, row] },
    { data: Array.from({ length: 9 }, (_, index) => ({ ...row, id: id(index + 30) })) },
  ])(
    "rejects duplicate, over-limit or malformed responses: %#", async ({ data }) => {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(data));
      await expect(loadSwimActivity(client, user, 8)).rejects.toThrow();
    },
  );
  it("keeps missing capability and empty history distinct from failed installed storage", async () => {
    for (const code of ["PGRST202", "42883"]) {
      transport.mockResolvedValueOnce(response({ code }, 404));
      expect(await loadSwimActivity(client, user, 8)).toEqual([]);
    }
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([]));
    expect(await loadSwimActivity(client, user, 8)).toEqual([]);
    for (const result of [response(false), response({ code: "42501" }, 403)]) {
      transport.mockResolvedValueOnce(result);
      await expect(loadSwimActivity(client, user, 8)).rejects.toThrow();
    }
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response({ code: "42P01" }, 404));
    await expect(loadSwimActivity(client, user, 8)).rejects.toThrow();
  });
});

describe("DC-SW3/SW7 shared history presentation", () => {
  it("retains workout navigation without inventing a return origin", () => {
    expect(swimRecordingHref(id(6))).toBe(`/app/swim/recordings/${id(6)}`);
    expect(swimRecordingHref(id(6), undefined, id(2))).toBe(`/app/swim/recordings/${id(6)}?workout=${id(2)}`);
    expect(swimRecordingHref(id(6), "sessions", id(2))).toBe(`/app/swim/recordings/${id(6)}?workout=${id(2)}&from=sessions`);
  });
  it("sorts actual recording days beside local native days without fabricating native measures", () => {
    const swims = [loaded()];
    const sessions = [native, { ...native, id: id(21), performed_at: "2026-09-21T23:00:00Z" }];
    const original = structuredClone({ swims, sessions });
    const result = mergeTrainingActivity(sessions, swims, "America/Los_Angeles", 3);
    expect(result.map(({ kind, date }) => ({ kind, date }))).toEqual([
      { kind: "session", date: "2026-09-21" }, { kind: "session", date: "2026-09-21" },
      { kind: "swim", date: "2026-09-21" },
    ]);
    expect(result.map(({ id: activityId }) => activityId)).toEqual([native.id, id(21), row.id]);
    expect(result[2]).toBe(swims[0]);
    expect(Object.keys(result[2]!).sort()).toEqual(["date", "id", "importId", "kind", "scheduledDate", "status", "title"]);
    expect({ swims, sessions }).toEqual(original);
    expect(mergeTrainingActivity(sessions, swims, "UTC", 1)).toHaveLength(1);
    expect(mergeTrainingActivity([{ ...native, completed_at: null }], [], "UTC", 1)[0]?.status).toBe("started");
  });

  describe("DC-SW5/SW7/SW8 retained recording confirmations", () => {
    it("finds old claims independently of the current match and retains their removal identity", async () => {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([{ ...row, ...missingMatch }]));
      expect(await loadRecordingSwimClaims(client, user, id(6))).toEqual([{
        ...loaded(), status: "needs_review", outcomeId: row.outcome_id, workoutRevision: 1, claimedOutcome: "completed",
      }]);
      const url = new URL(String(transport.mock.calls[1]![0]));
      expect(url.pathname).toBe("/rest/v1/swim_import_outcome_activity");
      expect(url.searchParams.get("select")).toBe(`${standaloneSwimStateColumns},definition`);
      expect(url.searchParams.get("user_id")).toBe(`eq.${user}`);
      expect(url.searchParams.get("claim_import_id")).toBe(`eq.${id(6)}`);
      expect(url.searchParams.get("session_id")).toBe("is.null");
      expect(url.searchParams.get("limit")).toBe("101");
    });
    it("keeps two distinct retained workout claims visible after rematching the same recording", async () => {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([
        { ...row, ...missingMatch },
        { ...row, id: id(30), outcome_id: id(31), outcome_match_id: id(32), current_match_id: id(32),
          outcome_metadata: { ...row.outcome_metadata, outcome: "stopped_early" } },
      ]));
      const result = await loadRecordingSwimClaims(client, user, id(6));
      expect(result.map((claim) => [claim.id, claim.status, claim.outcomeId])).toEqual([
        [row.id, "needs_review", row.outcome_id], [id(30), "stopped_early", id(31)],
      ]);
    });
    it.each([
      { data: [row, row] }, { data: [{ ...row, claim_import_id: id(99) }] }, { data: [{ ...row, user_id: id(99) }] },
      { data: Array.from({ length: 101 }, (_, index) => ({ ...row, id: id(index + 100) })) },
    ])("refuses mismatched, duplicate or silently truncated claims: %#", async ({ data }) => {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(data));
      await expect(loadRecordingSwimClaims(client, user, id(6))).rejects.toThrow();
    });
    it("keeps removed or absent confirmations empty", async () => {
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([]));
      expect(await loadRecordingSwimClaims(client, user, id(6))).toEqual([]);
    });
    it("rejects invalid identities before any query", async () => {
      await expect(loadRecordingSwimClaims(client, "invalid", id(6))).rejects.toThrow();
      await expect(loadRecordingSwimClaims(client, user, "invalid")).rejects.toThrow();
      expect(transport).not.toHaveBeenCalled();
    });
    it("keeps only absent capability compatible; installed storage failures remain explicit", async () => {
      transport.mockResolvedValueOnce(response({ code: "PGRST202" }, 404));
      expect(await loadRecordingSwimClaims(client, user, id(6))).toEqual([]);
      transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response({ code: "42501" }, 403));
      await expect(loadRecordingSwimClaims(client, user, id(6))).rejects.toThrow();
    });
  });
  it("formats date-only recordings without timezone shifts", () => {
    expect(formatActivityDate(loaded(), { timezone: "America/Los_Angeles", date_format: "iso" })).toBe("2026-09-21");
    expect(formatActivityDate(loaded(), { timezone: "Europe/Helsinki", date_format: "iso" })).toBe("2026-09-21");
    const [activity] = mergeTrainingActivity([native], [], "America/Los_Angeles", 1);
    expect(formatActivityDate(activity!, { timezone: "America/Los_Angeles", date_format: "iso" })).toBe("2026-09-21");
  });
  it("preserves native links and whitelists return destinations for recordings and workouts", () => {
    const [activity] = mergeTrainingActivity([native], [], "UTC", 1);
    expect(trainingActivityHref(activity!, "sessions")).toBe(`/app/sessions/${native.id}`);
    expect(trainingActivityHref(loaded(), "today")).toBe(`/app/swim/recordings/${row.claim_import_id}?workout=${row.id}&from=today`);
    expect(swimWorkoutHref(row.id, "plan")).toBe(`/app/swim/${row.id}?from=plan`);
    for (const origin of ["today", "plan", "history", "sessions"]) {
      expect(parseSwimOrigin(origin)).toBe(origin);
    }
    expect(swimReturnDestination(parseSwimOrigin("sessions")).href).toBe("/app/sessions");
    for (const origin of ["https://elsewhere.invalid", "/app/settings", ["sessions"], null, undefined]) {
      expect(parseSwimOrigin(origin)).toBeUndefined();
      expect(swimReturnDestination(origin).href).toBe("/app/swim");
    }
  });
  it.each([0, 101, 1.5, NaN])("rejects invalid merged-list bounds (%s)", (limit) => {
    expect(() => mergeTrainingActivity([native], [loaded()], "UTC", limit)).toThrow("Invalid activity limit.");
  });
});
