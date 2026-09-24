import { createClient } from "@supabase/supabase-js";
import { isValidElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SwimRecordingPage from "@/app/app/swim/recordings/[importId]/page";
import { RecordingOutcome } from "@/components/swim/RecordingOutcome";
import { saveSwimImportOutcome } from "../import-outcome-actions";
import { exportSwimImportOutcomes, type SwimImportOutcome } from "../import-outcomes";
import { loadSwimActivity } from "../activity-history";
import { loadStandaloneSwimStates } from "../standalone-state";

const mocks = vi.hoisted(() => ({ client: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: mocks.client,
  getAuthUser: async () => ({ data: { user: { id: "00000000-0000-4000-8000-000000000001" } } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), workout = id(2), recording = id(3), match = id(4), plan = id(5);
const title = "Synthetic practice", displayTitle = "Week 1 A · Synthetic practice";
const recordedDate = "2026-09-21", scheduledDate = "2026-09-22";
const transport = vi.fn<typeof fetch>();
const client = createClient("https://synthetic.invalid", "synthetic-key", {
  global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const requests: URL[] = [];
let unmatched: boolean;
let receipts: SwimImportOutcome[];

function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const controls = (page: unknown) => elements(page).filter((element) => element.type === RecordingOutcome);
const page = () => SwimRecordingPage({
  params: Promise.resolve({ importId: recording }), searchParams: Promise.resolve({ workout, from: "sessions" }),
});
function projection() {
  const current = receipts.at(-1)!;
  const claimed = current.metadata.outcome !== null;
  return {
    id: workout, user_id: user, plan_id: plan, revision: 1, status: "scheduled", plan_status: "active",
    scheduled_date: scheduledDate, session_id: null, visible_session_id: null, native_completed_at: null,
    outcome_id: current.id, outcome_match_id: current.match_id, outcome_metadata: current.metadata,
    current_match_id: unmatched || !claimed ? null : match,
    matched_import_id: unmatched || !claimed ? null : recording,
    matched_workout_revision: unmatched || !claimed ? null : 1,
    latest_import_id: unmatched || !claimed ? null : recording,
    recording_date: unmatched || !claimed ? null : recordedDate,
    claim_import_id: claimed ? recording : null, claim_recording_date: claimed ? recordedDate : null,
    definition: { slotId: "course-0-0", issued: { focus: "endurance" }, courseSource: { title } },
  };
}

beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "true"); vi.stubEnv("SWIM_IMPORT_MATCHING_ENABLED", "true");
  unmatched = false; requests.length = 0;
  receipts = (["completed", "stopped_early"] as const).map((outcome, index) => ({
    id: id(6 + index), workout_id: workout, match_id: match, revision: index + 1,
    created_at: "2026-09-22T00:00:00Z",
    metadata: { outcome, previousOutcomeId: index ? id(6) : null, workoutRevision: 1 },
  }));
  mocks.client.mockResolvedValue(client);
  transport.mockImplementation(async (input, init) => {
    const url = new URL(String(input)); requests.push(url);
    if (url.pathname.endsWith("_ready")) return Response.json(true);
    if (url.pathname.endsWith("/rpc/swim_confirm_import_outcome")) {
      expect(JSON.parse(String(init?.body))).toEqual({
        p_request_id: id(8), p_workout_id: workout, p_match_id: null, p_outcome: null,
        p_expected_outcome_id: id(7), p_expected_workout_revision: null,
      });
      receipts.push({ id: id(8), workout_id: workout, match_id: null, revision: 3,
        created_at: "2026-09-22T00:01:00Z",
        metadata: { outcome: null, previousOutcomeId: id(7), workoutRevision: null } });
      return Response.json(id(8));
    }
    expect(url.searchParams.get("user_id")).toBe(`eq.${user}`);
    if (url.pathname.endsWith("/swim_imports")) {
      if (url.searchParams.get("select") === "id") return Response.json({ id: recording });
      return Response.json({ id: recording, activity_id: "42", revision: 1, received_at: "2026-09-21T00:00:00Z",
        evidence: { version: 1, source: "local_dashboard", activityId: "42", date: recordedDate, environment: "pool",
          workoutReference: null, distanceMetres: 350, recordedDurationMs: 900000, durationKind: "unspecified",
          nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] } } });
    }
    if (url.pathname.endsWith("/swim_current_import_matches")) return Response.json({
      id: unmatched ? id(9) : match, activity_id: "42", import_id: recording,
      workout_id: unmatched ? null : workout, revision: unmatched ? 2 : 1, created_at: "2026-09-22T00:00:00Z",
      metadata: { previousMatchId: unmatched ? match : null,
        workout: unmatched ? null : { revision: 1, date: scheduledDate, title, issued: {} } },
    });
    if (url.pathname.endsWith("/swim_import_outcome_activity")) {
      const row = projection();
      const selected = url.searchParams.get("select")!.split(",");
      return Response.json(url.searchParams.has("outcome_match_id") && row.outcome_match_id === null
        ? [] : [Object.fromEntries(Object.entries(row).filter(([key]) => selected.includes(key)))]);
    }
    if (url.pathname.endsWith("/swim_current_import_outcomes")) return Response.json(receipts.at(-1));
    if (url.pathname.endsWith("/swim_import_outcomes")) return Response.json(receipts);
    if (url.pathname.endsWith("/swim_workouts")) return Response.json({ revision: 1, status: "scheduled", session_id: null });
    throw new Error(`Unexpected synthetic route: ${url.pathname}`);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW5/SW7 retained recording controls through the real page and read model", () => {
  it("retains the owned removal control when the heading changes from match snapshot to course display title", async () => {
    const before = await page();
    expect(controls(before)).toHaveLength(1);
    expect(controls(before)[0]!.props).toMatchObject({ workoutId: workout, workoutTitle: title, canRemove: true });
    expect(renderToStaticMarkup(before)).toContain(">Remove match</button>");
    unmatched = true;
    const after = await page(), retained = controls(after);
    expect(retained).toHaveLength(1);
    expect(retained[0]!.props).toMatchObject({
      workoutId: workout, workoutTitle: displayTitle, origin: "sessions", expectedOutcomeId: id(7),
      matchId: null, current: null, enabled: false, canRemove: true, needsReview: true,
    });
    const html = renderToStaticMarkup(after);
    expect(html).toContain(`<h2`);
    expect(html).toContain(`href="/app/swim/${workout}?from=sessions">${displayTitle}</a>`);
    expect(html).toContain(">Remove confirmation</button>");
    expect(html).not.toContain(">Remove match</button>");
    expect(html).not.toContain(">Confirm outcome</button>");
    expect(html).toContain('href="/app/sessions"');
  });

  it("removes the retained claim with creation off, restores scheduled state and keeps all export receipts", async () => {
    unmatched = true; vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "false");
    const retained = controls(await page())[0]!;
    expect(await loadSwimActivity(client, user, 8)).toEqual([{
      kind: "swim", id: workout, importId: recording, title: displayTitle,
      date: recordedDate, scheduledDate, status: "needs_review",
    }]);
    expect((await loadStandaloneSwimStates(client, user, [workout])).get(workout)?.status).toBe("needs_review");
    expect(await saveSwimImportOutcome({
      requestId: id(8), workoutId: retained.props.workoutId, expectedOutcomeId: retained.props.expectedOutcomeId,
      matchId: null, outcome: null, workoutRevision: null,
    })).toEqual({ ok: true, value: id(8) });
    expect(controls(await page())).toHaveLength(0);
    expect(await loadSwimActivity(client, user, 8)).toEqual([]);
    expect((await loadStandaloneSwimStates(client, user, [workout])).get(workout)?.status).toBe("scheduled");
    expect(await exportSwimImportOutcomes(client, user)).toEqual(receipts);
    expect(receipts.map(({ metadata }) => metadata.outcome)).toEqual(["completed", "stopped_early", null]);
    expect(requests.every((url) => !/\/(?:sessions|cardio_logs|training_blocks|planned_sessions)$/.test(url.pathname))).toBe(true);
  });
});
