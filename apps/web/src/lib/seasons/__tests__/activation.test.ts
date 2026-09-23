import { createClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: async () => ({ data: { user: { id: owner } } }),
  createClient: async () => client,
}));
import { assertSeasonProgramReplacement, assertSeasonProgramSetup, loadSeasonProgramOrigin } from "../activation";
import { getSeasonContinuation } from "../queries";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const owner = id(1), seasonId = id(2), slotId = id(3), previousId = id(4);
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>, failure: string | null, requests: URL[];
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (input, init) => {
    expect(init?.method ?? "GET").toBe("GET");
    const url = new URL(input instanceof Request ? input.url : String(input));
    requests.push(url);
    expect(url.searchParams.get("user_id")).toBe(`eq.${owner}`);
    const table = url.pathname.split("/").at(-1)!;
    if (failure === table) return Response.json({ code: "42501", message: "Refused" }, { status: 403 });
    const rows = (tables[table] ?? []).filter((row) => [...url.searchParams].every(([key, value]) =>
      value.startsWith("eq.") ? String(row[key]) === value.slice(3) : value !== "is.null" || row[key] === null));
    if (url.searchParams.has("order")) rows.sort((a, b) => Number(a.position) - Number(b.position));
    return Response.json(new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object")
      ? rows[0] ?? null : rows);
  } },
});

beforeEach(() => {
  failure = null; requests = [];
  tables = {
    training_seasons: [{ id: seasonId, user_id: owner, name: "Spring roadmap", status: "active", deleted_at: null,
      goal_type: "event", target_date: "2027-02-01", target_event_id: id(9) }],
    season_blocks: [
      { id: id(5), season_id: seasonId, user_id: owner, position: 0, program_id: "wendler-531",
        template_ref: null, emphasis: "base", intent_note: null, planned_weeks: 4, status: "active", block_id: previousId },
      { id: slotId, season_id: seasonId, user_id: owner, position: 1, program_id: "green-protocol",
        template_ref: "velocity", emphasis: "endurance_bias", intent_note: "Spring", planned_weeks: 8,
        status: "planned", block_id: null },
    ],
    training_blocks: [{ id: previousId, user_id: owner, status: "active", deleted_at: null, notes: "Autumn strength",
      started_on: "2026-09-21", weeks: 4 }],
  };
});

describe("DC-R5 owned season setup and independent program lifecycle", () => {
  it("reads exact season, next slot, goal and predecessor without activating anything", async () => {
    const origin = await loadSeasonProgramOrigin(client, owner, slotId);
    expect(origin.snapshot).toMatchObject({ id: slotId,
      season: { id: seasonId, goal_type: "event", target_date: "2027-02-01" },
      blocks: [{ block_id: previousId, status: "active" }, { template_ref: "velocity", emphasis: "endurance_bias" }] });
    expect(origin.predecessor?.id).toBe(previousId);
    expect(tables.season_blocks![1]!.status).toBe("planned");
    expect(requests.at(-1)?.searchParams.get("id")).toBe(`eq.${previousId}`);
    expect(() => assertSeasonProgramSetup(origin, "green-protocol", { phaseId: "velocity" })).not.toThrow();
    expect(() => assertSeasonProgramSetup(origin, "green-protocol", { templateId: "velocity" })).toThrow();
    expect(() => assertSeasonProgramSetup(origin, "tactical-barbell", { phaseId: "velocity" })).toThrow();
    expect(() => assertSeasonProgramReplacement(origin)).toThrow("Autumn strength");
    expect(() => assertSeasonProgramReplacement(origin, id(99))).toThrow();
    expect(() => assertSeasonProgramReplacement(origin, previousId)).not.toThrow();
  });

  it.each(["wendler-531", "tactical-barbell"])("matches the %s template rather than a phase", async (program) => {
    tables.season_blocks![1]!.program_id = program;
    tables.season_blocks![1]!.template_ref = "selected-template";
    const origin = await loadSeasonProgramOrigin(client, owner, slotId);
    expect(() => assertSeasonProgramSetup(origin, program, { templateId: "selected-template" })).not.toThrow();
    expect(() => assertSeasonProgramSetup(origin, program, { phaseId: "selected-template" })).toThrow();
  });

  it.each(["completed", "archived"])("can advance after explicitly %s predecessor", async (status) => {
    tables.training_blocks![0]!.status = status;
    const origin = await loadSeasonProgramOrigin(client, owner, slotId);
    expect(() => assertSeasonProgramReplacement(origin)).not.toThrow();
  });

  it.each([
    ["training_seasons", 0, "user_id", id(99)], ["training_seasons", 0, "status", "abandoned"],
    ["training_seasons", 0, "deleted_at", "2026-09-23T00:00:00Z"],
    ["season_blocks", 1, "user_id", id(99)], ["season_blocks", 1, "status", "done"],
    ["season_blocks", 1, "block_id", previousId], ["season_blocks", 0, "status", "planned"],
    ["season_blocks", 0, "position", -1], ["season_blocks", 0, "block_id", null],
    ["training_blocks", 0, "user_id", id(99)],
  ])("refuses a stale or unavailable %s.%s.%s", async (table, index, field, value) => {
    tables[String(table)]![Number(index)]![String(field)] = value;
    await expect(loadSeasonProgramOrigin(client, owner, slotId)).rejects.toThrow();
  });

  it.each(["training_seasons", "season_blocks", "training_blocks"])("surfaces %s read errors", async (table) => {
    failure = table;
    await expect(loadSeasonProgramOrigin(client, owner, slotId)).rejects.toThrow();
  });

  it("can start the first roadmap step without a predecessor", async () => {
    tables.season_blocks!.shift();
    const origin = await loadSeasonProgramOrigin(client, owner, slotId);
    expect(origin.predecessor).toBeNull();
    expect(() => assertSeasonProgramReplacement(origin)).not.toThrow();
  });

  it("keeps the next roadmap step visible after completion or explicit end, not an unrelated program's final week", async () => {
    const now = new Date("2026-09-23T12:00:00Z");
    tables.training_blocks!.push({ id: id(90), user_id: owner, status: "active", deleted_at: null,
      started_on: "2026-08-01", weeks: 1 });
    expect(await getSeasonContinuation("UTC", now)).toBeNull();
    for (const status of ["completed", "archived"]) {
      tables.training_blocks![0]!.status = status;
      expect(await getSeasonContinuation("UTC", now)).toMatchObject({
        seasonName: "Spring roadmap", block: { id: slotId, programId: "green-protocol" },
      });
    }
    tables.training_blocks![0]!.status = "active";
    tables.training_blocks![0]!.started_on = "2026-08-01";
    expect(await getSeasonContinuation("UTC", now)).toMatchObject({ block: { id: slotId } });
    tables.training_blocks![0]!.deleted_at = "2026-09-23T00:00:00Z";
    expect(await getSeasonContinuation("UTC", now)).toBeNull();
  });
});
