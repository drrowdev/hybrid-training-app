import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SwimCalendar } from "@/components/swim/SwimCalendar";
import { SwimHub } from "@/components/swim/SwimHub";
import { WorkoutScreen } from "@/components/swim/WorkoutScreen";
import { loadSwimHubView, loadSwimWorkoutView } from "../queries";
import { standaloneSwimCalendar } from "../calendar";
import { loadStandaloneSwimStates } from "../standalone-state";
import { swimFixture, userId, receiptId, planId } from "./fixtures";
import * as storage from "../storage";

const mocks = vi.hoisted(() => ({
  client: vi.fn(), navigation: vi.fn(async () => ({ hasPlans: true })),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.client, getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("../navigation", () => ({ getSwimNavigation: mocks.navigation }));
vi.mock("../storage", () => ({ listSwimPlans: vi.fn(), listSwimWorkouts: vi.fn(), getSwimWorkout: vi.fn() }));
vi.mock("../actions", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/components/trash/DeleteSessionButton", () => ({ DeleteSessionButton: () => null }));

const transport = vi.fn<typeof fetch>();
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
let fixture = swimFixture();
let outcome: "completed" | "stopped_early" | null;
let detached = false;
let unavailable = false;
let missing = false;
const match = "00000000-0000-4000-8000-000000000901";
const imported = "00000000-0000-4000-8000-000000000902";

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-07T12:00:00Z"));
  vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "false");
  fixture = swimFixture(); outcome = "completed"; detached = false; unavailable = false; missing = false;
  mocks.client.mockResolvedValue(client);
  vi.mocked(storage.listSwimPlans).mockImplementation(async () => [fixture.plan]);
  vi.mocked(storage.listSwimWorkouts).mockImplementation(async () => fixture.workouts);
  vi.mocked(storage.getSwimWorkout).mockImplementation(async () => fixture.workouts[0]!);
  transport.mockReset().mockImplementation(async (input) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith("/rpc/swim_import_outcomes_ready")) {
      if (unavailable || missing) return Response.json({ code: missing ? "PGRST202" : "42501" }, { status: 403 });
      return Response.json(true);
    }
    if (url.pathname.endsWith("/swim_import_outcome_activity")) {
      const ids = url.searchParams.get("id")!.slice(4, -1).split(",");
      return Response.json(fixture.workouts.filter((row) => ids.includes(row.id)).map((row) => {
        const claimed = row.id === fixture.workouts[0]!.id && outcome !== null;
        const current = claimed && !detached;
        return {
          id: row.id, user_id: userId, plan_id: planId, revision: row.revision,
          status: row.status, plan_status: fixture.plan.status, scheduled_date: row.scheduled_date,
          session_id: null, visible_session_id: null, native_completed_at: null,
          outcome_id: claimed ? receiptId : null, outcome_match_id: claimed ? match : null,
          outcome_metadata: claimed ? { outcome, previousOutcomeId: null, workoutRevision: row.revision } : null,
          current_match_id: current ? match : null, matched_import_id: current ? imported : null,
          matched_workout_revision: current ? row.revision : null, latest_import_id: current ? imported : null,
          recording_date: current ? "2026-09-06" : null,
          claim_import_id: claimed ? imported : null, claim_recording_date: claimed ? "2026-09-06" : null,
        };
      }));
    }
    if (url.pathname.endsWith("/swim_plans")) return Response.json([fixture.plan]);
    if (url.pathname.endsWith("/swim_workouts")) return Response.json(fixture.workouts);
    if (url.pathname.endsWith("/profiles")) return Response.json({ timezone: "UTC" });
    throw new Error(`Unexpected synthetic route: ${url.pathname}`);
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("DC-SW5/SW6/SW7 canonical outcome surfaces", () => {
  it.each([
    ["completed", false, "Completed"], ["stopped_early", false, "Stopped early"],
    ["completed", true, "Review recording"], [null, false, "Scheduled"],
  ] as const)("shares %s/detached=%s through Home, calendar, hub, workout and next without a native result", async (value, removedMatch, label) => {
    outcome = value; detached = removedMatch;
    const first = fixture.workouts[0]!;
    for (const todayOnly of [true, false]) {
      const html = renderToStaticMarkup(await SwimCalendar({ todayOnly }));
      const href = `/app/swim/${first.id}?from=${todayOnly ? "today" : "plan"}`;
      const link = html.split(`href="${href}"`)[1]!.split("</a>")[0]!;
      expect(link).toContain(`>${label}</span>`);
      expect(link).toContain(first.scheduled_date);
      expect(link).not.toContain("2026-09-06");
    }
    const hub = await loadSwimHubView(client, userId, fixture.plan);
    expect(hub.workouts[0]!.status).toBe(label);
    expect(hub.nextWorkoutId).toBe(fixture.workouts[value ? 1 : 0]!.id);
    expect(hub.analytics.weeks).toEqual([expect.objectContaining({ actual: "—", frequency: 0, adherence: "—" })]);
    const html = renderToStaticMarkup(<SwimHub plan={hub} plans={[]} setupEnabled={false} />);
    expect(html).toContain('aria-label="Swims"');
    expect(html).toContain(`href="/app/swim/${hub.nextWorkoutId}">Next swim</a>`);
    const workout = await loadSwimWorkoutView(client, userId, first.id);
    expect(workout).toMatchObject({ sessionId: null, status: "scheduled", result: null });
    const detail = renderToStaticMarkup(<WorkoutScreen workout={workout!} />);
    expect(detail).toContain(`>${label}</p>`);
    expect(detail.includes(">Skip swim</button>")).toBe(value === null);
    expect(transport.mock.calls.every(([url]) => !String(url).includes("/sessions") && !String(url).includes("/cardio_logs"))).toBe(true);
  });

  it("retains ended-plan claims at their scheduled date but never chooses them as next", async () => {
    fixture.plan.status = "finished";
    const states = await loadStandaloneSwimStates(client, userId, fixture.workouts.map(({ id }) => id));
    expect(standaloneSwimCalendar([fixture.plan], fixture.workouts, states).map(({ id, status }) => ({ id, status })))
      .toEqual([{ id: fixture.workouts[0]!.id, status: "completed" }]);
    const hub = await loadSwimHubView(client, userId, fixture.plan);
    expect(hub.workouts[0]!.status).toBe("Completed");
    expect(hub.nextWorkoutId).toBeUndefined();
  });

  it("falls back only for a missing capability, not an unreadable installed ledger", async () => {
    missing = true;
    expect((await loadSwimHubView(client, userId, fixture.plan)).workouts[0]!.status).toBe("Scheduled");
    missing = false; unavailable = true;
    await expect(loadSwimHubView(client, userId, fixture.plan)).rejects.toThrow("Swim outcomes could not be loaded.");
    await expect(SwimCalendar({ todayOnly: true })).rejects.toThrow("Swim outcomes could not be loaded.");
  });
});
