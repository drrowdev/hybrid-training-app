import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { renderToStaticMarkup } from "react-dom/server";
import { revalidatePath } from "next/cache";
import { startSwimRehab } from "../rehab-actions";
import { loadSwimRehabWorkouts, readSwimRehabOrigin } from "../rehab-workouts";
import { SwimRehabWorkouts } from "@/components/swim/SwimRehabWorkouts";
import { compileLibraryRehab } from "@/lib/rehab-protocols/prescription";
import type { DbMovement } from "@/lib/planner/picker-catalog";
import { addStrengthSet } from "@/lib/sessions/actions";
import { recomputeAfterCompletedSessionMutation } from "@/lib/sessions/post-completion-recompute";
import { userId, planId, sessionId, receiptId, swimFixture } from "./fixtures";

const server = vi.hoisted(() => ({ createClient: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => server);
vi.mock("../capability", () => ({ requireSwimStorage: vi.fn(), requireSwimSetup: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh() {}, push() {} }) }));
vi.mock("@/lib/sessions/post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: vi.fn(async () => ({ recomputed: false })),
}));

const protocolId = "00000000-0000-4000-8000-000000000020";
const movementId = "00000000-0000-4000-8000-000000000021";
const otherMovementId = "00000000-0000-4000-8000-000000000022";
const revision = "a".repeat(32);
const workout = swimFixture().workouts[0]!;
const input = { workoutId: workout.id, protocolId, revision, requestId: receiptId };
const protocol = {
  id: protocolId, name: "Shoulder rehab", revision: 3,
  items: [
    { movementId, movementName: "External rotation", sets: 2, reps: 8, side: "left" as const, targetWeightKg: 2 },
    { movementId: otherMovementId, movementName: "Shoulder hold", sets: 2, holdSeconds: 20, side: "both" as const },
  ],
  links: [{ id: "pair", name: "Shoulder pair", members: [movementId, otherMovementId] }],
};
const origin = {
  version: 1 as const, planId, workoutId: workout.id, scheduledDate: workout.scheduled_date,
  protocolId, protocolRevision: protocol.revision, protocolName: protocol.name,
};
const prescription = { items: compileLibraryRehab(protocol, `swim:${workout.id}`), meta: { swimRehab: origin } };
const storedSession = { id: sessionId, title: protocol.name, prescription, completed_at: null, deleted_at: null };
const occurrence = { context: { kind: "swim-rehab-start-v1", origin, sessionId } };
const previousRequest = {
  context: { kind: "swim-rehab-request-v1", input: { workoutId: workout.id, protocolId, prescription }, sessionId },
};
const catalogMovement: DbMovement = {
  id: movementId, slug: "external-rotation", display_name: "External rotation", primary_region: "shoulder_scapular",
  secondary_regions: [], primary_muscles: ["rotator_cuff"], secondary_muscles: [], is_compound: false,
  body_weight_loaded: false, bulletproof_roles: [], functional_roles: [], is_supported: true,
  eccentric_load_score: null, stim_to_fatigue_score: null, high_strain_tendon: false,
  experience_min: 0, experience_max: 4, pattern: "cuff", equipment: "band",
};
type Request = { url: URL; method: string; body: Record<string, unknown> | null };
type Reply = { data: unknown; status?: number };
type Overrides = Record<string, Reply | ((request: Request) => Reply)>;

