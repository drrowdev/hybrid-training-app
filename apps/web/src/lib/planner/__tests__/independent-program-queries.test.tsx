import { createClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { renderToReadableStream } from "react-dom/server.edge";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getActiveBlock, getActiveBlocks, getTodayPlannedSessions, getUpcomingPlannedSessions } from "../queries";
import ProgramsPage from "@/app/app/programs/page";
import PlanPage from "@/app/app/plan/page";
import { getActiveBlockRemainingSessions } from "../remaining-sessions";
import { getDeloadWeekPreview } from "../deload-week-preview";
import { getCeilingUtilization } from "@/lib/stats/ceiling-queries";
import { getPendingProgramRecommendations } from "@/lib/platform/recommendations-queries";
import { ProgramRecommendationsBanner } from "@/components/today/ProgramRecommendationsBanner";
import { swimFixture } from "@/lib/swim/__tests__/fixtures";

const mocks = vi.hoisted(() => ({ client: vi.fn(), schedule: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.client,
  getAuthUser: async () => ({ data: { user: { id: "owner" } } }),
}));
vi.mock("@/lib/planner/modifications", async (original) => ({
  ...await original<typeof import("@/lib/planner/modifications")>(),
  getActiveModificationRows: async () => [],
}));
vi.mock("@/lib/swim/navigation", () => ({
  getSwimNavigation: async () => ({ hasPlans: true, setupEnabled: true, storageAvailable: true }),
  swimEntryHref: () => "/app/swim",
}));
vi.mock("@/components/swim/SwimCalendar", () => ({ SwimCalendar: () => null }));
vi.mock("@/lib/swim/standalone-state", () => ({ loadStandaloneSwimStates: async () => new Map() }));
vi.mock("next/navigation", () => ({
  redirect: () => { throw new Error("Redirect"); },
  notFound: () => { throw new Error("Not found"); },
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/schedule/storage", async (original) => ({
  ...await original<typeof import("@/lib/schedule/storage")>(),
  loadAvailableTrainingSchedule: mocks.schedule,
}));

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const block = (value: number, kind: "strength" | "running" | "hybrid" | null) => ({
  id: id(value), user_id: "owner", archetype: null, started_on: "2026-09-21",
  weeks: 4, status: "active", deleted_at: null, notes: `${kind ?? "Older"} plan`,
  program_id: "authored", program_family: "authored", program_kind: kind,
  focus_muscles: [], power_emphasis: false,
});
type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
let requests: URL[];
let capability: "ready" | "missing" | "error";
let failedTable: string | null;

