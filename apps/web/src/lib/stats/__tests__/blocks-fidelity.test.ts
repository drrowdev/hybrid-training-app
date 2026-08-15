/**
 * ADR 0070 — block-level prescribed-vs-actual (B8), through the real read path.
 *
 * Uses the same in-memory fake Supabase client as `blocks-io.test.ts`. The pure
 * rollup is tested in `packages/domain`; these pin the I/O contract that matters
 * for the surface: which rows are read, and — critically — that a block with no
 * snapshots reports NOTHING rather than perfect adherence.
 */
import { describe, it, expect } from "vitest";
import { getBlockSummary } from "../blocks";
import { makeFakeSupabase, type Tables } from "./fake-supabase";

const TODAY = "2026-06-30";
const USER = "u1";

describe("getBlockSummary — prescription fidelity (B8)", () => {
  it("is null for a block whose sets predate the snapshot (no false adherence)", async () => {
    const tables = withBlock([
      legacyLog("sess-1", 100, 5),
      legacyLog("sess-1", 100, 5),
    ]);
    const summary = await getBlockSummary(makeFakeSupabase(tables), "blk-1", USER, TODAY);
    expect(summary?.fidelity).toBeNull();
  });

  it("reports on-plan when logged work matched the prescription", async () => {
    const tables = withBlock([
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
    ]);
    const summary = await getBlockSummary(makeFakeSupabase(tables), "blk-1", USER, TODAY);
    expect(summary?.fidelity?.verdict).toBe("on-plan");
    expect(summary?.fidelity?.comparableSets).toBe(2);
  });

  it("reports eased when the lifter pulled load back", async () => {
    const tables = withBlock([
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      snapLog("sess-1", 85, 5, { targetWeight: 100, targetReps: 5 }),
    ]);
    const summary = await getBlockSummary(makeFakeSupabase(tables), "blk-1", USER, TODAY);
    expect(summary?.fidelity?.verdict).toBe("eased");
    expect(summary?.fidelity?.easedSets).toBe(1);
  });

  it("excludes warm-ups from the comparison", async () => {
    const tables = withBlock([
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      snapLog("sess-1", 40, 5, { targetWeight: 100, targetReps: 5, setKind: "warmup" }),
    ]);
    const summary = await getBlockSummary(makeFakeSupabase(tables), "blk-1", USER, TODAY);
    // The warm-up would otherwise register as a huge shortfall.
    expect(summary?.fidelity?.comparableSets).toBe(1);
    expect(summary?.fidelity?.verdict).toBe("on-plan");
  });

  it("TB: declining optional sets does not read as a shortfall", async () => {
    const tables = withBlock([
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      snapLog("sess-1", 0, 0, {
        targetWeight: 100,
        targetReps: 5,
        skipped: true,
        optional: true,
      }),
    ]);
    const summary = await getBlockSummary(makeFakeSupabase(tables), "blk-1", USER, TODAY);
    expect(summary?.fidelity?.verdict).toBe("on-plan");
    expect(summary?.fidelity?.skippedOptional).toBe(1);
    expect(summary?.fidelity?.skippedRequired).toBe(0);
  });

  it("counts un-snapshotted sets separately so a partial picture is visible", async () => {
    const tables = withBlock([
      snapLog("sess-1", 100, 5, { targetWeight: 100, targetReps: 5 }),
      legacyLog("sess-1", 100, 5),
    ]);
    const summary = await getBlockSummary(makeFakeSupabase(tables), "blk-1", USER, TODAY);
    expect(summary?.fidelity?.comparableSets).toBe(1);
    expect(summary?.fidelity?.unknownSets).toBe(1);
  });
});

// ── fixtures ──────────────────────────────────────────────────────────

function withBlock(setLogs: Array<Record<string, unknown>>): Tables {
  return {
    training_blocks: [
      {
        id: "blk-1",
        user_id: USER,
        archetype: "strength_anchor",
        started_on: "2026-06-01",
        weeks: 4,
        status: "active",
        days_per_week: 3,
        power_emphasis: false,
        deleted_at: null,
        notes: null,
        ended_at: null,
        completed_at: null,
        archived_at: null,
      },
    ],
    planned_sessions: [
      {
        id: "ps-0",
        block_id: "blk-1",
        week_index: 0,
        day_index: 0,
        title: "Squat day",
        role: "squat",
        completed_session_id: "sess-1",
        skipped_at: null,
        prescription: { items: [{ movementId: "mv-squat", kind: "main" }] },
      },
    ],
    sessions: [
      {
        id: "sess-1",
        user_id: USER,
        performed_at: "2026-06-01T10:00:00Z",
        deleted_at: null,
        fatigue: null,
        soreness: null,
      },
    ],
    set_logs: setLogs,
    movements: [],
    wellness: [],
    profiles: [],
  };
}

/** A set logged before migration 0128 — no snapshot columns populated. */
function legacyLog(sessionId: string, weight: number, reps: number) {
  return {
    session_id: sessionId,
    movement_id: "mv-squat",
    set_kind: "main",
    weight_kg: weight,
    reps,
    rpe: null,
    skipped: false,
    target_weight_kg: null,
    target_reps: null,
    prescribed: null,
  };
}

function snapLog(
  sessionId: string,
  weight: number,
  reps: number,
  opts: {
    targetWeight: number;
    targetReps: number;
    skipped?: boolean;
    optional?: boolean;
    setKind?: string;
  },
) {
  return {
    session_id: sessionId,
    movement_id: "mv-squat",
    set_kind: opts.setKind ?? "main",
    weight_kg: weight,
    reps,
    rpe: null,
    skipped: opts.skipped ?? false,
    target_weight_kg: opts.targetWeight,
    target_reps: opts.targetReps,
    prescribed: opts.optional ? { optional: true } : {},
  };
}
