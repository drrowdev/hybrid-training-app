/**
 * Mocked end-to-end sync orchestration.
 *
 * Verifies the `syncStrava()` flow without hitting Strava's API:
 *   - new activities create session + cardio_logs rows
 *   - already-imported activities are skipped (unique-violation path)
 *   - unsupported sport types are skipped
 *   - last_synced_at is updated on success
 *   - recomputeRegionState is called when imports happen
 *
 * Mocks the Strava client module entirely. Supabase is replaced with a
 * tiny chainable stub that records the calls we care about.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StravaActivity } from "../client";

const listActivitiesSince = vi.fn();
const refreshAccessToken = vi.fn();
const recomputeRegionState = vi.fn(async () => ({ updated: 0, firstDate: null, lastDate: null }));

vi.mock("../client", () => ({
  listActivitiesSince: (...args: Parameters<typeof listActivitiesSince>) => listActivitiesSince(...args),
  refreshAccessToken: (...args: Parameters<typeof refreshAccessToken>) => refreshAccessToken(...args),
}));
vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: (...args: Parameters<typeof recomputeRegionState>) => recomputeRegionState(...args),
}));
vi.mock("@/lib/planner/queries", () => ({
  getUserTimezone: async () => "UTC",
}));

// Import AFTER the mocks are registered.
import { syncStrava } from "../sync";

type SessionRow = { id: string; user_id: string; strava_activity_id: number };
type CardioRow = { id?: string; session_id: string; strava_activity_id: string; modality: string };

function makeActivity(over: Partial<StravaActivity> = {}): StravaActivity {
  return {
    id: 1001,
    name: "Easy Run",
    type: "Run",
    sport_type: "Run",
    start_date: "2026-05-20T07:00:00Z",
    start_date_local: null,
    elapsed_time: 1800,
    moving_time: 1800,
    distance: 5000,
    average_heartrate: 148,
    max_heartrate: 165,
    perceived_exertion: 6,
    suffer_score: null,
    description: null,
    trainer: false,
    ...over,
  };
}

/**
 * Minimal Supabase mock. Tracks sessions + cardio_logs + the connection,
 * mimics the chainable from(...).select/insert/update/delete/eq surface
 * the sync code uses.
 */
function makeSupabase(initial: {
  connection: { user_id: string; access_token: string; refresh_token: string; expires_at: string; last_synced_at: string | null };
  existingActivityIds?: number[];
}) {
  const state = {
    connection: { ...initial.connection, last_sync_error: null as string | null },
    sessions: [] as SessionRow[],
    cardio: [] as CardioRow[],
  };
  // Pre-seed the unique-violation path.
  let nextSessionId = 1;
  for (const aid of initial.existingActivityIds ?? []) {
    state.sessions.push({ id: `existing-${aid}`, user_id: initial.connection.user_id, strava_activity_id: aid });
  }

  const fromMock = (table: string) => {
    if (table === "strava_connections") return connectionTable();
    if (table === "sessions") return sessionsTable();
    if (table === "cardio_logs") return cardioTable();
    if (table === "planned_sessions") return plannedSessionsTable();
    if (table === "profiles") return profilesTable();
    throw new Error("Unexpected table: " + table);
  };

  function connectionTable() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: state.connection, error: null }),
        }),
      }),
      update: (patch: Record<string, unknown>) => ({
        eq: async () => {
          state.connection = { ...state.connection, ...patch } as typeof state.connection;
          return { data: null, error: null };
        },
      }),
    };
  }

  function sessionsTable() {
    return {
      insert: (row: SessionRow) => ({
        select: () => ({
          maybeSingle: async () => {
            const exists = state.sessions.find((s) => s.strava_activity_id === row.strava_activity_id);
            if (exists) {
              return { data: null, error: { code: "23505", message: "duplicate key" } };
            }
            const id = `sess-${nextSessionId++}`;
            state.sessions.push({ id, user_id: row.user_id, strava_activity_id: row.strava_activity_id });
            return { data: { id }, error: null };
          },
        }),
      }),
      delete: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    };
  }

  function cardioTable() {
    return {
      insert: (row: CardioRow) => ({
        select: () => ({
          maybeSingle: async () => {
            const id = `cardio-${state.cardio.length + 1}`;
            state.cardio.push({ ...row, id });
            return { data: { id }, error: null };
          },
        }),
      }),
      // Phase 2 — best-effort update for `inferred_kind` /
      // `inferred_confidence`. The mock just discards the payload
      // since the sync tests don't assert on it (the link logic has
      // its own dedicated test file).
      update: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    };
  }

  function plannedSessionsTable() {
    // No external cardio blocks → the link query returns an empty array.
    return {
      select: () => ({
        eq: () => ({
          eq: () => ({
            eq: () => ({
              is: async () => ({ data: [], error: null }),
            }),
          }),
        }),
      }),
      update: () => ({
        eq: async () => ({ data: null, error: null }),
      }),
    };
  }

  function profilesTable() {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { intake: { hrMax: 190 } },
            error: null,
          }),
        }),
      }),
    };
  }

  return { from: fromMock, state };
}

