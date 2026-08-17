/**
 * `recomputeAfterCompletedSessionSetChange` — derived state must follow a
 * post-hoc set edit.
 *
 * A completed session is no longer immutable (the drawer's ✎ Edit opens the
 * full session view, which can add or correct a set). Two values computed at
 * completion time therefore have to be re-stamped:
 *
 *   - `planned_sessions.effective_stress_load` (`recomputeActualSessionLoad`)
 *   - `region_state` load + freshness (`recomputeRegionState`)
 *
 * The gate is the whole point: `recomputeRegionState` rebuilds the user's entire
 * ledger, so it must never fire per-set during a live workout. Plan §6.9 —
 * one canonical home, call sites import it.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";

const eslCalls: Array<Record<string, unknown>> = [];
const regionCalls: Array<[string, string]> = [];
const sessionReads: Array<{ table: string; eqs: Array<[string, unknown]> }> = [];

let completedAt: string | null = null;
let sessionReadThrows = false;
let eslThrows = false;
let regionThrows = false;

vi.mock("@/lib/engine/recompute-actual-session-load", () => ({
  recomputeActualSessionLoad: async (args: Record<string, unknown>) => {
    eslCalls.push(args);
    if (eslThrows) throw new Error("esl boom");
  },
}));

vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: async (_c: unknown, userId: string, tz: string) => {
    regionCalls.push([userId, tz]);
    if (regionThrows) throw new Error("region boom");
  },
}));

vi.mock("@/lib/planner/queries", () => ({
  getUserTimezone: async () => "Europe/Amsterdam",
}));

function fakeSupabase() {
  return {
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const builder = {
        select: () => builder,
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return builder;
        },
        maybeSingle: async () => {
          sessionReads.push({ table, eqs });
          if (sessionReadThrows) throw new Error("read boom");
          return { data: { completed_at: completedAt }, error: null };
        },
      };
      return builder;
    },
  };
}

async function run() {
  const { recomputeAfterCompletedSessionSetChange } = await import(
    "../post-completion-recompute"
  );
  return recomputeAfterCompletedSessionSetChange({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- narrow stub
    supabase: fakeSupabase() as any,
    sessionId: SESSION_ID,
    userId: USER_ID,
  });
}

describe("recomputeAfterCompletedSessionSetChange", () => {
  beforeEach(() => {
    eslCalls.length = 0;
    regionCalls.length = 0;
    sessionReads.length = 0;
    completedAt = null;
    sessionReadThrows = false;
    eslThrows = false;
    regionThrows = false;
  });

  it("no-ops while the session is still in flight (live-logging hot path)", async () => {
    completedAt = null;
    const res = await run();
    expect(res).toEqual({ recomputed: false });
    expect(eslCalls).toHaveLength(0);
    expect(regionCalls).toHaveLength(0);
  });

  it("re-stamps effective_stress_load AND region_state once the session is complete", async () => {
    completedAt = "2026-05-26T18:00:00.000Z";
    const res = await run();
    expect(res).toEqual({ recomputed: true });

    expect(eslCalls).toHaveLength(1);
    expect(eslCalls[0]).toMatchObject({
      sessionId: SESSION_ID,
      // Completion was already proven by the read above, so don't re-read it.
      requireCompleted: false,
    });

    expect(regionCalls).toEqual([[USER_ID, "Europe/Amsterdam"]]);
  });

  it("keeps the completion read user-scoped (RLS defence in depth)", async () => {
    completedAt = "2026-05-26T18:00:00.000Z";
    await run();
    expect(sessionReads).toHaveLength(1);
    expect(sessionReads[0]!.table).toBe("sessions");
    expect(sessionReads[0]!.eqs).toEqual([
      ["id", SESSION_ID],
      ["user_id", USER_ID],
    ]);
  });

  it("never lets a recompute failure surface as a failed set write", async () => {
    completedAt = "2026-05-26T18:00:00.000Z";
    eslThrows = true;
    regionThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(run()).resolves.toEqual({ recomputed: true });
    // A failed ESL stamp must not skip the region rebuild.
    expect(regionCalls).toHaveLength(1);
    errSpy.mockRestore();
  });

  it("degrades to a no-op when the completion read itself fails", async () => {
    sessionReadThrows = true;
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(run()).resolves.toEqual({ recomputed: false });
    expect(eslCalls).toHaveLength(0);
    expect(regionCalls).toHaveLength(0);
    errSpy.mockRestore();
  });
});
