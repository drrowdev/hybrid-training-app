import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";
import { createClient } from "@supabase/supabase-js";
import SwimRecordingPage from "@/app/app/swim/recordings/[importId]/page";
import { getAuthUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/ui/PageHeader";
import { RecordingOutcome } from "@/components/swim/RecordingOutcome";
import { RecordingMatcher } from "@/components/swim/RecordingMatcher";
import { loadRecordingMatch, swimImportMatchingAvailable } from "../import-matching";
import { loadSwimImportOutcome, swimImportOutcomesAvailable } from "../import-outcomes";
import { loadRecordingSwimClaims } from "../recording-claims";

const { transport } = vi.hoisted(() => ({ transport: vi.fn<typeof fetch>() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => createClient("https://synthetic.invalid", "synthetic-key", {
    global: { fetch: transport }, auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  }),
  getAuthUser: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
vi.mock("../import-matching", () => ({ loadRecordingMatch: vi.fn(), swimImportMatchingAvailable: vi.fn() }));
vi.mock("../import-outcomes", () => ({ loadSwimImportOutcome: vi.fn(), swimImportOutcomesAvailable: vi.fn() }));
vi.mock("../recording-claims", () => ({ loadRecordingSwimClaims: vi.fn() }));
vi.mock("@/components/swim/RecordingOutcome", () => ({ RecordingOutcome: () => null }));
vi.mock("@/components/swim/RecordingMatcher", () => ({ RecordingMatcher: () => null }));

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const user = id(1), workout = id(2), recordingId = id(3), matchId = id(4), outcomeId = id(5);
type View = NonNullable<Awaited<ReturnType<typeof loadRecordingMatch>>>;
const view = (): View => ({
  recording: {
    id: recordingId, activity_id: "42", revision: 1, received_at: "2026-09-21T00:00:00Z",
    evidence: {
      version: 1, source: "local_dashboard", activityId: "42", date: "2026-09-21", environment: "pool",
      workoutReference: null, distanceMetres: 300, recordedDurationMs: 300000, durationKind: "unspecified",
      nativeCourse: null, detail: { status: "missing", fetchedAt: null, splits: [] },
    },
  },
  current: {
    id: matchId, activity_id: "42", import_id: recordingId, workout_id: workout, revision: 1,
    created_at: "2026-09-21T00:00:00Z", metadata: { previousMatchId: null,
      workout: { revision: 1, date: "2026-09-22", title: "Synthetic current workout", issued: {} } },
  },
  latestId: recordingId,
});
const claim = (): Awaited<ReturnType<typeof loadRecordingSwimClaims>>[number] => ({
  kind: "swim", id: workout, importId: recordingId, title: "Synthetic original workout",
  date: "2026-09-21", scheduledDate: "2026-09-22", status: "completed",
  outcomeId, workoutRevision: 1, claimedOutcome: "completed",
});
function elements(node: unknown): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement<Record<string, unknown>>(node)) return [];
  return [node, ...elements(node.props.children)];
}
const render = (query?: { workout?: string; from?: string }) => SwimRecordingPage({
  params: Promise.resolve({ importId: recordingId }), searchParams: Promise.resolve(query ?? {}),
});
const controls = (page: unknown) => elements(page).filter((element) => element.type === RecordingOutcome);
const requests: URL[] = [];
let workoutData: unknown;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "true");
  vi.stubEnv("SWIM_IMPORT_MATCHING_ENABLED", "true");
  vi.mocked(getAuthUser).mockResolvedValue({
    data: { user: { id: user, aud: "authenticated", app_metadata: {}, user_metadata: {}, created_at: "2026-09-21T00:00:00Z" } },
    error: null,
  });
  vi.mocked(swimImportMatchingAvailable).mockResolvedValue(true);
  vi.mocked(swimImportOutcomesAvailable).mockResolvedValue(true);
  vi.mocked(loadRecordingMatch).mockResolvedValue(view());
  vi.mocked(loadRecordingSwimClaims).mockResolvedValue([]);
  vi.mocked(loadSwimImportOutcome).mockResolvedValue(null);
  requests.length = 0;
  workoutData = { revision: 1, status: "scheduled", session_id: null };
  transport.mockImplementation(async (input) => {
    const url = new URL(String(input));
    requests.push(url);
    if (url.pathname.endsWith("/swim_workouts")) return Response.json(workoutData);
    throw new Error("Unexpected request.");
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW4/SW5/SW7/SW8 independent recording outcome controls", () => {
  it("offers explicit confirmation only for current eligible owned evidence, not a requested target", async () => {
    const page = await render({ workout: id(99), from: "sessions" });
    expect(controls(page)).toHaveLength(1);
    expect(controls(page)[0]?.props).toMatchObject({
      workoutId: workout, matchId, workoutRevision: 1, expectedOutcomeId: null,
      current: null, enabled: true, canRemove: false,
    });
    expect(requests[0]?.searchParams.get("user_id")).toBe(`eq.${user}`);
    expect(requests[0]?.searchParams.get("id")).toBe(`eq.${workout}`);
    expect(elements(page).find((element) => element.type === PageHeader)?.props.back).toEqual({
      href: "/app/sessions", label: "Sessions",
    });
  });
  it.each(["completed", "stopped_early"] as const)("shows the saved %s claim once with its exact receipt", async (outcome) => {
    vi.mocked(loadSwimImportOutcome).mockResolvedValue({
      id: outcomeId, workout_id: workout, match_id: matchId, revision: 1, created_at: "2026-09-21T00:00:00Z",
      metadata: { outcome, previousOutcomeId: null, workoutRevision: 1 },
    });
    vi.mocked(loadRecordingSwimClaims).mockResolvedValue([{ ...claim(), status: outcome, claimedOutcome: outcome }]);
    const page = await render();
    expect(controls(page)).toHaveLength(1);
    expect(controls(page)[0]?.props).toMatchObject({ expectedOutcomeId: outcomeId, current: outcome, canRemove: true });
  });
  it("keeps a detached original claim removable with creation disabled and no current match", async () => {
    vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "false");
    vi.mocked(loadRecordingMatch).mockResolvedValue({ ...view(), current: null });
    vi.mocked(loadRecordingSwimClaims).mockResolvedValue([{ ...claim(), status: "needs_review" }]);
    const page = await render({ workout, from: "sessions" });
    expect(controls(page)).toHaveLength(1);
    expect(controls(page)[0]?.props).toMatchObject({
      workoutId: workout, workoutTitle: claim().title, matchId: null, expectedOutcomeId: outcomeId,
      enabled: false, current: null, canRemove: true, needsReview: true,
    });
    expect(loadSwimImportOutcome).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
    expect(loadRecordingSwimClaims).toHaveBeenCalledWith(expect.anything(), user, recordingId);
  });
  it("separates a newly matched workout from the original claim instead of losing or retargeting removal", async () => {
    const current = view().current!;
    vi.mocked(loadRecordingMatch).mockResolvedValue({ ...view(), current: { ...current, workout_id: id(20) } });
    vi.mocked(loadRecordingSwimClaims).mockResolvedValue([{ ...claim(), status: "needs_review" }]);
    const page = await render({ workout, from: "sessions" });
    expect(controls(page)).toHaveLength(2);
    expect(controls(page)[0]?.props).toMatchObject({ workoutId: id(20), enabled: true, canRemove: false });
    expect(controls(page)[1]?.props).toMatchObject({
      workoutId: workout, expectedOutcomeId: outcomeId, enabled: false, canRemove: true, matchId: null,
    });
    expect(controls(page)[0]?.props.workoutTitle).not.toBe(controls(page)[1]?.props.workoutTitle);
  });
  it("does not offer new confirmation for superseded receipts", async () => {
    vi.mocked(loadRecordingMatch).mockResolvedValue({ ...view(), latestId: id(30) });
    vi.mocked(loadRecordingSwimClaims).mockResolvedValue([{ ...claim(), status: "needs_review" }]);
    vi.mocked(loadSwimImportOutcome).mockResolvedValue({
      id: outcomeId, workout_id: workout, match_id: matchId, revision: 1, created_at: "2026-09-21T00:00:00Z",
      metadata: { outcome: "completed", previousOutcomeId: null, workoutRevision: 1 },
    });
    const page = await render({ workout, from: "sessions" });
    expect(controls(page)[0]?.props).toMatchObject({ enabled: false, current: null, needsReview: true, canRemove: true });
    expect(elements(page).some((element) =>
      element.props.href === `/app/swim/recordings/${id(30)}?workout=${workout}&from=sessions`)).toBe(true);
  });
  it("keeps the original claim separate when an updated receipt is matched to the same workout", async () => {
    vi.mocked(loadRecordingMatch).mockResolvedValue({
      ...view(), latestId: id(30), current: { ...view().current!, id: id(31), import_id: id(30) },
    });
    vi.mocked(loadRecordingSwimClaims).mockResolvedValue([{ ...claim(), status: "needs_review" }]);
    const page = await render({ workout, from: "sessions" });
    expect(controls(page)).toHaveLength(1);
    expect(controls(page)[0]?.props).toMatchObject({
      workoutId: workout, workoutTitle: claim().title, expectedOutcomeId: outcomeId,
      matchId: null, enabled: false, current: null, canRemove: true, needsReview: true, otherMatch: false,
    });
    expect(loadSwimImportOutcome).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([
    { revision: 2, status: "scheduled", session_id: null },
    { revision: 1, status: "skipped", session_id: null },
    { revision: 1, status: "completed", session_id: id(40) },
    { revision: 1, status: "started", session_id: id(40) },
  ])("does not confirm stale, skipped or native work: %j", async (value) => {
    workoutData = value;
    expect(controls(await render())).toHaveLength(0);
  });
  it("does not offer pool outcomes for open-water receipts", async () => {
    const source = view();
    source.recording.evidence.environment = "open_water";
    vi.mocked(loadRecordingMatch).mockResolvedValue(source);
    expect(controls(await render())).toHaveLength(0);
  });
  it("does not access additive claim storage when the capability is absent", async () => {
    vi.mocked(swimImportOutcomesAvailable).mockResolvedValue(false);
    expect(controls(await render())).toHaveLength(0);
    expect(loadRecordingSwimClaims).not.toHaveBeenCalled();
    expect(loadSwimImportOutcome).not.toHaveBeenCalled();
    expect(transport).not.toHaveBeenCalled();
  });
  it("rejects malformed target data instead of displaying enabled controls", async () => {
    workoutData = { revision: 0, status: "scheduled", session_id: null };
    await expect(render()).rejects.toThrow();
    expect(transport.mock.calls.every(([, options]) => options?.method === "GET")).toBe(true);
  });
  it("does not retain an empty outcome panel after a concurrently removed claim", async () => {
    vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "false");
    vi.mocked(loadRecordingSwimClaims).mockResolvedValue([claim()]);
    expect(controls(await render())).toHaveLength(0);
  });
  it("accepts only the closed return context and never uses it as a claim-selection filter", async () => {
    const page = await render({ workout: "not-a-uuid", from: "https://elsewhere.invalid" });
    expect(elements(page).find((element) => element.type === PageHeader)?.props.back).toEqual({
      href: "/app/settings/swimming", label: "Swimming imports",
    });
    expect(elements(page).find((element) => element.type === RecordingMatcher)?.props.origin).toBeUndefined();
    expect(loadRecordingSwimClaims).toHaveBeenCalledWith(expect.anything(), user, recordingId);
  });
});
