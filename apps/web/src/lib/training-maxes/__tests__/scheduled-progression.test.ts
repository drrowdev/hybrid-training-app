import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { generateScheduledProgression, progressionStorageUnavailable } from "../scheduled-progression";

const owner = "00000000-0000-4000-8000-000000000001";
const movementId = "00000000-0000-4000-8000-000000000002";
const blockId = "00000000-0000-4000-8000-000000000003";

function fixture(error: { code: string; message: string } | null = null) {
  const requests: unknown[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    const table = url.pathname.split("/").at(-1);
    if (url.pathname.includes("/rpc/")) {
      requests.push(JSON.parse(String(init?.body)));
      return error ? Response.json(error, { status: 400 }) : Response.json(1);
    }
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    if (table === "planned_sessions") return Response.json([{ block_id: blockId, prescription: { items: [{
      movementId, percentTm: 80, meta: { programLoadBasis: { version: 1, kind: "one-rm", percent: 100, roundingKg: null } },
    }] } }]);
    if (table === "training_maxes") return Response.json([{ movement_id: movementId, one_rm_kg: "100", updated_at: "2026-01-01T00:00:00Z",
      movements: { pattern: "press", primary_region: "shoulder_scapular", primary_muscles: ["chest"] } }]);
    if (table === "tm_suggestions") return Response.json([]);
    throw new Error(`Unexpected request ${url.pathname}`);
  });
  return { client: createClient("https://synthetic.invalid", "test-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  }), fetch, requests };
}

describe("scheduled progression app-first storage", () => {
  it("sends exact domain proposals with an optimistic max revision", async () => {
    const { client, requests } = fixture();
    const result = await generateScheduledProgression(client, owner, [{ id: blockId, programKind: "strength" }], { units: "metric" });
    expect(result.available).toBe(true);
    expect(result.activeMovementIds).toEqual(new Set([movementId]));
    expect(requests).toEqual([{ p_candidates: [{
      movementId, currentOneRmKg: 100, proposedOneRmKg: 101.5, updatedAt: "2026-01-01T00:00:00Z",
    }] }]);
  });
  it.each([
    { code: "PGRST202", message: "Could not find generate_scheduled_max_progression" },
    { code: "23514", message: 'new row violates check constraint "tm_suggestions_source_chk"' },
  ])("fails closed only for the known 0161 gap ($code)", async (error) => {
    const { client } = fixture(error);
    expect((await generateScheduledProgression(client, owner, [{ id: blockId, programKind: "strength" }], { units: "metric" })).available).toBe(false);
  });
  it.each([
    { code: "42501", message: "permission denied" },
    { code: "23514", message: "another_constraint" },
    { code: "PGRST202", message: "another_function" },
  ])("does not hide unexpected storage failures ($code)", async (error) => {
    const { client } = fixture(error);
    expect(progressionStorageUnavailable(error)).toBe(false);
    await expect(generateScheduledProgression(client, owner, [{ id: blockId, programKind: "strength" }], { units: "metric" }))
      .rejects.toThrow("Couldn't prepare 1RM suggestions");
  });
  it("does no storage work for imperial or opted-out profiles", async () => {
    const { client, fetch } = fixture();
    await generateScheduledProgression(client, owner, [], { units: "imperial" });
    await generateScheduledProgression(client, owner, [], { units: "metric", intake: { suggestScheduled1RmIncreases: false } });
    expect(fetch).not.toHaveBeenCalled();
  });
});