function fixture(overrides: Overrides = {}) {
  const requests: Request[] = [];
  const fetch = async (url: RequestInfo | URL, init?: RequestInit) => {
    const request: Request = {
      url: new URL(String(url)), method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    };
    requests.push(request);
    let path = request.url.pathname.replace("/rest/v1/", "");
    if (path === "engine_override_events") path = request.url.searchParams.has("id") ? "request" : "occurrences";
    if (path === "sessions") path = request.url.searchParams.get("id")?.startsWith("eq.") ? "session" : "sessions";
    const defaults: Record<string, unknown> = {
      "rpc/independent_programs_ready": true,
      "rpc/training_schedule_snapshot": { revision, entries: [] },
      "rpc/start_swim_rehab_session": sessionId,
      "rpc/insert_set_log_with_bw_progress": [{ id: receiptId, inserted: true }],
      swim_workouts: workout, swim_plans: { id: planId, status: "active" },
      swim_plan_rehab_bindings: [{ rehab_protocol_id: protocolId }],
      rehab_protocols: [{ id: protocolId, name: protocol.name, revision: protocol.revision,
        definition: { items: protocol.items, links: protocol.links } }],
      movements: [catalogMovement, { ...catalogMovement, id: otherMovementId, display_name: "Shoulder hold" }],
      limitations: [], request: null, occurrences: [], session: storedSession, sessions: [],
      planned_sessions: null, training_maxes: null, profiles: { bodyweight_kg: 80, tm_percent_default: 90 },
    };
    if (!(path in defaults)) throw new Error(`Unexpected fixture request: ${path}`);
    const override = overrides[path];
    const response = typeof override === "function" ? override(request) : override ?? { data: defaults[path] };
    return Response.json(response.data, { status: response.status ?? 200 });
  };
  const client = createClient("https://synthetic.invalid", "synthetic-key", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  server.createClient.mockResolvedValue(client);
  return { client, requests };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(revalidatePath).mockReset();
  server.getAuthUser.mockResolvedValue({ data: { user: { id: userId } } });
});

describe("DC-R5 owned Swimming rehab workout reader", () => {
  it("uses the shared library and exact owned workout without manufacturing another program or native swim result", async () => {
    const { client, requests } = fixture();
    expect(await loadSwimRehabWorkouts(client, userId, workout.id)).toEqual({
      workoutId: workout.id, revision, canStart: true,
      entries: [{ protocolId, name: protocol.name, sessionId: null, status: "available" }],
    });
    expect(requests[1]!.url.pathname).toContain("training_schedule_snapshot");
    for (const request of requests.slice(2)) {
      expect(request.method).toBe("GET");
      expect(request.url.searchParams.get("user_id")).toBe(`eq.${userId}`);
    }
    expect(requests.some((request) => /program_instances|training_blocks|cardio_logs/.test(request.url.pathname))).toBe(false);
  });
  it.each(["active", "paused", "finished", "archived"])("only offers a new start for eligible %s programs", async (status) => {
    const { client } = fixture({ swim_plans: { data: { id: planId, status } } });
    const context = await loadSwimRehabWorkouts(client, userId, workout.id);
    expect(context?.canStart).toBe(status === "active" || status === "finished");
    const html = renderToStaticMarkup(<SwimRehabWorkouts context={context!} />);
    expect(html.includes("<button")).toBe(context?.canStart);
  });
  it("does not offer a new start on a skipped swim", async () => {
    const { client } = fixture({ swim_workouts: { data: { ...workout, status: "skipped" } } });
    expect((await loadSwimRehabWorkouts(client, userId, workout.id))?.canStart).toBe(false);
  });
  it.each([
    ["started", storedSession], ["completed", { ...storedSession, completed_at: "2026-09-23T10:00:00Z" }],
    ["deleted", { ...storedSession, deleted_at: "2026-09-23T10:00:00Z" }], ["removed", null],
  ] as const)("retains a %s occurrence after detachment and never offers another start", async (status, session) => {
    const { client } = fixture({
      swim_plan_rehab_bindings: { data: [] }, occurrences: { data: [occurrence] }, sessions: { data: session ? [session] : [] },
    });
    const context = await loadSwimRehabWorkouts(client, userId, workout.id);
    expect(context?.entries).toEqual([{ protocolId, name: protocol.name, sessionId: session?.id ?? null, status }]);
    const html = renderToStaticMarkup(<SwimRehabWorkouts context={context!} />);
    expect(html).not.toContain("<button");
    expect(html.includes(`/app/sessions/${sessionId}`)).toBe(status === "started" || status === "completed");
    expect(html.includes('href="/app/trash"')).toBe(status === "deleted");
  });
  it("keeps the issued name and original date after library edits and swim rescheduling", async () => {
    const { client } = fixture({
      swim_workouts: { data: { ...workout, scheduled_date: "2026-10-01" } },
      rehab_protocols: { data: [{ id: protocolId, name: "Changed name" }] },
      occurrences: { data: [occurrence] }, sessions: { data: [storedSession] },
    });
    expect((await loadSwimRehabWorkouts(client, userId, workout.id))?.entries).toHaveLength(1);
    expect(readSwimRehabOrigin(storedSession.prescription)).toEqual(origin);
  });
  it.each(["swim_workouts", "swim_plans", "swim_plan_rehab_bindings", "occurrences", "rehab_protocols"])(
    "does not hide an installed %s read failure", async (path) => {
      const { client } = fixture({ [path]: { data: { code: "42501" }, status: 403 } });
      await expect(loadSwimRehabWorkouts(client, userId, workout.id)).rejects.toThrow();
    },
  );
  it("rejects duplicate occurrences and mismatched issued origin rather than choosing the newest", async () => {
    const cases: Overrides[] = [
      { occurrences: { data: [occurrence, occurrence] } },
      { occurrences: { data: [occurrence] }, sessions: { data: [{ ...storedSession,
        prescription: { ...prescription, meta: { swimRehab: { ...origin, planId: receiptId } } } }] } },
    ];
    for (const overrides of cases) {
      const { client } = fixture(overrides);
      await expect(loadSwimRehabWorkouts(client, userId, workout.id)).rejects.toThrow();
    }
  });
  it("does not invent an empty feature when availability checks fail", async () => {
    const { client } = fixture({ "rpc/independent_programs_ready": { data: { code: "42501" }, status: 403 } });
    await expect(loadSwimRehabWorkouts(client, userId, workout.id)).rejects.toThrow();
  });
});

