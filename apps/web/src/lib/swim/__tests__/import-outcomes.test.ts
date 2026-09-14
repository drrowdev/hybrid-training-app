import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportSwimImportOutcomes, importOutcomeSchema, loadSwimImportOutcome, swimImportOutcomesAvailable } from "../import-outcomes";

const user = "11111111-1111-4111-8111-111111111111";
const workout = "22222222-2222-4222-8222-222222222222";
const row = {
  id: "33333333-3333-4333-8333-333333333333", workout_id: workout,
  match_id: "44444444-4444-4444-8444-444444444444", revision: 1, created_at: "2026-09-14T00:00:00Z",
  metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 3 },
};
const transport = vi.fn<typeof fetch>();
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { "content-type": "application/json" },
});
beforeEach(() => transport.mockReset());

describe("DC-SW5/SW8 imported outcome reads", () => {
  it.each(["completed", "stopped_early", null])("accepts %s without fabricating evidence", (outcome) => {
    expect(importOutcomeSchema.safeParse({ ...row, match_id: outcome === null ? null : row.match_id,
      metadata: { ...row.metadata, outcome, workoutRevision: outcome === null ? null : 3 } }).success).toBe(true);
  });
  it.each([
    { ...row, metadata: { ...row.metadata, outcome: null } },
    { ...row, match_id: null },
    { ...row, metadata: { ...row.metadata, workoutRevision: 1.5 } },
    { ...row, metadata: { ...row.metadata, workoutRevision: null } },
    { ...row, metadata: { ...row.metadata, movingSeconds: 100 } },
  ])("rejects inconsistent or expanded persisted outcomes", (value) => {
    expect(importOutcomeSchema.safeParse(value).success).toBe(false);
  });
  it("distinguishes missing capability from an unreadable or malformed response", async () => {
    transport.mockResolvedValueOnce(response(true));
    expect(await swimImportOutcomesAvailable(client)).toBe(true);
    transport.mockResolvedValueOnce(response({ code: "PGRST202" }, 404));
    expect(await swimImportOutcomesAvailable(client)).toBe(false);
    for (const result of [response(false), response({ code: "42501", message: "SYNTHETIC_PRIVATE" }, 403)]) {
      transport.mockResolvedValueOnce(result);
      await expect(swimImportOutcomesAvailable(client)).rejects.toThrow(/Swim outcomes/);
    }
  });
  it("scopes a current read to the owner and workout, including an explicit removal", async () => {
    const removed = { ...row, match_id: null, metadata: { outcome: null, previousOutcomeId: row.id, workoutRevision: null } };
    transport.mockResolvedValueOnce(response(removed));
    expect(await loadSwimImportOutcome(client, user, workout)).toEqual(removed);
    const url = new URL(String(transport.mock.calls[0]![0]));
    expect(url.pathname).toBe("/rest/v1/swim_current_import_outcomes");
    expect(url.searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(url.searchParams.get("workout_id")).toBe(`eq.${workout}`);
    transport.mockResolvedValueOnce(response(null));
    expect(await loadSwimImportOutcome(client, user, workout)).toBeNull();
  });
  it("fails rather than returning an empty history on an unreadable current row", async () => {
    for (const result of [response({ wrong: true }), response({ code: "42501", message: "SYNTHETIC_PRIVATE" }, 403)]) {
      transport.mockResolvedValueOnce(result);
      await expect(loadSwimImportOutcome(client, user, workout)).rejects.toThrow("The swim outcome could not be loaded.");
    }
  });
  it("exports every page, including superseded claims and removals", async () => {
    const first = Array.from({ length: 1000 }, (_, index) => ({
      ...row, id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`, revision: index + 1,
    }));
    const last = { ...row, match_id: null, revision: 1001,
      metadata: { outcome: null, previousOutcomeId: first[999]!.id, workoutRevision: null } };
    transport.mockResolvedValueOnce(response(first)).mockResolvedValueOnce(response([last]));
    expect(await exportSwimImportOutcomes(client, user)).toEqual([...first, last]);
    const urls = transport.mock.calls.map(([url]) => new URL(String(url)));
    expect(urls.map((url) => url.searchParams.get("offset"))).toEqual(["0", "1000"]);
    expect(urls.every((url) => url.searchParams.get("user_id") === `eq.${user}` &&
      url.searchParams.get("limit") === "1000" && url.searchParams.get("order") === "id.asc")).toBe(true);
  });
  it("does not conceal a failure after the first export page", async () => {
    transport.mockResolvedValueOnce(response(Array.from({ length: 1000 }, () => row)))
      .mockResolvedValueOnce(response({ code: "42501", message: "SYNTHETIC_PRIVATE" }, 403));
    await expect(exportSwimImportOutcomes(client, user)).rejects.toThrow("Swim outcomes could not be exported.");
  });
});
