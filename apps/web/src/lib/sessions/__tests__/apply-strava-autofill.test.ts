/**
 * applyStravaAutofill server action — re-parent semantics (PR #311).
 *
 * "Use" on the Strava autofill banner RE-PARENTS the matched cardio_logs
 * row onto the in-progress session instead of copying it (a copy would
 * duplicate the globally-unique strava_activity_id). Coverage:
 *   1. Happy path on a pure-cardio session — moves the row to
 *      (session, block_index=0), soft-deletes the now-empty source import
 *      session, re-points any planned link, and flips completed_at.
 *   2. Hybrid-completion guard — strength prescribed but NO logged sets:
 *      the row still moves but completed_at is left null.
 *   3. Hybrid with >=1 logged set — completion flips.
 *   4. Validation failure — structured error, no writes.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const SOURCE_SESSION_ID = "00000000-0000-4000-8000-000000000030";
const CARDIO_LOG_ID = "00000000-0000-4000-8000-000000000020";

type SessionRow = {
  id: string;
  user_id: string;
  completed_at: string | null;
  deleted_at: string | null;
};

const target: SessionRow = {
  id: SESSION_ID,
  user_id: USER_ID,
  completed_at: null,
  deleted_at: null,
};

const stravaSource = {
  id: CARDIO_LOG_ID,
  session_id: SOURCE_SESSION_ID,
  modality: "run",
  duration_sec: 2400,
  distance_km: 7.5,
  avg_hr_bpm: 152,
  max_hr_bpm: 178,
  avg_pace_sec_per_km: 320,
  rpe: 7,
  notes: null as string | null,
  strava_activity_id: "stv-1234",
  external_source: "strava",
  sessions: { user_id: USER_ID, deleted_at: null },
};

type Write = { table: string; patch: Record<string, unknown>; eqs: Array<[string, unknown]> };

const cardioUpdates: Write[] = [];
const cardioDeletes: Array<{ eqs: Array<[string, unknown]>; neqs: Array<[string, unknown]> }> = [];
const sessionUpdates: Write[] = [];
const plannedUpdates: Write[] = [];

// Counts the action reads. `targetSetLogs` is the hybrid-guard count on the
// in-progress session; the orphan-retire check reads counts on the SOURCE
// session, which we always resolve to 0 (empty once the row moves).
const counts = { session_items: 0, targetSetLogs: 0 };

function eqVal(eqs: Array<[string, unknown]>, col: string) {
  return eqs.find(([c]) => c === col)?.[1];
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const st = {
        table,
        eqs: [] as Array<[string, unknown]>,
        neqs: [] as Array<[string, unknown]>,
        updatePatch: null as Record<string, unknown> | null,
        isDelete: false,
      };

      const resolveSingle = () => {
        if (table === "cardio_logs" && eqVal(st.eqs, "id") === CARDIO_LOG_ID) {
          return { data: stravaSource, error: null };
        }
        if (table === "sessions" && eqVal(st.eqs, "id") === SESSION_ID) {
          return { data: target, error: null };
        }
        return { data: null, error: null };
      };

      const resolveTerminal = () => {
        if (st.updatePatch) {
          const w: Write = { table, patch: st.updatePatch, eqs: st.eqs };
          if (table === "cardio_logs") cardioUpdates.push(w);
          else if (table === "sessions") sessionUpdates.push(w);
          else if (table === "planned_sessions") plannedUpdates.push(w);
          return { error: null };
        }
        if (st.isDelete) {
          if (table === "cardio_logs") cardioDeletes.push({ eqs: st.eqs, neqs: st.neqs });
          return { error: null };
        }
        // count query
        let count = 0;
        if (table === "session_items") count = counts.session_items;
        else if (table === "set_logs") {
          count = eqVal(st.eqs, "session_id") === SESSION_ID ? counts.targetSetLogs : 0;
        } else if (table === "cardio_logs") {
          count = 0; // orphan source has no cardio after the move
        }
        return { count, error: null };
      };

      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: (c: string, v: unknown) => {
          st.eqs.push([c, v]);
          return builder;
        },
        neq: (c: string, v: unknown) => {
          st.neqs.push([c, v]);
          return builder;
        },
        is: () => builder,
        order: () => builder,
        limit: () => builder,
        update: (patch: Record<string, unknown>) => {
          st.updatePatch = patch;
          return builder;
        },
        delete: () => {
          st.isDelete = true;
          return builder;
        },
        maybeSingle: async () => resolveSingle(),
        single: async () => resolveSingle(),
        then: (resolve: (v: unknown) => unknown) => resolve(resolveTerminal()),
      };
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

const flips = () => sessionUpdates.filter((u) => u.patch.completed_at !== undefined);
const softDeletes = () => sessionUpdates.filter((u) => u.patch.deleted_at !== undefined);

describe("applyStravaAutofill (re-parent)", () => {
  beforeEach(() => {
    cardioUpdates.length = 0;
    cardioDeletes.length = 0;
    sessionUpdates.length = 0;
    plannedUpdates.length = 0;
    target.completed_at = null;
    counts.session_items = 0;
    counts.targetSetLogs = 0;
  });

  it("re-parents the cardio row to (session, 0), retires the source session, and flips completed_at on a pure-cardio session", async () => {
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("cardioLogId", CARDIO_LOG_ID);

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBe(true);
    expect(res.cardioLogId).toBe(CARDIO_LOG_ID);

    // Re-parent: the SAME row is moved (update), not copied (no upsert).
    expect(cardioUpdates).toHaveLength(1);
    const move = cardioUpdates[0]!;
    expect(eqVal(move.eqs, "id")).toBe(CARDIO_LOG_ID);
    expect(move.patch.session_id).toBe(SESSION_ID);
    expect(move.patch.block_index).toBe(0);
    expect(move.patch.notes).toBe("Autofilled from Strava");

    // Target slot cleared first (so the move can't collide with the
    // (session_id, block_index) unique index).
    expect(cardioDeletes).toHaveLength(1);

    // The now-empty import session is soft-deleted, and any planned-session
    // completion link is re-pointed to this session.
    expect(softDeletes()).toHaveLength(1);
    expect(eqVal(softDeletes()[0]!.eqs, "id")).toBe(SOURCE_SESSION_ID);
    expect(plannedUpdates).toHaveLength(1);
    expect(plannedUpdates[0]!.patch.completed_session_id).toBe(SESSION_ID);

    // Completion flip (pure cardio -> no unlogged strength).
    expect(flips()).toHaveLength(1);
    expect(flips()[0]!.patch.duration_min).toBe(40);
    expect(flips()[0]!.patch.session_rpe).toBe(7);
  });

  it("does NOT flip completed_at when strength is prescribed but no sets are logged (hybrid guard)", async () => {
    counts.session_items = 4;
    counts.targetSetLogs = 0;
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("cardioLogId", CARDIO_LOG_ID);

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBe(true);
    // The row still moves…
    expect(cardioUpdates).toHaveLength(1);
    // …but no completion flip while strength is unlogged.
    expect(flips()).toHaveLength(0);
    expect(target.completed_at).toBeNull();
  });

  it("DOES flip completed_at on a hybrid session once strength has at least one logged set", async () => {
    counts.session_items = 4;
    counts.targetSetLogs = 2;
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("cardioLogId", CARDIO_LOG_ID);

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBe(true);
    expect(flips()).toHaveLength(1);
  });

  it("returns a structured error when validation fails", async () => {
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", "not-a-uuid");
    fd.set("cardioLogId", "also-not-a-uuid");

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBeUndefined();
    expect(res.error).toBeTypeOf("string");
    expect(cardioUpdates).toHaveLength(0);
    expect(sessionUpdates).toHaveLength(0);
  });
});