function planned(value: number, ownerBlock: number, day: number, extra: Row = {}): Row {
  return { id: id(value), user_id: "owner", block_id: id(ownerBlock), week_index: 0, day_index: day,
    slot: "single", planned_at: null, title: `Workout ${value}`, role: "primary",
    prescription: { items: [] }, completed_session_id: null, skipped_at: null, notes: null, ...extra };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-22T12:00:00Z"));
  capability = "ready";
  failedTable = null;
  requests = [];
  tables = {
    training_blocks: [block(1, "strength"), block(2, "running"), block(3, "hybrid")],
    planned_sessions: [planned(11, 1, 1), planned(21, 2, 1), planned(31, 3, 1)],
    profiles: [{ id: "owner", timezone: "UTC" }],
    sessions: [],
    swim_plans: [{ ...swimFixture().plan, user_id: "owner" }],
  };
  const client = createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      requests.push(url);
      if (url.pathname.endsWith("/rpc/independent_programs_ready")) {
        return capability === "ready" ? Response.json(true) : Response.json({
          code: capability === "missing" ? "PGRST202" : "XX000",
          message: "independent_programs_ready unavailable",
        }, { status: capability === "missing" ? 404 : 500 });
      }
      const table = url.pathname.split("/").at(-1)!;
      if (table === failedTable) return Response.json({ code: "XX000", message: "read failed" }, { status: 500 });
      let rows = (tables[table] ?? []).filter((row) => [...url.searchParams].every(([key, value]) => {
        if (value.startsWith("eq.")) return String(row[key]) === value.slice(3);
        if (value === "is.null") return row[key] == null;
        if (value === "not.is.null") return row[key] != null;
        if (value.startsWith("neq.")) return String(row[key]) !== value.slice(4);
        if (value.startsWith("gt.")) return Number(row[key]) > Number(value.slice(3));
        if (value.startsWith("gte.")) return String(row[key]) >= value.slice(4);
        if (value.startsWith("in.(")) return value.slice(4, -1).split(",").includes(String(row[key]));
        return true;
      }));
      const limit = url.searchParams.get("limit");
      if (limit !== null) rows = rows.slice(0, Number(limit));
      if (table === "training_blocks" && !url.searchParams.get("select")?.includes("program_kind")) {
        rows = rows.map((row) => {
          const projected = { ...row };
          delete projected.program_kind;
          return projected;
        });
      }
      const single = new Headers(init?.headers).get("accept")?.includes("vnd.pgrst.object");
      if (init?.method === "HEAD") return new Response(null, { headers: { "content-range": `*/${rows.length}` } });
      return Response.json(single ? rows[0] ?? null : rows);
    } },
  });
  mocks.client.mockResolvedValue(client);
  mocks.schedule.mockResolvedValue({
    revision: "a".repeat(32),
    entries: [
      ...[1, 2, 3].map((value) => ({ id: id(value * 10 + 1), source: "primary", programId: id(value),
        date: "2026-09-22", title: `Workout ${value}`, state: "scheduled" })),
      { id: id(41), source: "swim", programId: id(4), date: "2026-09-22", title: "Pool workout", state: "scheduled" },
    ],
  });
});
afterEach(() => vi.useRealTimers());