describe("syncStrava orchestration (mocked)", () => {
  beforeEach(() => {
    listActivitiesSince.mockReset();
    refreshAccessToken.mockReset();
    recomputeRegionState.mockReset();
    recomputeRegionState.mockResolvedValue({ updated: 0, firstDate: null, lastDate: null });
  });

  it("imports a new activity end-to-end and updates last_synced_at", async () => {
    listActivitiesSince.mockResolvedValue([makeActivity()]);
    const supa = makeSupabase({
      connection: {
        user_id: "u1",
        access_token: "tok",
        refresh_token: "ref",
        // Fresh token (1h away from expiry).
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        last_synced_at: null,
      },
    });

    const result = await syncStrava(supa as never, "u1");

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(0);
    expect(supa.state.sessions).toHaveLength(1);
    expect(supa.state.sessions[0]?.strava_activity_id).toBe(1001);
    expect(supa.state.cardio).toHaveLength(1);
    expect(supa.state.cardio[0]?.modality).toBe("run");
    expect(supa.state.connection.last_synced_at).toBeTruthy();
    expect(supa.state.connection.last_sync_error).toBeNull();
    expect(recomputeRegionState).toHaveBeenCalledOnce();
  });

  it("skips activities that already exist (unique violation) — idempotent re-sync", async () => {
    listActivitiesSince.mockResolvedValue([makeActivity({ id: 42 })]);
    const supa = makeSupabase({
      connection: {
        user_id: "u1",
        access_token: "tok",
        refresh_token: "ref",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        last_synced_at: null,
      },
      existingActivityIds: [42],
    });

    const result = await syncStrava(supa as never, "u1");

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(1);
    expect(supa.state.cardio).toHaveLength(0);
    // No imports -> no region recompute needed.
    expect(recomputeRegionState).not.toHaveBeenCalled();
  });

  it("skips unsupported sport types (WeightTraining etc.) without touching DB", async () => {
    listActivitiesSince.mockResolvedValue([
      makeActivity({ id: 1, sport_type: "WeightTraining", type: "WeightTraining" }),
      makeActivity({ id: 2, sport_type: "Yoga", type: "Yoga" }),
    ]);
    const supa = makeSupabase({
      connection: {
        user_id: "u1",
        access_token: "tok",
        refresh_token: "ref",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        last_synced_at: null,
      },
    });

    const result = await syncStrava(supa as never, "u1");

    expect(result.imported).toBe(0);
    expect(result.skipped).toBe(2);
    expect(supa.state.sessions).toHaveLength(0);
  });

  it("refreshes the access token when it's about to expire", async () => {
    listActivitiesSince.mockResolvedValue([]);
    refreshAccessToken.mockResolvedValue({
      accessToken: "new-tok",
      refreshToken: "new-ref",
      expiresAt: new Date(Date.now() + 3_600_000),
    });
    const supa = makeSupabase({
      connection: {
        user_id: "u1",
        access_token: "old-tok",
        refresh_token: "old-ref",
        // Already expired.
        expires_at: new Date(Date.now() - 1000).toISOString(),
        last_synced_at: null,
      },
    });

    await syncStrava(supa as never, "u1");

    expect(refreshAccessToken).toHaveBeenCalledWith("old-ref");
    expect(supa.state.connection.access_token).toBe("new-tok");
  });

  it("mixes imports + skips correctly when activities are partly new", async () => {
    listActivitiesSince.mockResolvedValue([
      makeActivity({ id: 100, sport_type: "Run", type: "Run" }),
      makeActivity({ id: 200, sport_type: "Run", type: "Run" }),
      makeActivity({ id: 300, sport_type: "WeightTraining", type: "WeightTraining" }),
    ]);
    const supa = makeSupabase({
      connection: {
        user_id: "u1",
        access_token: "tok",
        refresh_token: "ref",
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        last_synced_at: null,
      },
      existingActivityIds: [100],
    });

    const result = await syncStrava(supa as never, "u1");

    expect(result.imported).toBe(1); // only 200
    expect(result.skipped).toBe(2); // 100 (dup) + 300 (unsupported)
  });

  it("throws when there is no Strava connection for the user", async () => {
    const supa = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };
    await expect(syncStrava(supa as never, "u1")).rejects.toThrow(/Not connected/);
  });
});
