import { beforeEach, describe, expect, it, vi } from "vitest";

const { after, state } = vi.hoisted(() => ({
  after: vi.fn(),
  state: {
    transitioned: false,
    transitionRpcMissing: false,
    rpcCalls: [] as string[],
    transitionRpcArgs: null as Record<string, unknown> | null,
    afterTasks: [] as Promise<void>[],
    bwSideEffects: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
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
        return {
          data: [
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
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: table === "profiles" ? { timezone: "UTC" } : null,
          }),
        }),
      }),
    }),
  }),
  getAuthUser: async () => ({
    data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
    error: null,
  }),
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

import { completeSessionResult } from "../actions";

describe("completeSessionResult replay", () => {
  beforeEach(() => {
    state.transitioned = false;
    state.transitionRpcMissing = false;
    state.rpcCalls.length = 0;
    state.transitionRpcArgs = null;
    after.mockReset();
    state.afterTasks.length = 0;
    state.bwSideEffects.mockReset();
    after.mockImplementation((task: () => Promise<void>) => {
      state.afterTasks.push(task());
    });
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
});
