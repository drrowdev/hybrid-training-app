import { beforeEach, describe, expect, it, vi } from "vitest";

const { after, state } = vi.hoisted(() => ({
  after: vi.fn(),
  state: { transitioned: false, transitionRpcMissing: false },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async (name: string) => {
      if (name === "complete_training_session_with_transition") {
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
  }),
  getAuthUser: async () => ({
    data: { user: { id: "00000000-0000-4000-8000-000000000001" } },
    error: null,
  }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", () => ({ after }));

import { completeSessionResult } from "../actions";

describe("completeSessionResult replay", () => {
  beforeEach(() => {
    state.transitioned = false;
    state.transitionRpcMissing = false;
    after.mockReset();
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
});
