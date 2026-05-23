/**
 * Block-outcomes I/O wrapper tests — uses an in-memory fake
 * Supabase-shaped client to exercise the read functions without
 * standing up Postgres. The fake supports the narrow subset of the
 * Supabase PostgREST query builder we actually use in
 * `lib/stats/blocks.ts` (.select / .eq / .in / .gte / .lt / .is /
 * .not / .neq / .gt / .lte / .order / .limit / .maybeSingle), and
 * applies them against fixture tables keyed by table name.
 *
 * The goal is to pin the IT-side contract: which rows survive the
 * filters, which roles map to which movements, and how power-emphasis
 * gating works. The pure aggregator pieces have separate tests in
 * `blocks.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  compareBlocks,
  getBlockE1RMTrend,
  getBlockPowerOutcome,
} from "../blocks";
import { makeFakeSupabase, type Tables } from "./fake-supabase";

const TODAY = "2026-06-30";
const USER = "u1";

describe("getBlockE1RMTrend (I/O)", () => {
  it("returns one point per session, ignores soft-deleted sessions and non-target movements", async () => {
    const tables = baseTables();
    // Replace the active block with a fixture block.
    tables.training_blocks = [
      block({
        id: "blk-1",
        user_id: USER,
        archetype: "strength_anchor",
        started_on: "2026-06-01",
        weeks: 4,
        status: "active",
        days_per_week: 3,
        power_emphasis: false,
        deleted_at: null,
      }),
    ];
    // Planned sessions: one Squat main per week, all logged via
    // session ids sess-1..sess-4. Week 1 has a deleted session, which
    // means its set_logs should be skipped via the !inner join.
    tables.planned_sessions = [
      planned("ps-0", "blk-1", 0, 0, "Squat day", "squat", "mv-squat", "sess-1"),
      planned("ps-1", "blk-1", 1, 0, "Squat day", "squat", "mv-squat", "sess-deleted"),
      planned("ps-2", "blk-1", 2, 0, "Squat day", "squat", "mv-squat", "sess-2"),
      planned("ps-3", "blk-1", 3, 0, "Squat day", "squat", "mv-squat", "sess-3"),
    ];
    tables.sessions = [
      sess("sess-1", USER, "2026-06-01T10:00:00Z", null),
      sess("sess-deleted", USER, "2026-06-08T10:00:00Z", "2026-06-09T10:00:00Z"),
      sess("sess-2", USER, "2026-06-15T10:00:00Z", null),
      sess("sess-3", USER, "2026-06-22T10:00:00Z", null),
    ];
    tables.set_logs = [
      // Target movement, main sets.
      log("sess-1", "mv-squat", "main", 100, 5, null),
      log("sess-deleted", "mv-squat", "main", 105, 5, null),
      log("sess-2", "mv-squat", "main", 110, 5, null),
      log("sess-3", "mv-squat", "main", 115, 5, null),
      // Non-target movement.
      log("sess-1", "mv-other", "main", 200, 5, null),
      // Warmup on target movement — ignored.
      log("sess-1", "mv-squat", "warmup", 60, 5, null),
    ];

    const supabase = makeFakeSupabase(tables);
    const trend = await getBlockE1RMTrend(supabase, "blk-1", USER, "squat");
    // Should have 3 points (sess-1, sess-2, sess-3) — deleted session
    // is filtered out by the !inner deleted_at constraint.
    expect(trend.map((p) => p.weight)).toEqual([100, 110, 115]);
    expect(trend.map((p) => p.weekIndex)).toEqual([0, 2, 3]);
  });
});

describe("getBlockPowerOutcome", () => {
  it("returns null when the block does NOT have power_emphasis enabled", async () => {
    const tables = baseTables();
    tables.training_blocks = [
      block({
        id: "blk-no-power",
        user_id: USER,
        archetype: "strength_anchor",
        started_on: "2026-06-01",
        weeks: 4,
        status: "completed",
        days_per_week: 3,
        power_emphasis: false,
        deleted_at: null,
        ended_at: "2026-06-28T10:00:00Z",
      }),
    ];
    const supabase = makeFakeSupabase(tables);
    const r = await getBlockPowerOutcome(supabase, "blk-no-power", USER);
    expect(r).toBeNull();
  });

  it("returns the expected shape when power_emphasis = true", async () => {
    const tables = baseTables();
    tables.training_blocks = [
      block({
        id: "blk-power",
        user_id: USER,
        archetype: "strength_anchor",
        started_on: "2026-06-01",
        weeks: 4,
        status: "completed",
        days_per_week: 3,
        power_emphasis: true,
        deleted_at: null,
        ended_at: "2026-06-28T10:00:00Z",
      }),
    ];
    // Two accessory items: one power-tagged movement, one plain.
    tables.planned_sessions = [
      {
        ...planned("ps-1", "blk-power", 0, 0, "Squat day", "squat", "mv-squat", "sess-1"),
        prescription: {
          items: [
            { movementId: "mv-squat", kind: "main" },
            { movementId: "mv-jump", kind: "accessory" },
            { movementId: "mv-curl", kind: "accessory" },
          ],
        },
      },
    ];
    tables.sessions = [sess("sess-1", USER, "2026-06-01T10:00:00Z", null)];
    tables.set_logs = [
      log("sess-1", "mv-squat", "main", 100, 5, null),
      log("sess-1", "mv-jump", "accessory", 0, 5, null), // bodyweight power accessory
      log("sess-1", "mv-curl", "accessory", 15, 10, null),
    ];
    tables.movements = [
      { id: "mv-squat", slug: "back-squat", display_name: "Back Squat", functional_roles: ["squat_main"] },
      { id: "mv-jump", slug: "broad-jump", display_name: "Broad Jump", functional_roles: ["power_plyometric"] },
      { id: "mv-curl", slug: "curl", display_name: "Curl", functional_roles: [] },
    ];
    const supabase = makeFakeSupabase(tables);
    const r = await getBlockPowerOutcome(supabase, "blk-power", USER);
    expect(r).not.toBeNull();
    expect(r!.totalAccessoriesPrescribed).toBe(2);
    expect(r!.totalPowerAccessoriesPrescribed).toBe(1);
    // mv-jump weight=0 — counted as a performed set (it was logged)
    // but PR detection rejects weight <= 0, so no PR hits.
    expect(r!.totalPowerAccessoriesPerformed).toBe(1);
    // No prior history, no credible sets → empty PR set.
    expect(r!.powerPrSet).toEqual([]);
    expect(r!.comparisonBlock).toBeNull();
  });
});

describe("compareBlocks", () => {
  it("flags sameArchetype=false when the blocks have different archetypes", async () => {
    const tables = baseTables();
    tables.training_blocks = [
      block({
        id: "blk-A",
        user_id: USER,
        archetype: "strength_anchor",
        started_on: "2026-05-01",
        weeks: 4,
        status: "completed",
        days_per_week: 3,
        power_emphasis: false,
        deleted_at: null,
        ended_at: "2026-05-28T10:00:00Z",
      }),
      block({
        id: "blk-B",
        user_id: USER,
        archetype: "hypertrophy_anchor",
        started_on: "2026-06-01",
        weeks: 4,
        status: "active",
        days_per_week: 4,
        power_emphasis: false,
        deleted_at: null,
      }),
    ];
    const supabase = makeFakeSupabase(tables);
    const cmp = await compareBlocks(supabase, "blk-A", "blk-B", USER, TODAY);
    expect(cmp).not.toBeNull();
    expect(cmp!.sameArchetype).toBe(false);
    expect(cmp!.a.block.id).toBe("blk-A");
    expect(cmp!.b.block.id).toBe("blk-B");
  });

  it("returns null when one of the blocks is missing", async () => {
    const tables = baseTables();
    tables.training_blocks = [
      block({
        id: "blk-A",
        user_id: USER,
        archetype: "strength_anchor",
        started_on: "2026-05-01",
        weeks: 4,
        status: "completed",
        days_per_week: 3,
        power_emphasis: false,
        deleted_at: null,
      }),
    ];
    const supabase = makeFakeSupabase(tables);
    const cmp = await compareBlocks(supabase, "blk-A", "missing", USER, TODAY);
    expect(cmp).toBeNull();
  });
});

// ── fixture helpers ───────────────────────────────────────────────────

function baseTables(): Tables {
  return {
    training_blocks: [],
    planned_sessions: [],
    sessions: [],
    set_logs: [],
    movements: [],
    wellness: [],
    profiles: [],
  };
}

function block(b: Record<string, unknown>) {
  return {
    notes: null,
    ended_at: null,
    completed_at: null,
    archived_at: null,
    ...b,
  };
}

function planned(
  id: string,
  blockId: string,
  weekIndex: number,
  dayIndex: number,
  title: string,
  role: string,
  movementId: string,
  completedSessionId: string | null,
) {
  return {
    id,
    block_id: blockId,
    week_index: weekIndex,
    day_index: dayIndex,
    title,
    role,
    completed_session_id: completedSessionId,
    skipped_at: null,
    prescription: { items: [{ movementId, kind: "main" }] },
  };
}

function sess(id: string, userId: string, performedAt: string, deletedAt: string | null) {
  return {
    id,
    user_id: userId,
    performed_at: performedAt,
    deleted_at: deletedAt,
    fatigue: null,
    soreness: null,
  };
}

function log(
  sessionId: string,
  movementId: string,
  setKind: string,
  weight: number,
  reps: number,
  rpe: number | null,
) {
  return {
    session_id: sessionId,
    movement_id: movementId,
    set_kind: setKind,
    weight_kg: weight,
    reps,
    rpe,
  };
}
