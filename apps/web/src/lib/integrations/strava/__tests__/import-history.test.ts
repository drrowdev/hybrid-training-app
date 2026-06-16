/**
 * Coverage for the historical Strava import (`importStravaHistory`):
 *   - happy path with mixed activity types (imports cardio, buckets
 *     skips by category, counts duplicates)
 *   - 365-day cap rejection
 *   - Zod strict rejects unknown fields
 *   - auto-link to a planned cardio session
 *   - hybrid completion guard (PR #208): planned hybrid w/ unlogged
 *     strength is NOT auto-completed even when a matching activity is
 *     imported
 *   - 429 rate-limit backoff: retries then succeeds
 *
 * Same mocking shape as `sync.test.ts` — Strava client + planner deps
 * are mocked, supabase is a hand-rolled chainable that captures the
 * calls we assert on.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { StravaActivity } from "../client";

const listActivitiesInRange = vi.fn();
const fetchActivitiesPage = vi.fn();
const refreshAccessToken = vi.fn();
const fetchActivityStreams = vi.fn(async () => null as unknown);
const recomputeRegionState = vi.fn(async () => ({ updated: 0, firstDate: null, lastDate: null }));

vi.mock("../client", async () => {
  const actual = await vi.importActual<typeof import("../client")>("../client");
  return {
    ...actual,
    listActivitiesInRange: (...args: unknown[]) =>
      (listActivitiesInRange as (...a: unknown[]) => unknown)(...args),
    fetchActivitiesPage: (...args: unknown[]) =>
      (fetchActivitiesPage as (...a: unknown[]) => unknown)(...args),
    refreshAccessToken: (...args: unknown[]) =>
      (refreshAccessToken as (...a: unknown[]) => unknown)(...args),
    fetchActivityStreams: (...args: unknown[]) =>
      (fetchActivityStreams as (...a: unknown[]) => unknown)(...args),
  };
});
vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: (...args: unknown[]) =>
    (recomputeRegionState as (...a: unknown[]) => unknown)(...args),
}));
vi.mock("@/lib/planner/queries", () => ({
  getUserTimezone: async () => "UTC",
  // Same simple implementation used by link-external-cardio.test.ts —
  // assumes startedOn is a Monday so the snap is a no-op.
  dayDate: (startedOn: string, weekIndex: number, dayIndex: number) => {
    const d = new Date(`${startedOn}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + weekIndex * 7 + dayIndex);
    return d.toISOString().slice(0, 10);
  },
}));

// Import AFTER mocks.
import {
  importStravaHistory,
  IMPORT_HISTORY_MAX_RANGE_DAYS,
} from "../import-history";
import { StravaRateLimitError } from "../client";

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

type SessionRow = { id: string; user_id: string; strava_activity_id: number };
type CardioRow = {
  id: string;
  session_id: string;
  strava_activity_id: string;
  modality: string;
  hr_zones?: Record<string, number> | null;
};

type PlannedSeed = {
  id: string;
  week_index: number;
  day_index: number;
  prescription: { items: Array<{ kind: string }> };
  completed_session_id: string | null;
  skipped_at: string | null;
  training_blocks: { started_on: string; user_id: string; deleted_at: string | null; status: string };
};

function makeSupabase(initial: {
  connection: {
    user_id: string;
    access_token: string;
    refresh_token: string;
    expires_at: string;
    last_synced_at: string | null;
  };
  planned?: PlannedSeed[];
}) {
  const state = {
    connection: { ...initial.connection, last_sync_error: null as string | null },
    sessions: [] as SessionRow[],
    cardio: [] as CardioRow[],
    planned: (initial.planned ?? []).map((p) => ({ ...p })),
    plannedUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
    cardioUpdates: [] as Array<{ id: string; patch: Record<string, unknown> }>,
  };
  let nextSessionId = 1;

  const from = (table: string) => {
    if (table === "strava_connections") return connectionTable();
    if (table === "sessions") return sessionsTable();
    if (table === "cardio_logs") return cardioTable();
    if (table === "planned_sessions") return plannedTable();
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
      delete: () => ({ eq: async () => ({ data: null, error: null }) }),
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
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, val: string) => {
          state.cardioUpdates.push({ id: val, patch });
          return { data: null, error: null };
        },
      }),
    };
  }

  function plannedTable() {
    // The link-external-cardio call from writeStravaActivity uses a
    // different shape (.eq().eq().eq().is()); we return an empty result
    // for that path so it's a no-op, then the import's autoLinkImported
    // call lands on this same table with a different chain that we
    // resolve to state.planned.
    return {
      select: () => {
        const filters: Array<{ kind: string; col?: string; val?: unknown }> = [];
        const chain = {
          eq(col: string, val: unknown) {
            filters.push({ kind: "eq", col, val });
            return chain;
          },
          is(col: string, val: unknown) {
            filters.push({ kind: "is", col, val });
            return chain;
          },
          gte(col: string, val: unknown) {
            filters.push({ kind: "gte", col, val });
            return chain;
          },
          lte(col: string, val: unknown) {
            filters.push({ kind: "lte", col, val });
            return chain;
          },
          then(resolve: (v: { data: unknown; error: null }) => void) {
            // autoLinkImported queries with user_id eq AND
            // training_blocks.user_id eq → return the planned rows
            // unfiltered, the function does its own per-activity match.
            // link-external-cardio uses .eq().eq().eq().is() on user_id,
            // training_blocks.user_id, training_blocks.cardio_source,
            // training_blocks.deleted_at — match that by checking for a
            // cardio_source filter.
            const isLinkExternalCall = filters.some(
              (f) => f.kind === "eq" && f.col === "training_blocks.cardio_source",
            );
            if (isLinkExternalCall) {
              resolve({ data: [], error: null });
            } else {
              resolve({
                data: state.planned.filter(
                  (p) => p.completed_session_id == null && p.skipped_at == null,
                ),
                error: null,
              });
            }
          },
        };
        return chain;
      },
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, val: string) => {
          state.plannedUpdates.push({ id: val, patch });
          const target = state.planned.find((p) => p.id === val);
          if (target) Object.assign(target, patch);
          return { data: null, error: null };
        },
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

  return { from, state };
}

const FRESH_CONN = {
  user_id: "u1",
  access_token: "tok",
  refresh_token: "ref",
  expires_at: new Date(Date.now() + 3_600_000).toISOString(),
  last_synced_at: null as string | null,
};

describe("importStravaHistory", () => {
  beforeEach(() => {
    listActivitiesInRange.mockReset();
    fetchActivitiesPage.mockReset();
    refreshAccessToken.mockReset();
    fetchActivityStreams.mockReset();
    fetchActivityStreams.mockResolvedValue(null);
    recomputeRegionState.mockReset();
    recomputeRegionState.mockResolvedValue({ updated: 0, firstDate: null, lastDate: null });
  });

  it("happy path: imports cardio, buckets skips, counts duplicates", async () => {
    listActivitiesInRange.mockResolvedValue([
      makeActivity({ id: 1, sport_type: "Run", type: "Run" }),
      makeActivity({ id: 2, sport_type: "Ride", type: "Ride" }),
      makeActivity({ id: 3, sport_type: "Swim", type: "Swim" }),
      makeActivity({ id: 4, sport_type: "WeightTraining", type: "WeightTraining" }),
      makeActivity({ id: 5, sport_type: "Yoga", type: "Yoga" }),
      makeActivity({ id: 6, sport_type: "Soccer", type: "Soccer" }),
      makeActivity({ id: 7, sport_type: "Snowboard", type: "Snowboard" }),
      makeActivity({ id: 8, sport_type: "Footvolley", type: "Footvolley" }), // unknown
      makeActivity({ id: 9, sport_type: "Run", type: "Run" }),
      makeActivity({ id: 10, sport_type: "Run", type: "Run" }),
    ]);
    const supa = makeSupabase({ connection: FRESH_CONN });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-04-20",
      endDate: "2026-05-20",
      autoLinkToPlanned: false,
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.summary.imported).toBe(5); // 1,2,3,9,10
    expect(result.summary.skipped.strength).toBe(2); // WeightTraining + Yoga
    expect(result.summary.skipped.sport).toBe(1); // Soccer
    expect(result.summary.skipped.other).toBe(1); // Snowboard
    expect(result.summary.skipped.unknown).toBe(1); // Footvolley
    expect(result.summary.skipped.duplicates).toBe(0);
    expect(result.summary.errors).toEqual([]);
    expect(supa.state.cardio).toHaveLength(5);
  });

  it("uses measured per-second HR-stream zones when available (not the summary approximation)", async () => {
    // A run whose avg HR (148) would dump almost everything into one
    // band under the summary leak model, but whose real stream spreads
    // time across Z2/Z3/Z4 — the bug Garmin exposed on the 12.6 run.
    listActivitiesInRange.mockResolvedValue([
      makeActivity({ id: 77, sport_type: "Run", type: "Run", average_heartrate: 148 }),
    ]);
    // hrMax 190 → zone bands; this stream sits 60s in Z2, 120s in Z3, 60s in Z4.
    fetchActivityStreams.mockResolvedValue({
      heartrate: [120, 150, 170],
      time: [0, 60, 180],
    });
    const supa = makeSupabase({ connection: FRESH_CONN });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-10",
      endDate: "2026-05-20",
      autoLinkToPlanned: false,
    });

    if (!result.ok) throw new Error(result.error);
    expect(fetchActivityStreams).toHaveBeenCalledWith(
      "tok",
      77,
      expect.anything(),
    );
    expect(supa.state.cardio).toHaveLength(1);
    const zones = supa.state.cardio[0]!.hr_zones as Record<string, number> | null;
    expect(zones).not.toBeNull();
    // Measured spread, not a single dominant band.
    const nonZero = Object.values(zones!).filter((s) => s > 0);
    expect(nonZero.length).toBeGreaterThanOrEqual(2);
  });

  it("falls back to the summary approximation when no HR stream is available", async () => {
    listActivitiesInRange.mockResolvedValue([
      makeActivity({ id: 78, sport_type: "Run", type: "Run", average_heartrate: 150 }),
    ]);
    fetchActivityStreams.mockResolvedValue(null);
    const supa = makeSupabase({ connection: FRESH_CONN });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-10",
      endDate: "2026-05-20",
      autoLinkToPlanned: false,
    });

    if (!result.ok) throw new Error(result.error);
    expect(supa.state.cardio).toHaveLength(1);
    // Still populated (approximation), just not from a stream.
    expect(supa.state.cardio[0]!.hr_zones).not.toBeNull();
  });

  it("counts duplicates separately from skips when activities re-import", async () => {
    listActivitiesInRange.mockResolvedValue([
      makeActivity({ id: 50, sport_type: "Run", type: "Run" }),
      makeActivity({ id: 50, sport_type: "Run", type: "Run" }), // same id → dup on 2nd insert
    ]);
    const supa = makeSupabase({ connection: FRESH_CONN });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-10",
      endDate: "2026-05-20",
      autoLinkToPlanned: false,
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.summary.imported).toBe(1);
    expect(result.summary.skipped.duplicates).toBe(1);
  });

  it("rejects ranges older than 365 days with a helpful message", async () => {
    const veryOld = new Date(
      Date.now() - (IMPORT_HISTORY_MAX_RANGE_DAYS + 30) * 86_400_000,
    ).toISOString();
    const supa = makeSupabase({ connection: FRESH_CONN });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: veryOld,
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected failure");
    expect(result.error).toMatch(/365 days/);
    expect(listActivitiesInRange).not.toHaveBeenCalled();
  });

  it("Zod strict: rejects unknown input fields", async () => {
    const supa = makeSupabase({ connection: FRESH_CONN });
    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-01",
      // @ts-expect-error -- testing runtime rejection
      bogus: true,
    });
    expect(result.ok).toBe(false);
    expect(listActivitiesInRange).not.toHaveBeenCalled();
  });

  it("auto-links imported cardio to a same-day planned cardio_external session", async () => {
    // Imported run on 2026-05-20.
    // Planned cardio block started Mon 2026-05-18 → week 0, day 2 = Wed 2026-05-20.
    listActivitiesInRange.mockResolvedValue([
      makeActivity({ id: 700, sport_type: "Run", type: "Run", start_date: "2026-05-20T07:00:00Z" }),
    ]);
    const supa = makeSupabase({
      connection: FRESH_CONN,
      planned: [
        {
          id: "plan-1",
          week_index: 0,
          day_index: 2,
          prescription: { items: [{ kind: "cardio_external" }] },
          completed_session_id: null,
          skipped_at: null,
          training_blocks: {
            started_on: "2026-05-18",
            user_id: "u1",
            deleted_at: null,
            status: "active",
          },
        },
      ],
    });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-15",
      endDate: "2026-05-21",
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.summary.imported).toBe(1);
    expect(result.summary.matchedToPlanned).toBe(1);
    expect(supa.state.plannedUpdates).toHaveLength(1);
    expect(supa.state.plannedUpdates[0]?.patch.completed_session_id).toMatch(/^sess-/);
  });

  it("hybrid completion guard (PR #208): links cardio but does NOT auto-complete a planned hybrid with prescribed strength", async () => {
    listActivitiesInRange.mockResolvedValue([
      makeActivity({ id: 800, sport_type: "Ride", type: "Ride", start_date: "2026-05-20T17:00:00Z" }),
    ]);
    const supa = makeSupabase({
      connection: FRESH_CONN,
      planned: [
        {
          id: "plan-hybrid",
          week_index: 0,
          day_index: 2,
          // Hybrid: strength (main) + cardio prescribed in same slot.
          prescription: {
            items: [{ kind: "main" }, { kind: "cardio_external" }],
          },
          completed_session_id: null,
          skipped_at: null,
          training_blocks: {
            started_on: "2026-05-18",
            user_id: "u1",
            deleted_at: null,
            status: "active",
          },
        },
      ],
    });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-15",
      endDate: "2026-05-21",
    });

    if (!result.ok) throw new Error(result.error);
    expect(result.summary.imported).toBe(1);
    // The cardio_log itself IS persisted so the user still has history.
    expect(supa.state.cardio).toHaveLength(1);
    // …but the hybrid guard prevents auto-completion of the planned slot.
    expect(supa.state.plannedUpdates).toEqual([]);
    expect(result.summary.matchedToPlanned).toBe(0);
  });

  it("rate-limit (429) propagated from the client surfaces as a graceful partial summary", async () => {
    listActivitiesInRange.mockRejectedValue(
      new StravaRateLimitError("Strava rate limit reached."),
    );
    const supa = makeSupabase({ connection: FRESH_CONN });

    const result = await importStravaHistory(supa as never, "u1", {
      startDate: "2026-05-10",
      endDate: "2026-05-20",
      autoLinkToPlanned: false,
    });

    if (!result.ok) throw new Error("expected ok=true with partial summary");
    expect(result.summary.imported).toBe(0);
    expect(result.summary.errors).toHaveLength(1);
    expect(result.summary.errors[0]?.message).toMatch(/rate limit/i);
  });
});

describe("fetchActivitiesPage 429 backoff", () => {
  it("retries on 429 then succeeds", async () => {
    // Use the real client with a fetch stub so we exercise the actual
    // retry/jitter loop.
    const realClient = await vi.importActual<typeof import("../client")>("../client");
    const fakeFetch = vi.fn();
    fakeFetch
      .mockResolvedValueOnce({ status: 429, ok: false, text: async () => "" })
      .mockResolvedValueOnce({ status: 429, ok: false, text: async () => "" })
      .mockResolvedValueOnce({ status: 200, ok: true, json: async () => [{ id: 1 }] });
    const originalFetch = global.fetch;
    global.fetch = fakeFetch as never;
    const sleep = vi.fn(async () => {});
    try {
      const batch = await realClient.fetchActivitiesPage(
        "tok",
        { afterEpoch: 1, beforeEpoch: 2, page: 1, perPage: 30 },
        { backoffBaseMs: 0, sleep, random: () => 0.5, maxRetries: 3 },
      );
      expect(batch).toEqual([{ id: 1 }]);
      expect(fakeFetch).toHaveBeenCalledTimes(3);
      expect(sleep).toHaveBeenCalledTimes(2);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("throws StravaRateLimitError after exhausting retries", async () => {
    const realClient = await vi.importActual<typeof import("../client")>("../client");
    const fakeFetch = vi.fn(async () => ({ status: 429, ok: false, text: async () => "" }));
    const originalFetch = global.fetch;
    global.fetch = fakeFetch as never;
    try {
      await expect(
        realClient.fetchActivitiesPage(
          "tok",
          { afterEpoch: 1, beforeEpoch: 2, page: 1, perPage: 30 },
          { backoffBaseMs: 0, sleep: async () => {}, random: () => 0.5, maxRetries: 2 },
        ),
      ).rejects.toBeInstanceOf(realClient.StravaRateLimitError);
    } finally {
      global.fetch = originalFetch;
    }
  });
});