describe("DC-R5 Swimming rehab start through the existing session logger", () => {
  it.each([0, 0.5, 2, 3])("passes an exact %skg issued dose to the real set-save RPC and retains it on offline replay", async (kg) => {
    let saved: unknown;
    let calls = 0;
    const { requests } = fixture({
      session: { data: { ...storedSession, prescription: {
        ...prescription, items: prescription.items.map((item) => ({ ...item, targetWeightKg: kg })),
      } } },
      movements: { data: catalogMovement },
      "rpc/insert_set_log_with_bw_progress": (request) => {
        calls++;
        if (calls === 1) saved = request.body?.p_set_log;
        else expect(request.body?.p_set_log).toEqual(saved);
        return { data: [{ id: receiptId, inserted: calls === 1 }] };
      },
    });
    const form = new FormData();
    for (const [key, value] of Object.entries({
      sessionId, movementId, setKind: "tendon", weightKg: String(kg), reps: "8",
      prescriptionItemIndex: "0", targetWeightKg: String(kg), targetReps: "8", clientLogId: receiptId,
    })) form.set(key, value);
    expect(await addStrengthSet(form)).toMatchObject({ ok: true });
    expect(saved).toMatchObject({
      session_id: sessionId, movement_id: movementId, weight_kg: kg, target_weight_kg: kg,
      reps: 8, target_reps: 8, set_kind: "tendon", prescription_item_index: 0, client_log_id: receiptId,
    });
    expect(await addStrengthSet(form)).toMatchObject({ ok: true });
    expect(calls).toBe(2);
    expect(recomputeAfterCompletedSessionMutation).toHaveBeenCalledTimes(1);
    expect(requests.some((request) => /rehab_protocols|swim_workouts|swim_plans/.test(request.url.pathname))).toBe(false);
  });
  it("compiles every owned set, side, dose and superset and sends the exact schedule/start identity", async () => {
    const { requests } = fixture();
    expect(await startSwimRehab(input)).toEqual({ ok: true, sessionId });
    const write = requests.find((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))!;
    expect(write.body).toEqual({
      p_workout_id: workout.id, p_protocol_id: protocolId, p_expected_revision: revision,
      p_prescription: prescription, p_request_id: receiptId,
    });
    expect(requests.filter((request) => request.method !== "GET").map((request) => request.url.pathname)).toEqual([
      "/rest/v1/rpc/independent_programs_ready", "/rest/v1/rpc/start_swim_rehab_session",
    ]);
    expect(requests.at(-1)?.url.searchParams.get("user_id")).toBe(`eq.${userId}`);
    expect(requests.at(-1)?.url.searchParams.get("id")).toBe(`eq.${sessionId}`);
  });
  it("replays the original request prescription without rereading a changed or removed library", async () => {
    const { requests } = fixture({ request: { data: previousRequest } });
    expect(await startSwimRehab(input)).toEqual({ ok: true, sessionId });
    expect(requests.some((request) => /rehab_protocols|swim_workouts|movements|limitations/.test(request.url.pathname))).toBe(false);
    expect(requests.find((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))?.body?.p_prescription).toEqual(prescription);
  });
  it("reopens the same issued occurrence from another tab after detachment", async () => {
    const { requests } = fixture({ occurrences: { data: [occurrence] } });
    expect(await startSwimRehab({ ...input, requestId: otherMovementId })).toEqual({ ok: true, sessionId });
    expect(requests.some((request) => request.url.pathname.endsWith("/rehab_protocols"))).toBe(false);
  });
  it.each([null, { ...storedSession, deleted_at: "2026-09-23T10:00:00Z" }])(
    "refuses recreating a deleted or permanently removed occurrence", async (session) => {
      const { requests } = fixture({ occurrences: { data: [occurrence] }, session: { data: session } });
      expect(await startSwimRehab(input)).toHaveProperty("error");
      expect(requests.some((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))).toBe(false);
    },
  );
  it("refuses a request reused for another protocol", async () => {
    const { requests } = fixture({ request: { data: previousRequest } });
    expect(await startSwimRehab({ ...input, protocolId: movementId })).toMatchObject({ errorCode: "validation" });
    expect(requests.some((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))).toBe(false);
  });
  it.each(["movements", "limitations"])("fails closed when %s cannot be read", async (table) => {
    const { requests } = fixture({ [table]: { data: { code: "42501" }, status: 403 } });
    expect(await startSwimRehab(input)).toHaveProperty("error");
    expect(requests.some((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))).toBe(false);
  });
  it("DC-D5 refuses exercises blocked by active account limitations", async () => {
    const { requests } = fixture({ limitations: { data: [{
      region: "shoulder_scapular", kind: "Region limitation", resolved_at: null,
    }] } });
    expect(await startSwimRehab(input)).toHaveProperty("error");
    expect(requests.some((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))).toBe(false);
  });
  it("rejects missing catalog exercises and ordinary cardio in a rehab attachment", async () => {
    for (const data of [[], [catalogMovement, { ...catalogMovement, id: otherMovementId, pattern: "cardio" }]]) {
      const { requests } = fixture({ movements: { data } });
      expect(await startSwimRehab(input)).toMatchObject({ errorCode: "validation" });
      expect(requests.some((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))).toBe(false);
    }
  });
  it("returns stale-review refusal without a fallback insert or refreshing away inputs", async () => {
    const { requests } = fixture({
      "rpc/start_swim_rehab_session": { data: { code: "40001", message: "Your schedule changed." }, status: 409 },
    });
    expect(await startSwimRehab(input)).toMatchObject({ errorCode: "validation" });
    expect(requests.filter((request) => request.url.pathname.endsWith("/start_swim_rehab_session"))).toHaveLength(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("does not accept a result without the authoritative matching owned session", async () => {
    fixture({ session: { data: { ...storedSession, prescription: { items: [] } } } });
    expect(await startSwimRehab(input)).toHaveProperty("error");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("preserves a confirmed start when cache refresh fails", async () => {
    fixture();
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Synthetic refresh failure"); });
    expect(await startSwimRehab(input)).toMatchObject({ ok: true, sessionId, warning: expect.any(String) });
  });
  it("rejects injected ownership, prescription or malformed identity before reading or writing", async () => {
    const { requests } = fixture();
    for (const value of [{ ...input, userId }, { ...input, prescription }, { ...input, workoutId: "invalid" }]) {
      expect(await startSwimRehab(value)).toMatchObject({ errorCode: "validation" });
    }
    expect(requests).toHaveLength(0);
  });
});