describe("DC-R5 authoritative independent program reads", () => {
  it.each([[1, 2, 3], [1, 3, 2], [2, 1, 3], [2, 3, 1], [3, 1, 2], [3, 2, 1]])(
    "retains every type in creation order %j", async (first, second, third) => {
      const original = tables.training_blocks!;
      tables.training_blocks = [first, second, third].map((value) => original[value - 1]!);
      expect((await getActiveBlocks()).map((program) => program.id).sort()).toEqual([id(1), id(2), id(3)]);
      expect((await getActiveBlock(id(2)))?.programKind).toBe("running");
      expect(await getActiveBlock(id(99))).toBeNull();
      for (const request of requests.filter((url) => url.pathname.endsWith("/training_blocks"))) {
        expect(request.searchParams.get("user_id")).toBe("eq.owner");
        expect(request.searchParams.has("limit")).toBe(false);
      }
    },
  );

  it("does not infer an older program's type from its family or workout contents", async () => {
    tables.training_blocks = [{ ...block(1, null), program_family: "hybrid" }];
    expect((await getActiveBlocks())[0]?.programKind).toBeNull();
    capability = "missing";
    expect((await getActiveBlocks())[0]?.programKind).toBeNull();
    expect(requests.at(-1)?.searchParams.get("select")).not.toContain("program_kind");
  });

  it.each(["duplicate", "legacy-with-typed", "invalid-kind"] as const)("refuses %s rather than choosing a newest program", async (problem) => {
    tables.training_blocks = problem === "duplicate" ? [block(1, "running"), block(2, "running")]
      : problem === "legacy-with-typed" ? [block(1, null), block(2, "strength")]
      : [{ ...block(1, "strength"), program_kind: "guessed" }];
    await expect(getActiveBlocks()).rejects.toThrow();
  });

  it("does not convert query or capability failures into no-program onboarding", async () => {
    capability = "error";
    await expect(getActiveBlocks()).rejects.toThrow();
    capability = "ready";
    failedTable = "training_blocks";
    await expect(getActiveBlocks()).rejects.toThrow();
  });

  it("combines today's workouts across all programs and excludes foreign, ended and deleted blocks", async () => {
    tables.training_blocks!.push({ ...block(4, "running"), user_id: "other" },
      { ...block(5, "strength"), status: "completed" }, { ...block(6, "hybrid"), deleted_at: "2026-09-22T00:00:00Z" });
    tables.planned_sessions!.push(planned(41, 4, 1, { user_id: "other" }), planned(51, 5, 1), planned(61, 6, 1));
    expect((await getTodayPlannedSessions()).map((workout) => workout.id)).toEqual([id(11), id(21), id(31)]);
  });

  it("sorts the combined future dates before limiting and never recommends rest or retained completed work", async () => {
    tables.planned_sessions = [planned(11, 1, 6), planned(21, 2, 3), planned(31, 3, 2),
      planned(12, 1, 2, { role: "rest" }), planned(22, 2, 2, { skipped_at: "2026-09-22T00:00:00Z" }),
      planned(32, 3, 2, { completed_session_id: id(92) }), planned(13, 1, 2, { completed_session_id: id(93) })];
    tables.sessions = [
      { id: id(92), user_id: "owner", completed_at: null, deleted_at: null },
      { id: id(93), user_id: "owner", completed_at: "2026-09-22T00:00:00Z", deleted_at: "2026-09-22T01:00:00Z" },
    ];
    expect((await getUpcomingPlannedSessions(2)).map((workout) => workout.id)).toEqual([id(31), id(21)]);
    failedTable = "sessions";
    await expect(getUpcomingPlannedSessions()).rejects.toThrow();
  });

  it("opens each program by its own ID and focused views use stored kind only", async () => {
    const all = renderToStaticMarkup(await ProgramsPage({ searchParams: Promise.resolve({}) }));
    for (const value of [1, 2, 3]) expect(all).toContain(`href="/app/plan?block=${id(value)}"`);
    expect(all).toContain(`href="/app/swim?plan=${swimFixture().plan.id}"`);
    const swimming = renderToStaticMarkup(await ProgramsPage({ searchParams: Promise.resolve({ activity: "swimming" }) }));
    expect(swimming).toContain(`href="/app/swim?plan=${swimFixture().plan.id}"`);
    expect(swimming).not.toContain(`href="/app/plan?block=${id(1)}"`);
    tables.training_blocks![2] = { ...block(3, "hybrid"), notes: "Running plan" };
    const running = renderToStaticMarkup(await ProgramsPage({ searchParams: Promise.resolve({ activity: "running" }) }));
    expect(running).toContain(`href="/app/plan?block=${id(2)}"`);
    expect(running).not.toContain(`href="/app/plan?block=${id(3)}"`);
    expect(running).not.toContain(`href="/app/sessions/start/${id(31)}"`);
    expect(requests.some((url) => url.pathname.endsWith("/planned_sessions"))).toBe(false);
  });

  it("renders the real Plan page for an explicit owner and rejects a missing owner without fallback", async () => {
    const html = renderToStaticMarkup(await PlanPage({ searchParams: Promise.resolve({ block: id(2) }) }));
    expect(html).toContain(`href="/app/program/build?edit=${id(2)}"`);
    expect(html).toContain("Workout 21");
    expect(html).not.toContain("Workout 11");
    expect(html).not.toContain("Workout 31");
    await expect(PlanPage({ searchParams: Promise.resolve({ block: id(99) }) })).rejects.toThrow("Not found");
    const stream = await renderToReadableStream(await PlanPage({ searchParams: Promise.resolve({}) }));
    await stream.allReady;
    const combined = await new Response(stream).text();
    for (const value of [1, 2, 3]) expect(combined).toContain(`href="/app/plan?block=${id(value)}"`);
  });

  it.each([0, 1])("keeps the combined calendar for %s primary programs", async (count) => {
    tables.training_blocks = tables.training_blocks!.slice(0, count);
    const stream = await renderToReadableStream(await PlanPage({ searchParams: Promise.resolve({}) }));
    await stream.allReady;
    const html = await new Response(stream).text();
    expect(html).toContain('href="/app/programs"');
    expect(html).toContain(`href="/app/swim?plan=${swimFixture().plan.id}"`);
    expect(html).not.toContain('data-testid="plan-overview"');
  });

  it("keeps remaining-session and recovery previews attached to the explicitly selected program", async () => {
    tables.planned_sessions!.push(...[1, 2, 3].map((value) => planned(value * 10 + 2, value, 1, {
      week_index: 1, session_modality: "strength",
      prescription: { items: [{ movementId: id(value + 100), kind: "main", reps: 5, percentTm: 70 }] },
    })));
    const client = await mocks.client();
    const now = new Date();
    const remaining = await getActiveBlockRemainingSessions(client, "owner", "UTC", now, id(2));
    expect(remaining?.remaining.map((session) => session.id)).toEqual([id(21), id(22)]);
    const preview = await getDeloadWeekPreview(client, "owner", { blockId: id(2), timezone: "UTC", now });
    expect(preview?.blockId).toBe(id(2));
    expect(preview?.sessions[0]?.prescription.items[0]?.movementId).toBe(id(102));
    expect(await getDeloadWeekPreview(client, "owner", { blockId: id(99), timezone: "UTC", now })).toBeNull();
    await expect(getDeloadWeekPreview(client, "owner", { timezone: "UTC", now })).rejects.toThrow();
    await expect(getActiveBlockRemainingSessions(client, "owner", "UTC", now)).rejects.toThrow();
  });

  it("compares account-wide actual load with the sum of independently owned program targets", async () => {
    tables.planned_sessions = [planned(11, 1, 1, { prescription: { items: [{ kind: "main", movementId: id(100), sets: 4 }] } }),
      planned(21, 2, 1, { prescription: { items: [{ kind: "cardio_z2", movementId: id(101) }] } }),
      planned(31, 3, 1, { prescription: { items: [{ kind: "main", movementId: id(100), sets: 2 }] } })];
    tables.sessions = [{ id: id(91), user_id: "owner", performed_at: "2026-09-22T00:00:00Z", deleted_at: null },
      { id: id(92), user_id: "other", performed_at: "2026-09-22T00:00:00Z", deleted_at: null }];
    tables.set_logs = Array.from({ length: 6 }, (_, index) => ({ id: id(index + 200), session_id: id(91), set_kind: "main", reps: 5 }));
    tables.set_logs.push({ id: id(207), session_id: id(92), set_kind: "main", reps: 5 });
    tables.cardio_logs = [{ id: id(300), session_id: id(91) }];
    const result = await getCeilingUtilization(await mocks.client(), "owner", "UTC");
    expect(result).toMatchObject({ weekIndex: null,
      strength: { actual: 6, prescribed: 6, pct: 1 },
      cardio: { actual: 1, prescribed: 1, pct: 1 },
    });
    tables.training_blocks![2]!.started_on = "2026-10-05";
    expect(await getCeilingUtilization(await mocks.client(), "owner", "UTC")).toMatchObject({
      strength: { actual: 6, prescribed: 4, pct: 1.5 },
      cardio: { actual: 1, prescribed: 1, pct: 1 },
    });
    failedTable = "planned_sessions";
    await expect(getCeilingUtilization(await mocks.client(), "owner", "UTC")).rejects.toThrow();
  });

  it("carries the recommendation owner into its recovery-week link", async () => {
    tables.program_recommendations = [{ id: id(90), user_id: "owner", status: "pending", kind: "deload",
      block_id: id(2), title: "Recovery week", detail: "Review this week", occurrence_key: "boundary", data: null }];
    const recommendations = await getPendingProgramRecommendations(await mocks.client(), "owner", [id(2)]);
    expect(recommendations[0]?.blockId).toBe(id(2));
    const html = renderToStaticMarkup(<ProgramRecommendationsBanner recommendations={recommendations}
      programNames={{ [id(2)]: "My running plan" }}
      dismissAction={async () => ({ ok: true })} />);
    expect(html).toContain("My running plan");
    expect(html).toContain(`block=${id(2)}`);
    expect(html).not.toContain(`block=${id(1)}`);
    const retained = renderToStaticMarkup(<ProgramRecommendationsBanner
      recommendations={recommendations.map((recommendation) => ({ ...recommendation, blockId: null }))}
      dismissAction={async () => ({ ok: true })} />);
    expect(retained).not.toContain('href="/app/plan');
    failedTable = "program_recommendations";
    await expect(getPendingProgramRecommendations(await mocks.client(), "owner", [id(2)])).rejects.toThrow();
  });

  it("filters retired and foreign recommendation owners before applying the display limit", async () => {
    tables.program_recommendations = [
      { id: id(90), user_id: "owner", status: "pending", kind: "deload", block_id: id(1) },
      { id: id(91), user_id: "another-user", status: "pending", kind: "deload", block_id: id(2) },
      { id: id(92), user_id: "owner", status: "pending", kind: "deload", block_id: id(2) },
      { id: id(93), user_id: "owner", status: "pending", kind: "deload", block_id: id(2) },
    ];
    const recommendations = await getPendingProgramRecommendations(await mocks.client(), "owner", [id(2)], 1);
    expect(recommendations.map((recommendation) => recommendation.id)).toEqual([id(92)]);
    expect(await getPendingProgramRecommendations(await mocks.client(), "owner", [])).toEqual([]);
  });

  it("retains final advice after completion without reviving deleted, replaced or foreign programs", async () => {
    tables.training_blocks = [
      { ...block(1, "hybrid"), status: "completed", notes: "My completed program", program_id: "green-protocol" },
      { ...block(2, "running"), status: "archived" },
      { ...block(3, "strength"), status: "completed", deleted_at: "2026-09-22T00:00:00Z" },
      { ...block(4, "hybrid"), status: "completed", user_id: "other" },
    ];
    tables.program_recommendations = [1, 2, 3, 4].map((value) => ({
      id: id(90 + value), user_id: "owner", status: "pending", kind: "next-block", block_id: id(value),
      title: "Next phase", detail: "Review your next phase.", occurrence_key: "", data: {
        programId: "green-protocol", nextPhaseId: "velocity", nextPhaseName: "Velocity",
      },
    }));
    const client = await mocks.client();
    const recommendations = await getPendingProgramRecommendations(client, "owner");
    expect(recommendations.map((row) => row.id)).toEqual([id(91)]);
    expect(recommendations[0]).toMatchObject({ programStatus: "completed", programName: "My completed program" });
    const html = renderToStaticMarkup(<ProgramRecommendationsBanner recommendations={recommendations}
      dismissAction={async () => ({ ok: true })} />);
    expect(html).toContain(`recommendation=${id(91)}`);
    expect(html).toContain("My completed program");
    tables.program_recommendations![0]!.kind = "deload";
    const recovery = renderToStaticMarkup(<ProgramRecommendationsBanner
      recommendations={await getPendingProgramRecommendations(client, "owner")} dismissAction={async () => ({ ok: true })} />);
    expect(recovery).toContain(`/app/program?program=green-protocol&amp;recommendation=${id(91)}`);
    expect(recovery).not.toContain("/app/plan?");
    tables.program_recommendations![0]!.kind = "tm-bump";
    expect((await getPendingProgramRecommendations(client, "owner"))[0]?.reviewHref).toBe(`/app/stats/blocks/${id(1)}`);
    failedTable = "training_blocks";
    await expect(getPendingProgramRecommendations(client, "owner")).rejects.toThrow();
  });
});
