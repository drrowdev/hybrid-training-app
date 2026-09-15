import { createClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { findHeavyOnRecoveringConflictWithMuscles } from "@/lib/muscle/muscle-conflict";
import { loadTodayMovementContext } from "../movement-context";

const id = "11111111-1111-4111-8111-111111111111";
const secondId = "22222222-2222-4222-8222-222222222222";
const movement = { id, display_name: "Back squat", slug: null, primary_region: "knee" };

function fixture(body: unknown, status = 200) {
  const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    expect(url.pathname).toBe("/rest/v1/movements");
    expect(url.searchParams.get("select")).toBe("id,display_name,slug,primary_region");
    expect(url.searchParams.get("id")).toBe(`in.(${id},${secondId})`);
    return new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
  });
  const client = createClient("https://example.invalid", "synthetic-test-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch },
  });
  return { client, fetch };
}

describe("DC-V2 Today movement context", () => {
  it("loads display names and preserves region and slug lookups for the planned IDs", async () => {
    const { client, fetch } = fixture([
      movement,
      { id: secondId, display_name: "Deadlift", slug: "barbell-deadlift", primary_region: "hamstring_posterior" },
    ]);
    const context = await loadTodayMovementContext(client, [id, secondId]);
    expect(fetch).toHaveBeenCalledOnce();
    expect(context.movementRegionById.get(id)).toEqual({ primaryRegion: "knee", name: "Back squat" });
    expect(context.movementRegionById.get(secondId)?.name).toBe("Deadlift");
    expect(context.movementSlugById.get(id)).toBeNull();
    expect(context.movementSlugById.get(secondId)).toBe("barbell-deadlift");

    const items = [{ kind: "main", movementId: id, percentTm: 85, reps: 5 }];
    expect(findHeavyOnRecoveringConflictWithMuscles(items, context.movementRegionById,
      new Map([["knee", { freshness: 0.1, regionLabel: "Knee" }]]), []))
      .toMatchObject({ movementName: "Back squat", regionLabel: "Knee", freshness: 0.1 });
    expect(findHeavyOnRecoveringConflictWithMuscles(items, context.movementRegionById,
      new Map([["knee", { freshness: 0.9, regionLabel: "Knee" }]]), [])).toBeNull();
  });

  it("does not query the catalog when no movements are planned", async () => {
    const { client, fetch } = fixture([]);
    const context = await loadTodayMovementContext(client, []);
    expect(fetch).not.toHaveBeenCalled();
    expect(context.movementRegionById.size).toBe(0);
    expect(context.movementSlugById.size).toBe(0);
  });

  it("preserves an empty catalog response without inventing movement details", async () => {
    const { client } = fixture([]);
    const context = await loadTodayMovementContext(client, [id, secondId]);
    expect(context.movementRegionById.size).toBe(0);
    expect(context.movementSlugById.size).toBe(0);
  });

  it.each([
    [400, { code: "42703", message: "PrivateSyntheticCanary" }],
    [200, null],
    [200, [{ ...movement, primary_region: null }]],
    [200, [{ id, name: "PrivateSyntheticCanary", slug: null, primary_region: "knee" }]],
  ])("surfaces failed or invalid reads without raw error or row contents (%s)", async (status, body) => {
    const { client } = fixture(body, status);
    let caught: unknown;
    try { await loadTodayMovementContext(client, [id, secondId]); }
    catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).not.toContain("PrivateSyntheticCanary");
  });
});
