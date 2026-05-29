/**
 * applyStravaAutofill server action — Fix 6 of the active-session UX
 * overhaul.
 *
 * Coverage:
 *   1. Happy path on a pure-cardio session — upserts at block_index=0,
 *      flips `sessions.completed_at`, copies modality / duration /
 *      distance / HR / RPE from the source Strava-imported row.
 *   2. Hybrid-completion guard — when the session has prescribed
 *      strength items but NO logged sets, the cardio_logs row still
 *      lands but `sessions.completed_at` is left null.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const CARDIO_LOG_ID = "00000000-0000-4000-8000-000000000020";

type SessionRow = {
  id: string;
  user_id: string;
  completed_at: string | null;
  deleted_at: string | null;
};

const sessions: SessionRow[] = [
  { id: SESSION_ID, user_id: USER_ID, completed_at: null, deleted_at: null },
];

const stravaSource = {
  id: CARDIO_LOG_ID,
  modality: "run",
  duration_sec: 2400,
  distance_km: 7.5,
  avg_hr_bpm: 152,
  max_hr_bpm: 178,
  avg_pace_sec_per_km: 320,
  rpe: 7,
  strava_activity_id: "stv-1234",
  external_source: "strava",
  sessions: { user_id: USER_ID, deleted_at: null },
};

const cardioUpserts: Array<{
  row: Record<string, unknown>;
  opts?: { onConflict?: string };
}> = [];
const sessionUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
const tableCounts: Record<string, number> = {
  session_items: 0,
  set_logs: 0,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const state: { eqs: Array<[string, unknown]>; isNull: string | null } = {
        eqs: [],
        isNull: null,
      };
      const builder: Record<string, unknown> = {};

      const select = (_cols: string, _opts?: { count?: string; head?: boolean }) =>
        builder;
      const eq = (col: string, val: unknown) => {
        state.eqs.push([col, val]);
        return builder;
      };
      const is = (col: string, _val: unknown) => {
        state.isNull = col;
        return builder;
      };
      const maybeSingle = async () => {
        if (table === "cardio_logs") {
          const id = state.eqs.find(([c]) => c === "id")?.[1];
          if (id === CARDIO_LOG_ID) {
            return { data: stravaSource, error: null };
          }
          return { data: null, error: null };
        }
        if (table === "sessions") {
          const id = state.eqs.find(([c]) => c === "id")?.[1];
          const row = sessions.find((s) => s.id === id) ?? null;
          return { data: row, error: null };
        }
        return { data: null, error: null };
      };

      const upsert = (
        row: Record<string, unknown>,
        opts?: { onConflict?: string },
      ) => {
        if (table === "cardio_logs") cardioUpserts.push({ row, opts });
        return {
          select: () => ({
            maybeSingle: async () => ({ data: { id: "new-id" }, error: null }),
          }),
        };
      };

      const update = (patch: Record<string, unknown>) => {
        return {
          eq: (col: string, val: unknown) => {
            if (table === "sessions" && col === "id") {
              sessionUpdates.push({ id: val as string, patch });
              const s = sessions.find((r) => r.id === val);
              if (s && patch.completed_at !== undefined) {
                s.completed_at = patch.completed_at as string | null;
              }
            }
            return Promise.resolve({ error: null });
          },
        };
      };

      Object.assign(builder, { select, eq, is, maybeSingle, upsert, update });

      // Resolve count() queries (`.select("id", { count: "exact", head: true })`)
      // by treating the builder as a thenable. Per-table counts come
      // from the shared map so tests can simulate hybrid state.
      (builder as { then?: unknown }).then = (
        resolve: (v: { count: number; error: null }) => unknown,
      ) => resolve({ count: tableCounts[table] ?? 0, error: null });

      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

describe("applyStravaAutofill (Fix 6)", () => {
  beforeEach(() => {
    cardioUpserts.length = 0;
    sessionUpdates.length = 0;
    sessions[0]!.completed_at = null;
    tableCounts.session_items = 0;
    tableCounts.set_logs = 0;
  });

  it("upserts a cardio_logs row at block_index=0 and flips completed_at on a pure-cardio session", async () => {
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("cardioLogId", CARDIO_LOG_ID);

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBe(true);

    expect(cardioUpserts).toHaveLength(1);
    const { row, opts } = cardioUpserts[0]!;
    expect(opts?.onConflict).toBe("session_id,block_index");
    expect(row.session_id).toBe(SESSION_ID);
    expect(row.block_index).toBe(0);
    expect(row.modality).toBe("run");
    expect(row.duration_sec).toBe(2400);
    expect(row.distance_km).toBe(7.5);
    expect(row.avg_hr_bpm).toBe(152);
    expect(row.strava_activity_id).toBe("stv-1234");
    expect(row.external_source).toBe("strava");
    expect(row.notes).toBe("Autofilled from Strava");

    const update = sessionUpdates.find((u) => u.id === SESSION_ID);
    expect(update).toBeDefined();
    expect(update!.patch.completed_at).toBeTypeOf("string");
    // duration in minutes inherited from duration_sec (rounded).
    expect(update!.patch.duration_min).toBe(40);
    expect(update!.patch.session_rpe).toBe(7);
  });

  it("does NOT flip completed_at when strength is prescribed but no sets are logged (hybrid guard)", async () => {
    tableCounts.session_items = 4;
    tableCounts.set_logs = 0;
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("cardioLogId", CARDIO_LOG_ID);

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBe(true);
    expect(cardioUpserts).toHaveLength(1);
    expect(sessionUpdates).toHaveLength(0);
    expect(sessions[0]!.completed_at).toBeNull();
  });

  it("DOES flip completed_at on a hybrid session once strength has at least one logged set", async () => {
    tableCounts.session_items = 4;
    tableCounts.set_logs = 2;
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("cardioLogId", CARDIO_LOG_ID);

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBe(true);
    expect(sessionUpdates).toHaveLength(1);
  });

  it("returns a structured error when validation fails", async () => {
    const { applyStravaAutofill } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", "not-a-uuid");
    fd.set("cardioLogId", "also-not-a-uuid");

    const res = await applyStravaAutofill(fd);
    expect(res.ok).toBeUndefined();
    expect(res.error).toBeTypeOf("string");
    expect(cardioUpserts).toHaveLength(0);
    expect(sessionUpdates).toHaveLength(0);
  });
});
