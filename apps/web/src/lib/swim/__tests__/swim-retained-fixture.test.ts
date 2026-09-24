import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { completeRetainedSwim, retainedSwimActor } from "../../../../e2e/fixtures/swim-retained";
import { swimFixture, userId, sessionId } from "./fixtures";
import type { SwimCompletion, SwimWorkoutRow } from "../storage";

const factory = vi.hoisted(() => ({ getClient: vi.fn<() => SupabaseClient>() }));
vi.mock("@supabase/supabase-js", async (original) => ({
  ...await original<typeof import("@supabase/supabase-js")>(), createClient: factory.getClient,
}));
beforeEach(() => { vi.clearAllMocks(); });

type Failure = "start-error" | "start-owner" | "start-state" | "complete-error" | "transition" |
  "complete-owner" | "complete-id" | "complete-revision" | "complete-session" | "receipt-session";

async function fixture(failure?: Failure) {
  const actual = await vi.importActual<typeof import("@supabase/supabase-js")>("@supabase/supabase-js");
  const workout = swimFixture().workouts[0];
  const started: SwimWorkoutRow = { ...workout, status: "started", session_id: sessionId, revision: workout.revision + 1 };
  const writes: { name: string; args: Record<string, unknown> }[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const name = new URL(input instanceof Request ? input.url : input.toString()).pathname.split("/").at(-1)!;
    const args = JSON.parse(String(init?.body)) as Record<string, unknown>;
    writes.push({ name, args });
    const respond = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
      status, headers: { "Content-Type": "application/json" },
    });
    if (name === "swim_start_workout") {
      if (failure === "start-error") return respond({ message: "Synthetic start refusal" }, 400);
      return respond({ ...started, ...(failure === "start-owner" ? { user_id: sessionId } : {}),
        ...(failure === "start-state" ? { status: "scheduled" } : {}) });
    }
    if (name === "swim_complete_workout") {
      if (failure === "complete-error") return respond({ message: "Synthetic completion refusal" }, 400);
      const result: SwimCompletion = {
        workout: { ...started, status: "completed", revision: started.revision + 1 },
        session_id: sessionId, cardio_log_id: "00000000-0000-4000-8000-000000000030", transitioned: true,
      };
      if (failure === "transition") result.transitioned = false;
      if (failure === "complete-owner") result.workout.user_id = sessionId;
      if (failure === "complete-id") result.workout.id = sessionId;
      if (failure === "complete-revision") result.workout.revision = started.revision;
      if (failure === "complete-session") result.workout.session_id = null;
      if (failure === "receipt-session") result.session_id = userId;
      return respond(result);
    }
    throw new Error(`Unexpected synthetic request: ${name}`);
  });
  const actor = actual.createClient("http://127.0.0.1:54321", "synthetic-anon", {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch },
  });
  factory.getClient.mockReturnValue(actor);
  return { actor, workout, started, writes, fetch };
}

describe("DC-SW1/DC-SW7/DC-SW8 retained native fixture arrangement", () => {
  it.each([false, true])("uses existing storage with one receipt and no prescription mutation (already started: %s)", async (alreadyStarted) => {
    const { actor, workout, started, writes } = await fixture();
    const before = structuredClone(workout);
    const result = await completeRetainedSwim(actor, alreadyStarted ? started : workout, {
      lengths: 6, timeMs: 492345, rpe: 5, splits: [{ lengths: 4, timeMs: 135125 }],
      notes: "Synthetic result", deviationReason: "Stopped early",
    });
    expect(workout).toEqual(before);
    expect(result.workout).toEqual({ ...started, status: "completed", revision: started.revision + 1 });
    expect(writes.map(({ name }) => name)).toEqual(
      alreadyStarted ? ["swim_complete_workout"] : ["swim_start_workout", "swim_complete_workout"],
    );
    if (!alreadyStarted) expect(writes[0].args).toEqual({ p_workout_id: workout.id, p_expected_revision: workout.revision });
    const complete = writes.at(-1)!.args;
    expect(complete).toEqual({
      p_workout_id: workout.id, p_expected_revision: started.revision,
      p_client_log_id: expect.stringMatching(/^[0-9a-f-]{36}$/), p_completion_entry_id: complete.p_client_log_id,
      p_notes: "Synthetic result", p_allow_changed_course: false,
      p_result: {
        version: 1, snapshot: workout.definition.issued.snapshot, lengths: 6, timeMs: 492345, rpe: 5,
        completion: "partial", splits: [{ lengths: 4, timeMs: 135125 }],
        provenance: { source: "manual", recordedAt: expect.any(String), deviationReason: "Stopped early" },
      },
    });
  });

  it("uses the exact issued whole-length total for a full retained result", async () => {
    const { actor, workout, writes } = await fixture();
    await completeRetainedSwim(actor, workout);
    expect(writes.at(-1)!.args.p_result).toMatchObject({
      lengths: workout.definition.issued.totalLengths, timeMs: 900000, rpe: 6, completion: "completed",
    });
  });

  it.each(["start-error", "start-owner", "start-state", "complete-error", "transition", "complete-owner",
    "complete-id", "complete-revision", "complete-session", "receipt-session"] as const)(
    "fails explicitly on %s without a success-shaped retained result", async (failure) => {
      const { actor, workout, writes } = await fixture(failure);
      await expect(completeRetainedSwim(actor, workout)).rejects.toThrow();
      if (failure.startsWith("start-")) expect(writes.map(({ name }) => name)).toEqual(["swim_start_workout"]);
    },
  );

  it.each(["completed", "skipped"] as const)("does not start or complete %s work", async (status) => {
    const { actor, workout, writes } = await fixture();
    await expect(completeRetainedSwim(actor, { ...workout, status })).rejects.toThrow();
    expect(writes).toEqual([]);
  });

  it("rejects invalid native measurements before completion", async () => {
    const { actor, started, writes } = await fixture();
    await expect(completeRetainedSwim(actor, started, { lengths: 1.5 })).rejects.toThrow("Invalid retained");
    expect(writes).toEqual([]);
  });

  it.each([false, true])("requires the exact authenticated fixture owner (foreign: %s)", async (foreign) => {
    const { actor, fetch } = await fixture();
    const user = { email: "synthetic@example.invalid", password: "synthetic", userId };
    const signedUser = { id: foreign ? sessionId : userId, app_metadata: {}, user_metadata: {},
      aud: "authenticated", created_at: "2026-09-01T00:00:00Z" };
    vi.spyOn(actor.auth, "signInWithPassword").mockResolvedValue({
      data: { user: signedUser, session: { user: signedUser, access_token: "synthetic",
        refresh_token: "synthetic", expires_in: 3600, token_type: "bearer" } }, error: null,
    });
    const config = { supabaseUrl: "http://127.0.0.1:54321", anonKey: "synthetic-anon", serviceRoleKey: "synthetic-admin" };
    const pending = retainedSwimActor(config, user);
    if (foreign) await expect(pending).rejects.toThrow("authenticate");
    else expect(await pending).toBe(actor);
    expect(fetch).not.toHaveBeenCalled();
  });
});
