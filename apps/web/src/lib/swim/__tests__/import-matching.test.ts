import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { exportSwimImportMatches, loadRecordingMatch, loadWorkoutRecordingMatches, matchSchema, swimImportMatchingAvailable } from "../import-matching";

const id = "11111111-1111-4111-8111-111111111111";
const event = {
  id, activity_id: "42", import_id: id, workout_id: id, revision: 1, created_at: "2026-09-15",
  metadata: { previousMatchId: null, workout: { revision: 1, date: "2026-09-15", title: "Synthetic swim", issued: {} } },
};
const recording = {
  id, activity_id: "42", revision: 1, received_at: "2026-09-15",
  evidence: {
    version: 1, source: "local_dashboard", activityId: "42", date: "2026-09-15", environment: "pool",
    workoutReference: null, distanceMetres: 300, recordedDurationMs: 300000, durationKind: "unspecified",
    nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] },
  },
};
function reader(results: { data: unknown; error: unknown }[]) {
  const filters: unknown[][] = [];
  const from = vi.fn((table: string) => {
    const result = results.shift();
    const builder = {
      select: () => builder,
      eq: (column: string, value: string) => { filters.push([table, column, value]); return builder; },
      in: () => builder, order: () => builder, limit: () => builder,
      maybeSingle: async () => result, single: async () => result,
      then: (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve),
    };
    return builder;
  });
  const client = { from, rpc: () => ({ abortSignal: async () => ({ data: true, error: null }) }) };
  return { client: client as never, filters, from };
}
describe("DC-SW8 matching storage contract", () => {
  it("loads exact evidence and the current association without replacing it with corrected evidence", async () => {
    const latestId = "22222222-2222-4222-8222-222222222222";
    const fixture = reader([
      { data: recording, error: null }, { data: event, error: null }, { data: { id: latestId }, error: null },
    ]);
    expect(await loadRecordingMatch(fixture.client, id, id)).toEqual({ recording, current: event, latestId });
    expect(fixture.filters.filter((filter) => filter[1] === "user_id")).toHaveLength(3);
    expect(fixture.filters).toContainEqual(["swim_current_import_matches", "activity_id", "42"]);
  });
  it("refuses malformed IDs before reading and handles an absent owned recording", async () => {
    const fixture = reader([{ data: null, error: null }]);
    expect(await loadRecordingMatch(fixture.client, id, "invalid")).toBeNull();
    expect(fixture.from).not.toHaveBeenCalled();
    expect(await loadRecordingMatch(fixture.client, id, id)).toBeNull();
    expect(fixture.from).toHaveBeenCalledTimes(1);
  });
  it("does not expose unreadable or invalid recording data", async () => {
    for (const result of [
      { data: null, error: { message: "SYNTHETIC_PRIVATE" } }, { data: { evidence: "SYNTHETIC_PRIVATE" }, error: null },
    ]) {
      await expect(loadRecordingMatch(reader([result]).client, id, id)).rejects.toThrow(/recording/i);
    }
  });
  it("shows matched immutable evidence summaries rather than a newer correction", async () => {
    const fixture = reader([
      { data: [event], error: null }, { data: [{ id, date: "2026-09-15", distance: 300 }], error: null },
    ]);
    expect(await loadWorkoutRecordingMatches(fixture.client, id, id)).toEqual([{ ...event, date: "2026-09-15", distance: 300 }]);
    expect(fixture.filters).toContainEqual(["swim_current_import_matches", "workout_id", id]);
    expect(fixture.filters).toContainEqual(["swim_imports", "user_id", id]);
  });
  it("refuses to silently omit a referenced recording", async () => {
    const fixture = reader([{ data: [event], error: null }, { data: [], error: null }]);
    await expect(loadWorkoutRecordingMatches(fixture.client, id, id)).rejects.toThrow("A matched recording could not be loaded.");
  });
  it("accepts audited matches and removals but not inconsistent identities", () => {
    expect(matchSchema.safeParse(event).success).toBe(true);
    expect(matchSchema.safeParse({ ...event, workout_id: null, metadata: { ...event.metadata, workout: null } }).success).toBe(true);
    expect(matchSchema.safeParse({ ...event, workout_id: null }).success).toBe(false);
  });
  it("only treats missing RPC as uninstalled storage", async () => {
    const client = (data: unknown, error: unknown): SupabaseClient =>
      ({ rpc: () => ({ abortSignal: async () => ({ data, error }) }) }) as never;
    expect(await swimImportMatchingAvailable(client(null, { code: "PGRST202" }))).toBe(false);
    expect(await swimImportMatchingAvailable(client(true, null))).toBe(true);
    await expect(swimImportMatchingAvailable(client(null, { code: "42501", message: "SYNTHETIC_PRIVATE" }))).rejects.toThrow("Recorded swims could not be loaded.");
    await expect(swimImportMatchingAvailable(client(false, null))).rejects.toThrow();
  });
  it("exports every audit page, including removals, even beyond the response row limit", async () => {
    const range = vi.fn().mockResolvedValueOnce({ data: Array.from({ length: 1000 }, () => event), error: null })
      .mockResolvedValueOnce({ data: [{ ...event, workout_id: null, metadata: { previousMatchId: id, workout: null } }], error: null });
    const eq = vi.fn(() => ({ order: () => ({ range }) }));
    const client = { from: vi.fn(() => ({ select: () => ({ eq }) })) };
    expect(await exportSwimImportMatches(client as never, id)).toHaveLength(1001);
    expect(range.mock.calls).toEqual([[0, 999], [1000, 1999]]);
    expect(eq).toHaveBeenCalledWith("user_id", id);
    expect(client.from).toHaveBeenCalledWith("swim_import_matches");
  });
  it("does not turn partial or invalid export history into success", async () => {
    for (const result of [{ data: null, error: { message: "SYNTHETIC_PRIVATE" } }, { data: [{}], error: null }]) {
      const client = { from: () => ({ select: () => ({ eq: () => ({ order: () => ({ range: async () => result }) }) }) }) };
      await expect(exportSwimImportMatches(client as never, id)).rejects.toThrow("Swimming matches could not be exported.");
    }
  });
  it("keeps the current projection invoker-owned and the mutation scoped to authenticated matching", () => {
    const root = new URL("../../../../../../packages/db/", import.meta.url);
    const sql = readFileSync(new URL("drizzle/0153_swim_import_matching.sql", root), "utf8");
    const down = readFileSync(new URL("rollbacks/0153_swim_import_matching.down.sql", root), "utf8");
    expect(sql).toContain("WITH (security_invoker = true)");
    expect(sql).toContain("USING ((SELECT auth.uid()) = user_id)");
    expect(sql).toContain("REFERENCES public.swim_imports(user_id, activity_id, id)");
    expect(sql).toContain("REFERENCES public.swim_workouts(user_id, id)");
    expect(sql).toContain("SET row_security = on");
    expect(sql).toContain("OWNER TO swim_writer");
    expect(sql).toContain("SWIM_MATCH_RECORDING_CHANGED");
    expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM) public\.(sessions|cardio_logs|swim_workouts|swim_plans)/);
    expect(down).toContain("IF EXISTS (SELECT 1 FROM public.swim_import_matches)");
    expect(down).not.toMatch(/DELETE FROM|TRUNCATE|CASCADE/);
  });
});
