/**
 * Tests for `backfill-actual-session-load.ts`. The compute logic is
 * duplicated from `apps/web/src/lib/engine/actual-session-load.ts` for
 * the script-runtime reason documented at the top of the script; these
 * tests pin the duplicate to the same answers the canonical version
 * produces.
 */
import { describe, it, expect } from "vitest";
import {
  computeActualSessionLoad,
  runBackfill,
  type SetLogRow,
  type CardioLogRow,
} from "../backfill-actual-session-load";

describe("backfill-actual-session-load: computeActualSessionLoad", () => {
  it("pure strength: 5 main sets → ESL = 5 × 1.0, pure_strength", () => {
    const sets: SetLogRow[] = Array.from({ length: 5 }, () => ({
      movementId: "m",
      setKind: "main",
      isSkipped: false,
    }));
    const out = computeActualSessionLoad(sets, []);
    expect(out.sessionModality).toBe("pure_strength");
    expect(out.effectiveStressLoad).toBe(5);
    expect(out.hardSets).toBe(5);
  });

  it("filters warmups and skipped sets", () => {
    const sets: SetLogRow[] = [
      { movementId: "m", setKind: "warmup", isSkipped: false },
      { movementId: "m", setKind: "main", isSkipped: false },
      { movementId: "m", setKind: "main", isSkipped: true },
    ];
    const out = computeActualSessionLoad(sets, []);
    expect(out.hardSets).toBe(1);
  });

  it("cardio Z2 inferredKind → 0.5 × min", () => {
    const out = computeActualSessionLoad(
      [],
      [{ modality: "easy_z2", durationSec: 30 * 60, inferredKind: "cardio_z2" }],
    );
    expect(out.effectiveStressLoad).toBe(15);
    expect(out.sessionModality).toBe("pure_z2_aerobic");
  });

  it("cardio fallback (no inferred_kind) uses modality string heuristic", () => {
    const out = computeActualSessionLoad(
      [],
      [{ modality: "easy run", durationSec: 60 * 60, inferredKind: null }],
    );
    // mode = z2 (matched "easy"), 60 × 0.4 = 24
    expect(out.effectiveStressLoad).toBe(24);
  });

  it("mixed_modal: 5 main + 30 min Z2 reclassifies to mixed, strength uses 1.25", () => {
    const sets: SetLogRow[] = Array.from({ length: 5 }, () => ({
      movementId: "m",
      setKind: "main",
      isSkipped: false,
    }));
    const out = computeActualSessionLoad(sets, [
      { modality: "z2", durationSec: 30 * 60, inferredKind: "cardio_z2" },
    ]);
    expect(out.sessionModality).toBe("mixed_modal");
    expect(out.effectiveStressLoad).toBe(5 * 1.25 + 15);
  });
});

// ---- runBackfill orchestration ---------------------------------------

type FakeRow = {
  id: string;
  completed_session_id: string;
  effective_stress_load: number | null;
  session_modality: string | null;
};

function makeSupa(opts: {
  planned: FakeRow[];
  setsBySession: Record<
    string,
    Array<{ movement_id: string; set_kind: string; skipped: boolean | null }>
  >;
  cardioBySession?: Record<
    string,
    Array<{ modality: string | null; duration_sec: number; inferred_kind: string | null }>
  >;
}) {
  const updates: Array<{ id: string; patch: Record<string, unknown> }> = [];
  // Cursor pagination — return all rows in one page (length < 500).
  const supa = {
    from(table: string) {
      if (table === "planned_sessions") {
        return {
          select: () => ({
            not: () => ({
              gt: () => ({
                order: () => ({
                  limit: async () => ({ data: opts.planned, error: null }),
                }),
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              updates.push({ id, patch });
              return { data: null, error: null };
            },
          }),
        };
      }
      if (table === "set_logs") {
        return {
          select: () => ({
            eq: async (_c: string, sessionId: string) => ({
              data: opts.setsBySession[sessionId] ?? [],
              error: null,
            }),
          }),
        };
      }
      if (table === "cardio_logs") {
        return {
          select: () => ({
            eq: async (_c: string, sessionId: string) => ({
              data: (opts.cardioBySession ?? {})[sessionId] ?? [],
              error: null,
            }),
          }),
        };
      }
      throw new Error(`Unexpected table ${table}`);
    },
  };
  return { supa, updates };
}

describe("backfill-actual-session-load: runBackfill", () => {
  it("walks every linked planned_session and updates rows whose actual ESL differs", async () => {
    const { supa, updates } = makeSupa({
      planned: [
        // Will recompute to 5.0 (5 main sets, pure_strength). Currently 8 → UPDATE.
        {
          id: "p-1",
          completed_session_id: "s-1",
          effective_stress_load: 8,
          session_modality: "pure_strength",
        },
        // Already matches recomputed value → unchanged.
        {
          id: "p-2",
          completed_session_id: "s-2",
          effective_stress_load: 3,
          session_modality: "pure_strength",
        },
        // No logs → skipped (preserves prescribed).
        {
          id: "p-3",
          completed_session_id: "s-3",
          effective_stress_load: 10,
          session_modality: "pure_strength",
        },
      ],
      setsBySession: {
        "s-1": Array.from({ length: 5 }, () => ({
          movement_id: "m",
          set_kind: "main",
          skipped: false,
        })),
        "s-2": Array.from({ length: 3 }, () => ({
          movement_id: "m",
          set_kind: "main",
          skipped: false,
        })),
        "s-3": [],
      },
    });
    const stats = await runBackfill(supa as never, { logger: () => {} });
    expect(stats.scanned).toBe(3);
    expect(stats.updated).toBe(1);
    expect(stats.unchanged).toBe(1);
    expect(stats.skippedEmpty).toBe(1);
    expect(stats.failed).toBe(0);
    expect(updates).toHaveLength(1);
    expect(updates[0].id).toBe("p-1");
    expect(updates[0].patch.effective_stress_load).toBe(5);
    expect(updates[0].patch.session_modality).toBe("pure_strength");
  });

  it("idempotent — second pass yields zero further updates", async () => {
    const planned: FakeRow[] = [
      {
        id: "p-1",
        completed_session_id: "s-1",
        effective_stress_load: 5,
        session_modality: "pure_strength",
      },
    ];
    const { supa, updates } = makeSupa({
      planned,
      setsBySession: {
        "s-1": Array.from({ length: 5 }, () => ({
          movement_id: "m",
          set_kind: "main",
          skipped: false,
        })),
      },
    });
    const stats = await runBackfill(supa as never, { logger: () => {} });
    expect(stats.unchanged).toBe(1);
    expect(stats.updated).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
