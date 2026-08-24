/**
 * getCompletedSessionSummary — read coverage with a hand-rolled supabase mock
 * (same pattern as link-activity.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  session: Record<string, unknown> | null;
  cardio: Record<string, unknown>[];
  sets: Record<string, unknown>[];
  profile: Record<string, unknown> | null;
  setsError: { message: string } | null;
  cardioError: { message: string } | null;
} = { session: null, cardio: [], sets: [], profile: null, setsError: null, cardioError: null };

/** Resolves via `.maybeSingle()` — a single-row read. */
function single<T>(value: T) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain;
  chain.maybeSingle = async () => ({ data: value, error: null });
  return chain;
}

/** Resolves by awaiting the builder itself — a list read. */
function list<T>(rows: T[], error: { message: string } | null = null) {
  const chain: Record<string, unknown> = {};
  for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain;
  chain.then = (resolve: (v: unknown) => void) =>
    resolve({ data: error ? null : rows, error });
  return chain;
}

vi.mock("@/lib/supabase/server", () => ({
  getAuthUser: async () => ({ data: { user: { id: "u1" } } }),
  createClient: async () => ({
    from(table: string) {
      if (table === "sessions") return single(state.session);
      if (table === "cardio_logs") return list(state.cardio, state.cardioError);
      if (table === "set_logs") return list(state.sets, state.setsError);
      if (table === "profiles") return single(state.profile);
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { getCompletedSessionSummary } from "../completed-summary-action";

const SID = "00000000-0000-0000-0000-0000000000c3";

function strengthSet(over: Record<string, unknown> = {}) {
  return {
    movement_id: "mv-squat",
    set_index: 0,
    weight_kg: "100.00",
    reps: 5,
    duration_sec: null,
    distance_m: null,
    set_kind: "main",
    skipped: false,
    skip_reason: null,
    movement: { display_name: "Squat" },
    ...over,
  };
}

describe("getCompletedSessionSummary", () => {
  beforeEach(() => {
    state.session = { id: SID, performed_at: "2026-06-22T07:00:00Z", duration_min: 45, session_rpe: null };
    state.cardio = [];
    state.sets = [];
    state.profile = null;
    state.setsError = null;
    state.cardioError = null;
  });

  it("returns null when the session isn't found / owned", async () => {
    state.session = null;
    expect(await getCompletedSessionSummary(SID)).toBeNull();
  });

  it("returns a cardio summary with stats + modality label", async () => {
    state.session = { id: SID, performed_at: "2026-06-22T07:00:00Z", duration_min: 57, session_rpe: 7 };
    state.cardio = [
      {
        duration_sec: 3420,
        distance_km: "8.360",
        avg_hr_bpm: 152,
        max_hr_bpm: 175,
        avg_pace_sec_per_km: null,
        hr_zones: null,
        modality: "run",
        inferred_kind: "cardio_threshold",
      },
    ];
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

  it("aggregates EVERY cardio block, not just the first", async () => {
    // A planned cardio day can be a warm-up plus intervals. Reading one block
    // reported a fraction of the session as if it were the whole thing.
    state.cardio = [
      {
        duration_sec: 600,
        distance_km: 2,
        avg_hr_bpm: 120,
        max_hr_bpm: 140,
        avg_pace_sec_per_km: null,
        hr_zones: null,
        modality: "run",
        inferred_kind: "cardio_z2",
      },
      {
        duration_sec: 1200,
        distance_km: 5,
        avg_hr_bpm: 170,
        max_hr_bpm: 186,
        avg_pace_sec_per_km: null,
        hr_zones: null,
        modality: "run",
        inferred_kind: "cardio_vo2",
      },
    ];
    const s = await getCompletedSessionSummary(SID);
    expect(s?.distanceKm).toBeCloseTo(7, 3);
    expect(s?.maxHrBpm).toBe(186);
  });

  it("handles a logged session with no cardio log (pure strength)", async () => {
    const s = await getCompletedSessionSummary(SID);
    expect(s?.isCardio).toBe(false);
    expect(s?.durationMin).toBe(45);
    expect(s?.distanceKm).toBeNull();
  });

  it("returns the lifts that were logged, named and in order", async () => {
    state.sets = [
      strengthSet({ set_index: 0 }),
      strengthSet({ set_index: 1 }),
      strengthSet({
        movement_id: "mv-ohp",
        set_index: 2,
        weight_kg: "50.00",
        reps: 8,
        set_kind: "back_off",
        movement: { display_name: "Overhead Press" },
      }),
    ];
    const s = await getCompletedSessionSummary(SID);
    expect(s?.lifts.map((l) => l.name)).toEqual(["Squat", "Overhead Press"]);
    expect(s?.lifts[0].groups[0].entries).toEqual([
      { sets: 2, measure: { type: "reps", reps: 5 }, weightKg: 100 },
    ]);
    expect(s?.lifts[1].groups[0].kind).toBe("back_off");
  });

  it("reads a movement join that arrives as an array", async () => {
    state.sets = [strengthSet({ movement: [{ display_name: "Squat" }] })];
    expect((await getCompletedSessionSummary(SID))?.lifts[0].name).toBe("Squat");
  });

  it("reports an empty session as empty rather than as a failure", async () => {
    const s = await getCompletedSessionSummary(SID);
    expect(s).not.toBeNull();
    expect(s?.lifts).toEqual([]);
  });

  it("reports a failed read as a failure rather than as an empty session", async () => {
    // Falling through to `lifts: []` would tell a lifter they logged nothing —
    // the exact complaint this view exists to answer.
    state.sets = [strengthSet()];
    state.setsError = { message: "statement timeout" };
    expect(await getCompletedSessionSummary(SID)).toBeNull();

    state.setsError = null;
    state.cardioError = { message: "statement timeout" };
    expect(await getCompletedSessionSummary(SID)).toBeNull();
  });

  it("still returns a summary when only the profile read fails", async () => {
    // Units are cosmetic; losing them must not hide the session.
    state.sets = [strengthSet()];
    const s = await getCompletedSessionSummary(SID);
    expect(s?.units).toBe("metric");
    expect(s?.lifts).toHaveLength(1);
  });

  it("carries the lifter's weight unit so loads are rendered the way they read them", async () => {
    expect((await getCompletedSessionSummary(SID))?.units).toBe("metric");
    state.profile = { units: "imperial" };
    expect((await getCompletedSessionSummary(SID))?.units).toBe("imperial");
  });
});
