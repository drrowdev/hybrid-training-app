import * as db from "@hta/db";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/me/export/route";
import { standaloneOutcomeExportSchema, standaloneOutcomeNativeQueries } from "../../../../e2e/fixtures/standalone-outcomes";
import type { SwimImportOutcome } from "../import-outcomes";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), workout = id(2), recording = id(3), match = id(4);
const recordedDate = "2026-09-21";
const receipts: SwimImportOutcome[] = [
  { id: id(6), workout_id: workout, match_id: match, revision: 1, created_at: "2026-09-22T00:00:00Z",
    metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 1 } },
  { id: id(7), workout_id: workout, match_id: match, revision: 2, created_at: "2026-09-22T00:01:00Z",
    metadata: { outcome: "stopped_early", previousOutcomeId: id(6), workoutRevision: 1 } },
  { id: id(8), workout_id: workout, match_id: null, revision: 3, created_at: "2026-09-22T00:02:00Z",
    metadata: { outcome: null, previousOutcomeId: id(7), workoutRevision: null } },
];
const tables = new Map<string, Set<string>>();
for (const value of Object.values(db)) {
  if (typeof value !== "object" || value === null || !Reflect.has(value, Symbol.for("drizzle:Columns"))) continue;
  const columns = z.record(z.object({ name: z.string() })).parse(Reflect.get(value, Symbol.for("drizzle:Columns")));
  tables.set(z.string().parse(Reflect.get(value, Symbol.for("drizzle:Name"))),
    new Set(Object.values(columns).map(({ name }) => name)));
}
const transport = vi.fn<typeof fetch>();
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const requests: URL[] = [], invalidQueries: URL[] = [];

function validColumns(url: URL): boolean {
  const table = url.pathname.split("/").at(-1)!, columns = tables.get(table);
  if (!columns) return false;
  const selected = url.searchParams.get("select")!;
  const required: string[] = [];
  if (selected === "id,sessions!inner(user_id)") {
    required.push("id", "session_id");
    if (!tables.get("sessions")?.has("user_id")) return false;
  } else if (selected === "*,movement:movements(slug,display_name)") {
    required.push("movement_id");
    if (!["slug", "display_name"].every((key) => tables.get("movements")?.has(key))) return false;
  } else required.push(...selected.split(",").filter((key) => key !== "*"));
  for (const [key, value] of url.searchParams) {
    if (key === "order") required.push(...value.split(",").map((order) => order.split(".")[0]!));
    else if (key === "sessions.user_id") {
      if (selected !== "id,sessions!inner(user_id)") return false;
    } else if (!["select", "offset", "limit"].includes(key)) required.push(key);
  }
  return required.every((key) => columns.has(key));
}

beforeEach(() => {
  vi.clearAllMocks(); requests.length = 0; invalidQueries.length = 0;
  mocks.client.mockResolvedValue(client);
  transport.mockImplementation(async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.startsWith("/rest/v1/rpc/")) {
      expect(["swim_storage_ready", "swim_import_storage_ready", "swim_import_matching_ready", "swim_import_outcomes_ready", "independent_programs_ready"])
        .toContain(url.pathname.split("/").at(-1));
      return Response.json(true);
    }
    expect(init?.method).toBe("GET");
    if (!validColumns(url)) {
      invalidQueries.push(url);
      return Response.json({ code: "42703", message: "Unknown fixture column." }, { status: 400 });
    }
    const table = url.pathname.split("/").at(-1);
    if (table === "profiles") return Response.json({ id: user });
    if (table === "swim_import_outcomes") return Response.json(receipts);
    if (table === "swim_imports") return Response.json([{
      id: recording, activity_id: "42", revision: 1, received_at: "2026-09-21T00:00:00Z",
      evidence: { version: 1, source: "local_dashboard", activityId: "42", date: recordedDate, environment: "pool",
        workoutReference: null, distanceMetres: 350, recordedDurationMs: 900000, durationKind: "unspecified",
        nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] } },
    }]);
    return Response.json([]);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW5/SW8 M7 storage and export schema contract", () => {
  it("reproduces the invalid direct ownership filter on both session-child tables", async () => {
    for (const table of ["cardio_logs", "set_logs"]) {
      expect(tables.get(table)?.has("user_id")).toBe(false);
      expect(tables.get(table)?.has("session_id")).toBe(true);
      const result = await client.from(table).select("id").eq("user_id", user);
      expect(result.error?.code).toBe("42703");
    }
    expect(invalidQueries).toHaveLength(2);
  });

  it("executes every native no-fabrication query with schema-correct explicit ownership", async () => {
    const queries = standaloneOutcomeNativeQueries(client, user);
    expect(Object.keys(queries)).toEqual(["sessions", "cardio_logs", "set_logs", "training_blocks", "planned_sessions"]);
    for (const query of Object.values(queries)) {
      const result = await query;
      expect(result.error).toBeNull(); expect(result.data).toEqual([]);
    }
    expect(invalidQueries).toEqual([]);
    expect(requests).toHaveLength(5);
    for (const url of requests) {
      const child = ["/rest/v1/cardio_logs", "/rest/v1/set_logs"].includes(url.pathname);
      expect(url.searchParams.get("select")).toBe(child ? "id,sessions!inner(user_id)" : "id");
      expect(url.searchParams.get(child ? "sessions.user_id" : "user_id")).toBe(`eq.${user}`);
      expect(url.searchParams.has(child ? "user_id" : "sessions.user_id")).toBe(false);
    }
  });

  it("runs the real export route and exact M7 parser through all canonical query columns with creation off", async () => {
    vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "false");
    vi.stubEnv("SWIM_IMPORT_MATCHING_ENABLED", "false");
    const response = await GET();
    expect(invalidQueries).toEqual([]);
    expect(response.status).toBe(200);
    const history = standaloneOutcomeExportSchema.parse(await response.json());
    expect(history.swim_import_outcomes.sort((a, b) => a.revision - b.revision)).toEqual(receipts);
    expect(history.swim_imports).toEqual([{ id: recording, evidence: { date: recordedDate } }]);
    for (const table of ["sessions", "cardio_logs", "set_logs", "training_blocks", "planned_sessions"] as const) {
      expect(history[table]).toEqual([]);
    }
    expect(requests.filter((url) => !url.pathname.includes("/rpc/"))).toHaveLength(32);
    for (const table of ["program_instances", "program_recommendations", "training_seasons", "season_blocks",
      "rehab_protocols", "program_rehab_bindings", "swim_plan_rehab_bindings"]) {
      expect(requests.find((url) => url.pathname.endsWith(`/${table}`))?.searchParams.get("user_id")).toBe(`eq.${user}`);
    }
    for (const table of ["swim_import_matches", "swim_import_outcomes", "swim_imports"]) {
      expect(requests.find((url) => url.pathname.endsWith(`/${table}`))?.searchParams.get("user_id")).toBe(`eq.${user}`);
    }
  });
});
