import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadStandaloneSwimStates, standaloneSwimState, standaloneSwimStateColumns } from "../standalone-state";

const user = "11111111-1111-4111-8111-111111111111";
const workout = "22222222-2222-4222-8222-222222222222";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const row = {
  id: workout, user_id: user, plan_id: id(1), revision: 1, status: "scheduled", plan_status: "active",
  scheduled_date: "2026-09-22", session_id: null, visible_session_id: null, native_completed_at: null,
  outcome_id: id(2), outcome_match_id: id(3),
  outcome_metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 1 },
  current_match_id: id(3), matched_import_id: id(4), matched_workout_revision: 1, latest_import_id: id(4),
  recording_date: "2026-09-21", claim_import_id: id(4), claim_recording_date: "2026-09-21",
};
const missingMatch = {
  current_match_id: null, matched_import_id: null, matched_workout_revision: null,
  latest_import_id: null, recording_date: null,
};
const unconfirmed = {
  ...row, ...missingMatch, outcome_id: null, outcome_match_id: null, outcome_metadata: null,
  claim_import_id: null, claim_recording_date: null,
};
const transport = vi.fn<typeof fetch>();
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const response = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
  status, headers: { "content-type": "application/json" },
});
beforeEach(() => transport.mockReset());

describe("DC-SW5/SW6/SW7/SW8 standalone outcome projection", () => {
  it("retains the explicit claim without inventing a native result or changing its schedule date", () => {
    const before = structuredClone(row);
    expect(standaloneSwimState(row, user)).toEqual({
      status: "completed", completed: true, settled: true, actionable: false,
      id: workout, planId: id(1), workoutRevision: 1, scheduledDate: "2026-09-22", outcomeId: id(2),
      claim: { outcome: "completed", importId: id(4), recordedDate: "2026-09-21" },
    });
    expect(row).toEqual(before);
  });
  it("uses the same pure state for stopped early and unconfirmed work", () => {
    expect(standaloneSwimState({ ...row, outcome_metadata: { ...row.outcome_metadata, outcome: "stopped_early" } }, user))
      .toMatchObject({ status: "stopped_early", completed: false, settled: true, actionable: false });
    expect(standaloneSwimState(unconfirmed, user))
      .toMatchObject({ status: "scheduled", completed: false, settled: false, actionable: true, claim: null });
  });
  it.each([{ latest_import_id: id(5) }, { revision: 2 }, missingMatch])(
    "keeps stale or detached claims reachable without treating them as current: %j", (change) => {
      expect(standaloneSwimState({ ...row, ...change }, user)).toMatchObject({
        status: "needs_review", completed: false, settled: false, actionable: true,
        claim: { outcome: "completed", importId: id(4), recordedDate: "2026-09-21" },
      });
    },
  );
  it("keeps the latest removal identity without retaining a cleared claim", () => {
    expect(standaloneSwimState({
      ...unconfirmed, outcome_id: id(6),
      outcome_metadata: { outcome: null, previousOutcomeId: id(2), workoutRevision: null },
    }, user)).toMatchObject({ status: "scheduled", outcomeId: id(6), claim: null });
  });
  it.each(["paused", "finished", "archived"])("retains %s history without choosing it as next", (plan_status) => {
    expect(standaloneSwimState({ ...row, plan_status }, user))
      .toMatchObject({ status: "completed", actionable: false });
    expect(standaloneSwimState({ ...row, ...missingMatch, plan_status }, user))
      .toMatchObject({ status: "needs_review", actionable: false });
  });
  it("lets legacy native history take precedence and does not revive deleted work", () => {
    expect(standaloneSwimState({
      ...row, session_id: id(7), visible_session_id: id(7), native_completed_at: "2026-09-22T10:00:00+00:00",
    }, user)).toMatchObject({ status: "completed", completed: true });
    expect(standaloneSwimState({ ...row, session_id: id(7) }, user))
      .toMatchObject({ status: "unavailable", completed: false, actionable: false });
  });
  it.each([
    { user_id: id(99) }, { plan_status: "unsupported" }, { scheduled_date: "2026-02-30" },
    { claim_recording_date: "private-value" }, { outcome_id: null }, { outcome_match_id: null },
    { outcome_metadata: { ...row.outcome_metadata, workoutRevision: null } },
    { outcome_metadata: { ...row.outcome_metadata, guessedLoad: 3 } },
    { current_match_id: id(99) }, { matched_import_id: null }, { latest_import_id: null },
    { matched_import_id: id(99) }, { matched_workout_revision: 2 }, { recording_date: "2026-09-20" },
    { current_match_id: null }, { claim_import_id: null }, { claim_recording_date: null },
    { visible_session_id: id(7) }, { native_completed_at: "2026-09-22T10:00:00Z" },
    { private_column: "private-value" },
  ])("refuses malformed or inconsistent rows without echoing their contents: %j", (change) => {
    expect(() => standaloneSwimState({ ...row, ...change }, user)).toThrow("The swim outcome could not be loaded.");
  });
});

