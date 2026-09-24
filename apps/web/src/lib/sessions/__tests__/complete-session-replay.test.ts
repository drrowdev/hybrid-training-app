import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthRetryableFetchError, AuthSessionMissingError } from "@supabase/supabase-js";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

const { after, getAuthUser, state } = vi.hoisted(() => ({
  after: vi.fn(),
  getAuthUser: vi.fn(),
  state: {
    transitioned: false,
    transitionRpcMissing: false,
    transitionRpcError: null as { code: string; message: string } | null,
    emptyCompletion: false,
    rpcCalls: [] as string[],
    transitionRpcArgs: null as Record<string, unknown> | null,
    afterTasks: [] as Promise<void>[],
    bwSideEffects: vi.fn(),
    hasProgram: false,
    progressionError: null as Error | null,
    programSteps: [] as string[],
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    rpc: async (name: string, args?: Record<string, unknown>) => {
      state.rpcCalls.push(name);
      if (name === "complete_training_session_with_transition") {
        state.transitionRpcArgs = args ?? null;
        if (state.transitionRpcMissing) {
          return {
            data: null,
            error: { code: "PGRST202", message: "Function not found" },
          };
        }
        if (state.transitionRpcError) {
          return { data: null, error: state.transitionRpcError };
        }
        return {
          data: state.emptyCompletion ? [] : [
            {
              user_id: "00000000-0000-4000-8000-000000000001",
              transitioned: state.transitioned,
            },
          ],
          error: null,
        };
      }
      return {
        data: "00000000-0000-4000-8000-000000000001",
        error: null,
      };
    },
    from: (table: string) => {
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => ({
          data: table === "profiles" ? { timezone: "UTC" }
            : table === "planned_sessions" && state.hasProgram ? { block_id: "original-program" } : null,
          error: null,
        }),
      };
      return query;
    },
  })),
  getAuthUser,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after }));
vi.mock("@/lib/sessions/post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: async () => ({ recomputed: false }),
}));
vi.mock("@/lib/sessions/bw-set-logging", () => ({
  applyBwSessionCompletionSideEffects: state.bwSideEffects,
}));
vi.mock("@/lib/planner/bw-diagnostics-snapshot", () => ({
  captureBwDiagnosticsSnapshot: async () => undefined,
}));
vi.mock("@/lib/training-maxes/actions", () => ({
  generateTmSuggestionsForSession: async () => undefined,
}));
vi.mock("@/lib/platform/progression", () => ({
  applyProgramProgression: async (args: { blockId: string }) => {
    expect(args.blockId).toBe("original-program");
    state.programSteps.push("progression");
    if (state.progressionError) throw state.progressionError;
  },
}));
vi.mock("@/lib/planner/completion", () => ({
  maybeCompleteBlock: async (_client: unknown, blockId: string) => {
    expect(blockId).toBe("original-program");
    state.programSteps.push("settlement");
  },
}));

import { completeSessionResult } from "../actions";

