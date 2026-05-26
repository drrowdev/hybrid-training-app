/**
 * Regression test for the perf-audit F5 fix in `getRecentPrs`.
 *
 * The previous implementation looped 30 deep and made one extra query
 * per PR hit (movement-slug lookup). After the fix the wrapper issues
 * a fixed 3 queries (sessions list + window set_logs + history
 * set_logs) regardless of how many sessions fit in the window.
 *
 * This test:
 *   1. Counts queries — should be exactly 3, never proportional to
 *      session count.
 *   2. Verifies hit count matches what the pure detector would
 *      produce for a fixture with 30+ sessions where the user is
 *      progressively setting weight PRs.
 *   3. Verifies that the slug join populated `movementSlug` (no extra
 *      .from("movements") round trip).
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRecentPrs } from "../pr-queries";

type Row = Record<string, unknown>;

// Build a fixture of 32 completed sessions, each containing one set
// of a single movement at progressively higher weight. Every session
// after the first should be a weight PR (and an e1RM PR).
const MOVEMENT_ID = "mov-bench";
const MOVEMENT_SLUG = "bench-press";
const MOVEMENT_NAME = "Bench Press";
const USER_ID = "user-1";

const SESSIONS: Row[] = [];
const SET_LOGS: Row[] = [];
const BASE_TIME = new Date("2026-01-01T10:00:00Z").getTime();
for (let i = 0; i < 32; i++) {
  const sid = `sess-${i}`;
  const performedAt = new Date(BASE_TIME + i * 86_400_000).toISOString();
  SESSIONS.push({
    id: sid,
    user_id: USER_ID,
    performed_at: performedAt,
    completed_at: performedAt,
    deleted_at: null,
  });
  SET_LOGS.push({
    id: `set-${i}`,
    session_id: sid,
    movement_id: MOVEMENT_ID,
    weight_kg: 100 + i, // strictly increasing → every set is a weight PR
    reps: 5,
    rpe: null,
    set_kind: "main",
    skipped: false,
  });
}

const MOVEMENTS: Row[] = [
  { id: MOVEMENT_ID, display_name: MOVEMENT_NAME, slug: MOVEMENT_SLUG },
];

type CallCounts = { sessions: number; setLogsWindow: number; setLogsHistory: number; movements: number };

function makeStub(counts: CallCounts): SupabaseClient {
  return {
    from(table: string) {
      if (table === "sessions") {
        counts.sessions++;
        // Sort SESSIONS newest-first, limit 30.
        const sorted = SESSIONS.slice().sort(
          (a, b) => Date.parse(b.performed_at as string) - Date.parse(a.performed_at as string),
        );
        const q = {
          select() { return q; },
          eq() { return q; },
          not() { return q; },
          is() { return q; },
          order() { return q; },
          limit(n: number) {
            return Promise.resolve({ data: sorted.slice(0, n), error: null });
          },
        };
        return q;
      }
      if (table === "set_logs") {
        // Distinguish window vs history by which filters are applied.
        // The window query uses `.in("session_id", ids)`; the history
        // query uses `.in("movement_id", ids)` and `.lt(...performed_at)`.
        let mode: "window" | "history" | null = null;
        let sessionIds: string[] = [];
        let movementIds: string[] = [];
        let oldest: string | null = null;
        const q = {
          select() { return q; },
          in(col: string, vals: unknown[]) {
            if (col === "session_id") { mode = "window"; sessionIds = vals as string[]; }
            if (col === "movement_id") { mode = "history"; movementIds = vals as string[]; }
            return q;
          },
          eq() { return q; },
          neq() { return q; },
          not() { return q; },
          gt() { return q; },
          is() { return q; },
          lt(_col: string, value: unknown) {
            oldest = value as string;
            return q;
          },
          then(onFulfilled: (v: { data: Row[]; error: null }) => unknown) {
            if (mode === "window") {
              counts.setLogsWindow++;
              const rows = SET_LOGS.filter((r) => sessionIds.includes(r.session_id as string)).map((r) => ({
                session_id: r.session_id,
                weight_kg: r.weight_kg,
                reps: r.reps,
                rpe: r.rpe,
                movement: MOVEMENTS.find((m) => m.id === r.movement_id) ?? null,
              }));
              return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
            }
            if (mode === "history") {
              counts.setLogsHistory++;
              // Only sets whose session.performed_at < oldest. With 30
              // sessions in the window, history covers session 0..1 (2
              // sessions older than the 30 newest of 32).
              const rows = SET_LOGS.filter((r) => {
                if (!movementIds.includes(r.movement_id as string)) return false;
                const sess = SESSIONS.find((s) => s.id === r.session_id);
                if (!sess) return false;
                return oldest != null && (sess.performed_at as string) < oldest;
              }).map((r) => {
                const sess = SESSIONS.find((s) => s.id === r.session_id)!;
                return {
                  movement_id: r.movement_id,
                  weight_kg: r.weight_kg,
                  reps: r.reps,
                  rpe: r.rpe,
                  sessions: { performed_at: sess.performed_at },
                };
              });
              return Promise.resolve({ data: rows, error: null }).then(onFulfilled);
            }
            return Promise.resolve({ data: [], error: null }).then(onFulfilled);
          },
        };
        return q;
      }
      if (table === "movements") {
        counts.movements++;
        const q = {
          select() { return q; },
          eq() { return q; },
          maybeSingle() {
            return Promise.resolve({ data: MOVEMENTS[0], error: null });
          },
        };
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("getRecentPrs", () => {
  it("returns `limit` PRs from a 32-session fixture using a fixed query count (audit F5 fix)", async () => {
    const counts: CallCounts = { sessions: 0, setLogsWindow: 0, setLogsHistory: 0, movements: 0 };
    const supabase = makeStub(counts);
    const result = await getRecentPrs(supabase, USER_ID, 12);

    // Every session in the window strictly raises the weight → at
    // least 12 weight PRs are emitted, the cap is honoured.
    expect(result).toHaveLength(12);

    // Slug + display_name come from the window join → no per-hit
    // movements lookup.
    for (const r of result) {
      expect(r.movementId).toBe(MOVEMENT_ID);
      expect(r.movementSlug).toBe(MOVEMENT_SLUG);
      expect(r.movementDisplayName).toBe(MOVEMENT_NAME);
      expect(r.hit.kind === "weight" || r.hit.kind === "e1rm").toBe(true);
    }

    // Newest-first ordering preserved.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1]!.sessionPerformedAt >= result[i]!.sessionPerformedAt).toBe(true);
    }

    // Fixed query count: 1 sessions list + 1 window set_logs + 1
    // history set_logs. No per-hit movements lookup.
    expect(counts.sessions).toBe(1);
    expect(counts.setLogsWindow).toBe(1);
    expect(counts.setLogsHistory).toBe(1);
    expect(counts.movements).toBe(0);
  });

  it("returns empty array when the user has no completed sessions", async () => {
    const empty: Row[] = [];
    const counts: CallCounts = { sessions: 0, setLogsWindow: 0, setLogsHistory: 0, movements: 0 };
    const supabase = {
      from(table: string) {
        if (table === "sessions") {
          counts.sessions++;
          const q = {
            select() { return q; },
            eq() { return q; },
            not() { return q; },
            is() { return q; },
            order() { return q; },
            limit() { return Promise.resolve({ data: empty, error: null }); },
          };
          return q;
        }
        throw new Error(`unexpected table ${table}`);
      },
    } as unknown as SupabaseClient;
    const result = await getRecentPrs(supabase, USER_ID);
    expect(result).toEqual([]);
    // Short-circuits before the window / history queries fire.
    expect(counts.setLogsWindow).toBe(0);
    expect(counts.setLogsHistory).toBe(0);
  });
});
