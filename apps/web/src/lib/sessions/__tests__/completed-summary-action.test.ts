/**
 * getCompletedSessionSummary — read coverage with a hand-rolled supabase mock
 * (same pattern as link-activity.test.ts).
 */
import { describe, it, expect, vi } from "vitest";

const state: {
  session: Record<string, unknown> | null;
  log: Record<string, unknown> | null;
} = { session: null, log: null };

function terminal<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: value, error: null });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: async () => ({ data: { user: { id: "u1" } } }),
  createClient: async () => ({
    from(table: string) {
      if (table === "sessions") return terminal(state.session);
      if (table === "cardio_logs") return terminal(state.log);
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { getCompletedSessionSummary } from "../completed-summary-action";

const SID = "00000000-0000-0000-0000-0000000000c3";

describe("getCompletedSessionSummary", () => {
  it("returns null when the session isn't found / owned", async () => {
    state.session = null;
    expect(await getCompletedSessionSummary(SID)).toBeNull();
  });

  it("returns a cardio summary with gender-correct stats + modality label", async () => {
    state.session = { id: SID, performed_at: "2026-06-22T07:00:00Z", duration_min: 57, session_rpe: 7 };
    state.log = {
      duration_sec: 3420,
      distance_km: "8.360",
      avg_hr_bpm: 152,
      max_hr_bpm: 175,
      inferred_kind: "cardio_threshold",
    };
    const s = await getCompletedSessionSummary(SID);
    expect(s).toMatchObject({
      sessionId: SID,
      durationMin: 57,
      avgHrBpm: 152,
      maxHrBpm: 175,
      modalityLabel: "Threshold",
      isCardio: true,
    });
    expect(s?.distanceKm).toBeCloseTo(8.36, 2);
  });

  it("handles a logged session with no cardio log (pure strength)", async () => {
    state.session = { id: SID, performed_at: "2026-06-22T07:00:00Z", duration_min: 45, session_rpe: null };
    state.log = null;
    const s = await getCompletedSessionSummary(SID);
    expect(s?.isCardio).toBe(false);
    expect(s?.durationMin).toBe(45);
    expect(s?.distanceKm).toBeNull();
  });
});
