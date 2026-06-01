/**
 * Server-action: `startSessionDirect`.
 *
 * The pre-workout fatigue + soreness interstitial was removed. The
 * `/app/sessions/start/[plannedId]` URL is now a thin Server
 * Component that invokes `startSessionDirect(plannedId)` and lets it
 * `redirect()` to the materialised session.
 *
 * These tests pin the contract:
 *   1. Inserts a `sessions` row carrying the planned title / slot /
 *      planned_at — and crucially does NOT write `fatigue` or
 *      `soreness` (the pre-session interstitial was retired, and the
 *      follow-up Today-page wellness card has since also been retired
 *      — see chore/retire-wellness-checkin; the `wellness` table
 *      remains for future use).
 *   2. Updates the matching `planned_sessions.completed_session_id`
 *      so the plan calendar flips to "in progress".
 *   3. Redirects to `/app/sessions/<new-id>`.
 *   4. Idempotent re-entry: when the planned row already links to a
 *      session, no new INSERT runs and we redirect to the existing
 *      session id.
 *   5. Refuses to act on someone else's planned session.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type SessionInsert = Record<string, unknown>;
type PlannedRow = {
  id: string;
  title: string;
  slot: string | null;
  planned_at: string | null;
  prescription: unknown;
  completed_session_id: string | null;
  user_id: string;
};

type State = {
  planned: PlannedRow | null;
  sessionInsertCalls: SessionInsert[];
  sessionInsertResult: { id: string };
  plannedUpdateCalls: Array<{ payload: Record<string, unknown>; id: string }>;
  /**
   * Controls the outcome of the conditional link UPDATE. When `winner`
   * is null the link succeeded (this caller is the winner); when set
   * to a string, the UPDATE affected 0 rows (race lost) and the
   * follow-up SELECT returns that completed_session_id.
   */
  linkRaceWinner: string | null;
  /** How many times the planned_sessions SELECT has been called. */
  plannedSelectCalls: number;
  sessionDeleteCalls: string[];
  redirected: string | null;
  revalidated: string[];
  /** User's IANA timezone returned by the profiles select. */
  tz: string;
  /** Fake "now" used by the action to decide future / past bounds. */
  fakeNow: Date | null;
};

const state: State = {
  planned: null,
  sessionInsertCalls: [],
  sessionInsertResult: { id: "new-session-uuid" },
  plannedUpdateCalls: [],
  linkRaceWinner: null,
  plannedSelectCalls: 0,
  sessionDeleteCalls: [],
  redirected: null,
  revalidated: [],
  tz: "UTC",
  fakeNow: null,
};

