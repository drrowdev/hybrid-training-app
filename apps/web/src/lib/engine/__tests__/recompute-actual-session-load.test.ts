/**
 * Integration coverage for `recomputeActualSessionLoad` — Finding 1
 * fix's DB-write side. Pattern mirrors
 * `integrations/strava/__tests__/link-external-cardio.test.ts`:
 * hand-rolled chainable supabase mock that captures the planned_sessions
 * UPDATE call.
 */
import { describe, it, expect } from "vitest";
import { recomputeActualSessionLoad } from "../recompute-actual-session-load";
import { MODALITY_STRESS_MULTIPLIER } from "@/lib/planner/session-modality";

type Capture = {
  plannedUpdates: Array<{ id: string; patch: Record<string, unknown> }>;
};

function makeSupa(opts: {
  session: { id: string; completed_at: string | null; user_id?: string } | null;
  planned: { id: string; session_modality: string | null } | null;
  setLogs: Array<{
    movement_id: string;
    set_kind: string;
    weight_kg: number | null;
    reps: number | null;
    rpe: number | null;
    skipped: boolean | null;
  }>;
  cardioLogs: Array<{
    movement_id: string | null;
    modality: string | null;
    duration_sec: number;
    inferred_kind: string | null;
  }>;
}) {
  const capture: Capture = { plannedUpdates: [] };
  // Default user_id so tests that omit it still authorise.
  const sessionWithUser = opts.session
    ? { user_id: "u1", ...opts.session }
    : null;
  const supa = {
    from(table: string) {
      if (table === "sessions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: sessionWithUser, error: null }),
            }),
          }),
        };
      }
      if (table === "planned_sessions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: opts.planned, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => {
            // Chainable .eq() returning the same object so the
            // production code's `.eq("id", ...).eq("user_id", ...)` lands.
            const chain = {
              eq(_col: string, id: string) {
                if (_col === "id") {
                  capture.plannedUpdates.push({ id, patch });
                }
                return chain;
              },
              then(resolve: (v: unknown) => unknown) {
                return resolve({ data: null, error: null });
              },
            };
            return chain;
          },
        };
      }
      if (table === "set_logs") {
        return {
          select: () => ({
            eq: async () => ({ data: opts.setLogs, error: null }),
          }),
        };
      }
      if (table === "cardio_logs") {
        return {
          select: () => ({
            eq: async () => ({ data: opts.cardioLogs, error: null }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return { supa, capture };
}

describe("recomputeActualSessionLoad — integration", () => {
  it("updates planned_sessions.effective_stress_load after completion", async () => {
    const { supa, capture } = makeSupa({
      session: { id: "s1", completed_at: "2026-05-21T18:00:00Z" },
      planned: { id: "p1", session_modality: "pure_strength" },
      setLogs: Array.from({ length: 4 }, (_, i) => ({
        movement_id: "m-1",
        set_kind: "main",
        weight_kg: 100,
        reps: 5,
        rpe: 8,
        skipped: false,
      })),
      cardioLogs: [],
    });
    await recomputeActualSessionLoad({
      supabase: supa as never,
      sessionId: "s1",
      requireCompleted: false,
    });
    expect(capture.plannedUpdates).toHaveLength(1);
    expect(capture.plannedUpdates[0].id).toBe("p1");
    expect(capture.plannedUpdates[0].patch.effective_stress_load).toBe(
      4 * MODALITY_STRESS_MULTIPLIER.pure_strength,
    );
    expect(capture.plannedUpdates[0].patch.session_modality).toBe("pure_strength");
  });

  it("skips the write when both set_logs and cardio_logs are empty (preserves prescribed ESL)", async () => {
    const { supa, capture } = makeSupa({
      session: { id: "s1", completed_at: "2026-05-21T18:00:00Z" },
      planned: { id: "p1", session_modality: "pure_strength" },
      setLogs: [],
      cardioLogs: [],
    });
    await recomputeActualSessionLoad({
      supabase: supa as never,
      sessionId: "s1",
      requireCompleted: false,
    });
    expect(capture.plannedUpdates).toHaveLength(0);
  });

  it("no-ops when requireCompleted=true and the session is not yet completed", async () => {
    const { supa, capture } = makeSupa({
      session: { id: "s1", completed_at: null },
      planned: { id: "p1", session_modality: "pure_strength" },
      setLogs: [
        {
          movement_id: "m",
          set_kind: "main",
          weight_kg: 100,
          reps: 5,
          rpe: 8,
          skipped: false,
        },
      ],
      cardioLogs: [],
    });
    await recomputeActualSessionLoad({ supabase: supa as never, sessionId: "s1" });
    expect(capture.plannedUpdates).toHaveLength(0);
  });

  it("no-ops when no planned_session is linked", async () => {
    const { supa, capture } = makeSupa({
      session: { id: "s1", completed_at: "2026-05-21T18:00:00Z" },
      planned: null,
      setLogs: [
        {
          movement_id: "m",
          set_kind: "main",
          weight_kg: 100,
          reps: 5,
          rpe: 8,
          skipped: false,
        },
      ],
      cardioLogs: [],
    });
    await recomputeActualSessionLoad({
      supabase: supa as never,
      sessionId: "s1",
      requireCompleted: false,
    });
    expect(capture.plannedUpdates).toHaveLength(0);
  });
});
