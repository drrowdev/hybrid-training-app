import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it } from "vitest";
import { loadProgramRecommendationOrigin, matchesRecommendationSetup } from "../recommendation-origin";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = id(1), recommendationId = id(2), blockId = id(3), instanceId = id(4);
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>, requests: URL[], failure: string | null;
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    const table = url.pathname.split("/").at(-1)!;
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    if (failure === table) return Response.json({ code: "42501", message: "Refused" }, { status: 403 });
    const rows = (tables[table] ?? []).filter((row) => [...url.searchParams].every(([key, value]) =>
      !value.startsWith("eq.") || String(row[key]) === value.slice(3)));
    return Response.json(new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object")
      ? rows[0] ?? null : rows);
  } },
});

beforeEach(() => {
  requests = []; failure = null;
  tables = {
    program_recommendations: [{
      id: recommendationId, user_id: owner, block_id: blockId, program_instance_id: instanceId,
      kind: "next-block", status: "pending", occurrence_key: "phase-end", detail: "Review the next phase.",
      data: { programId: "green-protocol", nextPhaseId: "velocity", nextPhaseName: "Velocity" },
    }],
    training_blocks: [{ id: blockId, user_id: owner, program_kind: "hybrid", status: "completed", deleted_at: null }],
    program_instances: [{
      id: instanceId, block_id: blockId, user_id: owner, program_id: "green-protocol", status: "archived", deleted_at: null,
    }],
  };
});

describe("DC-R5 exact recommendation setup origin", () => {
  it("loads completed advice without writes and binds its phase, instance and fixed program type", async () => {
    const origin = await loadProgramRecommendationOrigin(client, owner, recommendationId);
    expect(origin).toMatchObject({ recommendationId, blockId, kind: "next-block", programId: "green-protocol", phaseId: "velocity",
      snapshot: { id: recommendationId, block_id: blockId, program_instance_id: instanceId, program_kind: "hybrid",
        kind: "next-block", occurrence_key: "phase-end" } });
    expect(matchesRecommendationSetup(origin, "green-protocol", { phaseId: "velocity" })).toBe(true);
    expect(matchesRecommendationSetup(origin, "green-protocol", { phaseId: "capacity" })).toBe(false);
    expect(matchesRecommendationSetup(origin, "tactical-barbell", { phaseId: "velocity" })).toBe(false);
    expect(tables.program_recommendations![0]!.status).toBe("pending");
    expect(requests.find((url) => url.pathname.endsWith("/program_instances"))?.searchParams.get("block_id")).toBe(`eq.${blockId}`);
  });

  it("keeps legacy classification null without guessing from the engine", async () => {
    tables.training_blocks![0]!.program_kind = null;
    expect((await loadProgramRecommendationOrigin(client, owner, recommendationId)).snapshot.program_kind).toBeNull();
  });

  it("scopes recovery to the source program rather than a pending account-wide hint", async () => {
    tables.program_recommendations![0]!.kind = "deload";
    tables.program_recommendations![0]!.data = null;
    const origin = await loadProgramRecommendationOrigin(client, owner, recommendationId);
    expect(origin).toMatchObject({ kind: "deload", programId: "green-protocol", recoveryWarning: expect.any(String) });
    expect(origin.phaseId).toBeUndefined();
    expect(matchesRecommendationSetup(origin, "tactical-barbell", {})).toBe(false);
    expect(matchesRecommendationSetup(origin, "green-protocol", {})).toBe(true);
  });

  it.each([
    ["program_recommendations", "user_id", id(99)], ["program_recommendations", "status", "accepted"],
    ["program_recommendations", "kind", "info"], ["program_recommendations", "data", { nextBlock: 2 }],
    ["training_blocks", "user_id", id(99)], ["training_blocks", "status", "archived"],
    ["training_blocks", "deleted_at", "2026-09-23T00:00:00Z"],
    ["program_instances", "user_id", id(99)], ["program_instances", "block_id", id(99)],
    ["program_instances", "deleted_at", "2026-09-23T00:00:00Z"],
  ])("refuses an unavailable or mismatched %s.%s", async (table, field, value) => {
    tables[String(table)]![0]![String(field)] = value;
    await expect(loadProgramRecommendationOrigin(client, owner, recommendationId)).rejects.toThrow();
  });

  it.each(["program_recommendations", "training_blocks", "program_instances"])("surfaces a %s read failure", async (table) => {
    failure = table;
    await expect(loadProgramRecommendationOrigin(client, owner, recommendationId)).rejects.toThrow();
  });

  it("does not accept an archived instance under a still-active source block", async () => {
    tables.training_blocks![0]!.status = "active";
    await expect(loadProgramRecommendationOrigin(client, owner, recommendationId)).rejects.toThrow();
  });
});