class RedirectError extends Error {
  constructor(public target: string) {
    super(`redirect to ${target}`);
  }
}

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    state.revalidated.push(p);
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    state.redirected = path;
    throw new RedirectError(path);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "profiles") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () => Promise.resolve({ data: { timezone: state.tz }, error: null }),
            }),
          }),
        };
      }
      if (table === "planned_sessions") {
        return {
          select: (_cols?: string) => ({
            eq: (_col: string, _val: string) => ({
              maybeSingle: () => {
                state.plannedSelectCalls += 1;
                // First select = the initial fetch in startSessionDirect.
                // Always returns the row as the user sees it (still
                // unlinked). Subsequent selects happen only after a
                // lost race, and should report the winner.
                if (state.plannedSelectCalls > 1 && state.linkRaceWinner) {
                  return Promise.resolve({
                    data: { completed_session_id: state.linkRaceWinner },
                    error: null,
                  });
                }
                return Promise.resolve({ data: state.planned, error: null });
              },
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: (_col: string, val: string) => {
              state.plannedUpdateCalls.push({ payload, id: val });
              // The action now chains `.is("completed_session_id", null)`
              // followed by `.select(...).maybeSingle()`. When the race
              // is lost, the chained select resolves to `data: null`
              // (UPDATE affected 0 rows).
              const builder = {
                is: (_col: string, _v: null) => ({
                  select: (_cols?: string) => ({
                    maybeSingle: () =>
                      Promise.resolve({
                        data: state.linkRaceWinner
                          ? null
                          : { id: val, completed_session_id: state.sessionInsertResult.id },
                        error: null,
                      }),
                  }),
                }),
              };
              return builder;
            },
          }),
        };
      }
      if (table === "sessions") {
        return {
          insert: (payload: SessionInsert) => {
            state.sessionInsertCalls.push(payload);
            return {
              select: () => ({
                single: () =>
                  Promise.resolve({ data: state.sessionInsertResult, error: null }),
              }),
            };
          },
          delete: () => ({
            eq: (_col: string, val: string) => {
              state.sessionDeleteCalls.push(val);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
}));

// Import AFTER mocks so the action picks up the stubbed supabase.
import { startSessionDirect } from "../actions";

const VALID_UUID = "11111111-1111-1111-1111-111111111111";

beforeEach(() => {
  state.planned = null;
  state.sessionInsertCalls = [];
  state.sessionInsertResult = { id: "new-session-uuid" };
  state.plannedUpdateCalls = [];
  state.linkRaceWinner = null;
  state.plannedSelectCalls = 0;
  state.sessionDeleteCalls = [];
  state.redirected = null;
  state.revalidated = [];
  state.tz = "UTC";
  if (state.fakeNow) {
    vi.setSystemTime(state.fakeNow);
  } else {
    vi.useRealTimers();
  }
});

describe("startSessionDirect — no pre-workout check-in", () => {
  it("inserts a sessions row WITHOUT fatigue/soreness and redirects to the log", async () => {
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: "2026-05-18T07:00:00Z",
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };

    await expect(startSessionDirect(VALID_UUID)).rejects.toBeInstanceOf(
      RedirectError,
    );

    expect(state.sessionInsertCalls).toHaveLength(1);
    const insert = state.sessionInsertCalls[0]!;
    expect(insert).toMatchObject({
      user_id: "user-1",
      title: "Upper push",
      slot: "single",
      planned_at: "2026-05-18T07:00:00Z",
    });
    // The whole point of removing the interstitial: no fatigue / soreness
    // / notes on the inserted sessions row.
    expect("fatigue" in insert).toBe(false);
    expect("soreness" in insert).toBe(false);
    expect("notes" in insert).toBe(false);

    // The planned_session is linked to the new session id.
    expect(state.plannedUpdateCalls).toEqual([
      { payload: { completed_session_id: "new-session-uuid" }, id: VALID_UUID },
    ]);

    // Redirect target is the session log.
    expect(state.redirected).toBe("/app/sessions/new-session-uuid");

    // Both Today and Plan are revalidated so the CTAs flip.
    expect(state.revalidated).toEqual(
      expect.arrayContaining(["/app", "/app/plan"]),
    );
  });

  it("skips revalidatePath when skipRevalidate is set (render-time caller)", async () => {
    // The /app/sessions/start/[plannedId] page invokes this action during
    // render. Next 16 makes revalidatePath-during-render a hard throw, so
    // the page passes { skipRevalidate: true }. The insert + link + redirect
    // must still happen; only the revalidation is suppressed. /app and
    // /app/plan are cookie-dynamic (staleTimes.dynamic=0) so the started
    // state still shows on the next navigation.
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: "2026-05-18T07:00:00Z",
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };

    await expect(
      startSessionDirect(VALID_UUID, { skipRevalidate: true }),
    ).rejects.toBeInstanceOf(RedirectError);

    // Side effects still happen: row inserted, planned linked, redirect fired.
    expect(state.sessionInsertCalls).toHaveLength(1);
    expect(state.plannedUpdateCalls).toEqual([
      { payload: { completed_session_id: "new-session-uuid" }, id: VALID_UUID },
    ]);
    expect(state.redirected).toBe("/app/sessions/new-session-uuid");

    // But NO revalidatePath calls — that is what would crash during render.
    expect(state.revalidated).toEqual([]);
  });

  it("is idempotent: redirects to the already-linked session without re-inserting", async () => {
    state.planned = {
      id: VALID_UUID,
      title: "Lower pull",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: "existing-session-id",
      user_id: "user-1",
    };

    await expect(startSessionDirect(VALID_UUID)).rejects.toBeInstanceOf(
      RedirectError,
    );

    expect(state.sessionInsertCalls).toHaveLength(0);
    expect(state.plannedUpdateCalls).toHaveLength(0);
    expect(state.redirected).toBe("/app/sessions/existing-session-id");
  });

  it("refuses to act on a planned session owned by another user", async () => {
    state.planned = {
      id: VALID_UUID,
      title: "Stolen",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "someone-else",
    };

    await expect(startSessionDirect(VALID_UUID)).rejects.toThrow(
      /not found/i,
    );
    expect(state.sessionInsertCalls).toHaveLength(0);
  });

  it("rejects an invalid plannedId", async () => {
    await expect(startSessionDirect("not-a-uuid")).rejects.toThrow(
      /invalid planned session id/i,
    );
    expect(state.sessionInsertCalls).toHaveLength(0);
  });

  it("concurrent-tap race: loser deletes its orphan and redirects to the winner", async () => {
    // Regression for PR #173 review: middle-click or rapid double-tap
    // on ``Log now'' bypasses the client-side one-tap lock. With the old
    // unconditional UPDATE both calls would silently insert a session
    // and the second would overwrite the planned_sessions link, leaving
    // the first session orphaned. The conditional UPDATE + cleanup path
    // catches this.
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    state.linkRaceWinner = "winner-session-id";

    await expect(startSessionDirect(VALID_UUID)).rejects.toBeInstanceOf(
      RedirectError,
    );

    // The orphaned session was created then deleted.
    expect(state.sessionInsertCalls).toHaveLength(1);
    expect(state.sessionDeleteCalls).toEqual(["new-session-uuid"]);

    // We tried to link but the conditional UPDATE was a no-op.
    expect(state.plannedUpdateCalls).toHaveLength(1);

    // Redirect target is the winner's session, not ours.
    expect(state.redirected).toBe("/app/sessions/winner-session-id");
  });
});

describe("startSessionDirect — retroactive performedAt", () => {
  beforeEach(() => {
    // Anchor "now" so future-date validation is deterministic.
    // 2026-05-23 12:00 UTC = Saturday.
    state.fakeNow = new Date("2026-05-23T12:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(state.fakeNow);
  });

  it("stamps performed_at at start-of-day in user tz when a valid date is provided", async () => {
    state.tz = "Europe/Helsinki"; // UTC+3 in May (EEST).
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };

    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "2026-05-20" }),
    ).rejects.toBeInstanceOf(RedirectError);

    expect(state.sessionInsertCalls).toHaveLength(1);
    const insert = state.sessionInsertCalls[0]! as { performed_at?: string };
    // 2026-05-20 00:00 EEST (UTC+3) = 2026-05-19T21:00:00Z.
    expect(insert.performed_at).toBe("2026-05-19T21:00:00.000Z");
  });

  it("falls back to NOW() (omits performed_at) when not provided", async () => {
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };

    await expect(startSessionDirect(VALID_UUID)).rejects.toBeInstanceOf(
      RedirectError,
    );

    const insert = state.sessionInsertCalls[0]!;
    expect("performed_at" in insert).toBe(false);
  });

  it("rejects a future performed_at (user tz)", async () => {
    state.tz = "UTC";
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    // today (UTC) = 2026-05-23. Pick a future day.
    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "2026-05-24" }),
    ).rejects.toThrow(/cannot be in the future/i);
    expect(state.sessionInsertCalls).toHaveLength(0);
  });

  it("rejects performed_at more than 14 days in the past", async () => {
    state.tz = "UTC";
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    // today (UTC) = 2026-05-23. 15 days back = 2026-05-08.
    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "2026-05-08" }),
    ).rejects.toThrow(/14 days/);
    expect(state.sessionInsertCalls).toHaveLength(0);
  });

  it("accepts exactly 14 days in the past (boundary)", async () => {
    state.tz = "UTC";
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "2026-05-09" }),
    ).rejects.toBeInstanceOf(RedirectError);
    expect(state.sessionInsertCalls).toHaveLength(1);
  });

  it("rejects an invalid performed_at format", async () => {
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "not-a-date" }),
    ).rejects.toThrow(/invalid performed_at/i);
    expect(state.sessionInsertCalls).toHaveLength(0);
  });

  it("rejects a structurally valid but non-existent date (Feb 30)", async () => {
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "2026-02-30" }),
    ).rejects.toThrow(/invalid performed_at/i);
    expect(state.sessionInsertCalls).toHaveLength(0);
  });

  it("still races correctly when performedAt is provided", async () => {
    state.tz = "UTC";
    state.planned = {
      id: VALID_UUID,
      title: "Upper push",
      slot: "single",
      planned_at: null,
      prescription: null,
      completed_session_id: null,
      user_id: "user-1",
    };
    state.linkRaceWinner = "winner-session-id";

    await expect(
      startSessionDirect(VALID_UUID, { performedAt: "2026-05-22" }),
    ).rejects.toBeInstanceOf(RedirectError);

    expect(state.sessionInsertCalls).toHaveLength(1);
    expect(state.sessionDeleteCalls).toEqual(["new-session-uuid"]);
    expect(state.redirected).toBe("/app/sessions/winner-session-id");
  });
});