describe("completeSessionResult replay", () => {
  beforeEach(() => {
    state.transitioned = false;
    state.transitionRpcMissing = false;
    state.transitionRpcError = null;
    state.emptyCompletion = false;
    state.rpcCalls.length = 0;
    state.transitionRpcArgs = null;
    after.mockReset();
    state.afterTasks.length = 0;
    state.bwSideEffects.mockReset();
    state.hasProgram = false;
    state.progressionError = null;
    state.programSteps.length = 0;
    vi.mocked(createClient).mockClear();
    vi.mocked(revalidatePath).mockClear();
    getAuthUser.mockReset();
    getAuthUser.mockResolvedValue({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
      error: null,
    });
    after.mockImplementation((task: () => Promise<void>) => {
      state.afterTasks.push(task());
    });
  });

  it.each([null, new AuthSessionMissingError()])(
    "returns auth without a completion client, RPC or effects for positively absent identity (%s)", async (error) => {
      getAuthUser.mockResolvedValue({ data: { user: null }, error });
      state.transitioned = true;

      await expect(
        completeSessionResult("00000000-0000-4000-8000-000000000010", null),
      ).resolves.toEqual({ error: "not-signed-in", errorCode: "auth" });

      expect(getAuthUser).toHaveBeenCalledOnce();
      expect(createClient).not.toHaveBeenCalled();
      expect(state.rpcCalls).toEqual([]);
      expect(after).not.toHaveBeenCalled();
      expect(state.bwSideEffects).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  it("still attempts the cookie-bearing completion RPC during a retryable Auth outage", async () => {
    getAuthUser.mockResolvedValue({
      data: { user: null },
      error: new AuthRetryableFetchError("Service temporarily unavailable", 503),
    });

    await expect(
      completeSessionResult("00000000-0000-4000-8000-000000000010", null),
    ).resolves.toEqual({ ok: true });

    expect(state.rpcCalls).toEqual(["complete_training_session_with_transition"]);
    expect(after).toHaveBeenCalledOnce();
  });

  it("keeps signed-in permission errors transient without fallback or effects", async () => {
    state.transitionRpcError = { code: "42501", message: "Permission denied" };

    await expect(
      completeSessionResult("00000000-0000-4000-8000-000000000010", null),
    ).resolves.toEqual({ error: "Permission denied", errorCode: "transient" });

    expect(state.rpcCalls).toEqual(["complete_training_session_with_transition"]);
    expect(after).not.toHaveBeenCalled();
    expect(state.bwSideEffects).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("validates the session before looking up identity or attempting completion", async () => {
    await expect(completeSessionResult("invalid", null)).resolves.toMatchObject({ errorCode: "validation" });
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
    expect(state.rpcCalls).toEqual([]);
    expect(after).not.toHaveBeenCalled();
  });

  it.each([true, false])("retains the post-RPC empty-result identity check (signed in: %s)", async (signedIn) => {
    state.emptyCompletion = true;
    getAuthUser.mockResolvedValueOnce({
      data: { user: { id: "00000000-0000-4000-8000-000000000001" } }, error: null,
    }).mockResolvedValueOnce({
      data: { user: signedIn ? { id: "00000000-0000-4000-8000-000000000001" } : null },
      error: signedIn ? null : new AuthSessionMissingError(),
    });

    await expect(
      completeSessionResult("00000000-0000-4000-8000-000000000010", null),
    ).resolves.toEqual(signedIn
      ? { error: "Session not found.", errorCode: "not_found" }
      : { error: "not-signed-in", errorCode: "auth" });

    expect(getAuthUser).toHaveBeenCalledTimes(2);
    expect(state.rpcCalls).toEqual(["complete_training_session_with_transition"]);
    expect(after).not.toHaveBeenCalled();
  });

  it("schedules replay-safe reconciliation when the completion RPC reports a replay", async () => {
    await expect(
      completeSessionResult(
        "00000000-0000-4000-8000-000000000010",
        "replayed offline completion",
      ),
    ).resolves.toEqual({ ok: true });

    expect(after).toHaveBeenCalledTimes(1);
  });

  it("schedules completion side effects only for the completion transition", async () => {
    state.transitioned = true;
    await expect(
      completeSessionResult("00000000-0000-4000-8000-000000000010", null),
    ).resolves.toEqual({ ok: true });

    expect(after).toHaveBeenCalledTimes(1);
  });

  it("uses the compatible scalar completion RPC while the new migration is pending", async () => {
    state.transitionRpcMissing = true;

    await expect(
      completeSessionResult("00000000-0000-4000-8000-000000000010", null),
    ).resolves.toEqual({ ok: true });

    expect(after).toHaveBeenCalledTimes(1);
  });

  it("forwards a durable completion entry to the transition RPC", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000010";
    const completionEntryId = "00000000-0000-4000-8000-000000000011";

    await expect(
      completeSessionResult(sessionId, null, completionEntryId),
    ).resolves.toEqual({ ok: true });

    expect(state.transitionRpcArgs).toEqual({
      p_session_id: sessionId,
      p_notes: null,
      p_completion_entry_id: completionEntryId,
    });
  });

  it("completes legacy offline entries without storing an unusable receipt", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000010";

    await expect(
      completeSessionResult(sessionId, null, "complete-1712345678901"),
    ).resolves.toEqual({ ok: true });

    expect(state.transitionRpcArgs).toEqual({
      p_session_id: sessionId,
      p_notes: null,
      p_completion_entry_id: null,
    });
  });

  it("runs bodyweight completion side effects once when a legacy entry is retried", async () => {
    const sessionId = "00000000-0000-4000-8000-000000000010";
    const legacyEntryId = "complete-1712345678901";
    state.transitioned = true;

    await expect(completeSessionResult(sessionId, null, legacyEntryId)).resolves.toEqual({
      ok: true,
    });
    await Promise.all(state.afterTasks);

    state.transitioned = false;
    await expect(completeSessionResult(sessionId, null, legacyEntryId)).resolves.toEqual({
      ok: true,
    });
    await Promise.all(state.afterTasks);

    expect(state.bwSideEffects).toHaveBeenCalledTimes(1);
  });

  it("DC-R5 retries saved completion against its original program before allowing settlement", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      state.hasProgram = true;
      state.transitioned = true;
      state.progressionError = new Error("Temporary progression failure");
      const sessionId = "00000000-0000-4000-8000-000000000010";
      const receiptId = "00000000-0000-4000-8000-000000000011";
      const result = await completeSessionResult(sessionId, null, receiptId);
      expect(result).toMatchObject({ errorCode: "transient", workoutSaved: true });
      expect(result.error).toMatch(/workout saved/i);
      expect(state.programSteps).toEqual(["progression"]);
      await Promise.all(state.afterTasks);
      state.transitioned = false;
      state.progressionError = null;
      expect(await completeSessionResult(sessionId, null, receiptId)).toEqual({ ok: true });
      await Promise.all(state.afterTasks);
      expect(state.programSteps).toEqual(["progression", "progression", "settlement"]);
      expect(state.bwSideEffects).toHaveBeenCalledTimes(1);
      expect(state.transitionRpcArgs?.p_completion_entry_id).toBe(receiptId);
    } finally { errors.mockRestore(); }
  });
});