describe("DC-SW8 standalone outcome reads", () => {
  it("reads exact owned columns and deduplicates requested workout identities", async () => {
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([row]));
    const result = await loadStandaloneSwimStates(client, user, [workout, workout]);
    expect(result).toEqual(new Map([[workout, standaloneSwimState(row, user)]]));
    const request = new URL(String(transport.mock.calls[1]![0]));
    expect(request.pathname).toBe("/rest/v1/swim_import_outcome_activity");
    expect(request.searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(request.searchParams.get("id")).toBe(`in.(${workout})`);
    expect(request.searchParams.get("select")).toBe(standaloneSwimStateColumns);
    expect(request.searchParams.get("limit")).toBe("101");
  });
  it("reads every batch with an owner filter and refuses partial results", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ ...unconfirmed, id: id(index + 100) }));
    const last = { ...unconfirmed, id: id(200) };
    const ids = [...first.map((value) => value.id), last.id];
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response([last]));
    expect((await loadStandaloneSwimStates(client, user, ids)).size).toBe(101);
    expect(transport.mock.calls.slice(1).every(([request]) =>
      new URL(String(request)).searchParams.get("user_id") === `eq.${user}`)).toBe(true);
    transport.mockReset().mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(first))
      .mockResolvedValueOnce(response([]));
    await expect(loadStandaloneSwimStates(client, user, ids)).rejects.toThrow();
  });
  it.each([
    { data: null }, { data: [] }, { data: [row, row] }, { data: [{ ...row, id: id(99) }] },
    { data: [{ ...row, user_id: id(99) }] }, { data: [{ ...row, revision: 0 }] },
  ])("refuses absent, extra, foreign or malformed rows: %#", async ({ data }) => {
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response(data));
    await expect(loadStandaloneSwimStates(client, user, [workout])).rejects.toThrow();
  });
  it("rejects duplicate rows even when the response count matches the requested count", async () => {
    transport.mockResolvedValueOnce(response(true)).mockResolvedValueOnce(response([row, row]));
    await expect(loadStandaloneSwimStates(client, user, [workout, id(99)])).rejects.toThrow();
  });
  it("falls back only for an absent capability, not for permissions or malformed data", async () => {
    for (const code of ["PGRST202", "42883"]) {
      transport.mockResolvedValueOnce(response({ code }, 404));
      expect((await loadStandaloneSwimStates(client, user, [workout])).size).toBe(0);
    }
    for (const result of [response(false), response({ code: "42501", message: "private-value" }, 403)]) {
      transport.mockResolvedValueOnce(result);
      await expect(loadStandaloneSwimStates(client, user, [workout])).rejects.toThrow();
    }
    transport.mockResolvedValueOnce(response(true))
      .mockResolvedValueOnce(response({ code: "42P01", message: "private-value" }, 404));
    await expect(loadStandaloneSwimStates(client, user, [workout])).rejects.toThrow();
  });
  it("validates input and handles an empty selection without network access", async () => {
    expect((await loadStandaloneSwimStates(client, user, [])).size).toBe(0);
    await expect(loadStandaloneSwimStates(client, "invalid", [workout])).rejects.toThrow();
    await expect(loadStandaloneSwimStates(client, user, ["invalid"])).rejects.toThrow();
    expect(transport).not.toHaveBeenCalled();
  });
});
