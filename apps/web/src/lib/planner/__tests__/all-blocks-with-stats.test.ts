/**
 * getAllBlocksWithCompletionStats — completion ratio derivation.
 *
 * The query joins training_blocks with planned_sessions and derives
 * loggedSessions / skippedSessions counts so the /app/plan/history
 * page can render "12 of 16 sessions logged" without per-row fan-out.
 * This test pins the derivation so a future query refactor can't
 * silently mis-count completions.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const builder: Record<string, unknown> = {};
    const query = {
      select: vi.fn().mockReturnValue(builder),
      eq: vi.fn().mockReturnValue(builder),
      order: vi.fn().mockReturnValue(builder),
      range: vi.fn().mockResolvedValue({
        data: [
          {
            id: "b-active",
            archetype: "strength_anchor",
            started_on: "2026-05-10",
            updated_at: "2026-05-15T00:00:00Z",
            ended_at: null,
            weeks: 4,
            days_per_week: 4,
            status: "active",
            day_index_overrides: { days: [0, 2, 4, 6], twoADay: false },
            notes: null,
            planned_sessions: [
              { id: "p1", completed_session_id: "s1", skipped_at: null, week_index: 0, day_index: 0 },
              { id: "p2", completed_session_id: "s2", skipped_at: null, week_index: 0, day_index: 2 },
              { id: "p3", completed_session_id: null, skipped_at: "2026-05-12", week_index: 0, day_index: 4 },
              { id: "p4", completed_session_id: null, skipped_at: null, week_index: 0, day_index: 6 },
            ],
          },
          {
            id: "b-done",
            archetype: "endurance_anchor",
            started_on: "2026-03-01",
            updated_at: "2026-04-01T00:00:00Z",
            ended_at: "2026-03-28T12:00:00Z",
            weeks: 4,
            // legacy null — derived from planned_sessions week 0
            days_per_week: null,
            status: "completed",
            day_index_overrides: null,
            notes: null,
            planned_sessions: [
              { id: "q1", completed_session_id: "s10", skipped_at: null, week_index: 0, day_index: 1 },
              { id: "q2", completed_session_id: "s11", skipped_at: null, week_index: 0, day_index: 3 },
              { id: "q3", completed_session_id: "s12", skipped_at: null, week_index: 0, day_index: 5 },
              { id: "q4", completed_session_id: "s13", skipped_at: null, week_index: 1, day_index: 1 },
            ],
          },
          {
            id: "b-custom",
            archetype: "custom",
            started_on: "2026-01-01",
            updated_at: "2026-01-20T00:00:00Z",
            ended_at: null,
            weeks: 2,
            days_per_week: 2,
            status: "archived",
            day_index_overrides: null,
            notes: "Push/Pull split",
            planned_sessions: [],
          },
        ],
      }),
    };
    Object.assign(builder, query);
    return {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => query),
    };
  },
}));

describe("getAllBlocksWithCompletionStats", () => {
  it("derives loggedSessions / skippedSessions / totalSessions per block", async () => {
    const { getAllBlocksWithCompletionStats } = await import("../queries");
    const rows = await getAllBlocksWithCompletionStats({ limit: 20 });
    expect(rows).toHaveLength(3);
    const active = rows[0]!;
    expect(active.totalSessions).toBe(4);
    expect(active.loggedSessions).toBe(2);
    expect(active.skippedSessions).toBe(1);
    expect(active.archetypeName).toBe("Strength Focus");
    expect(active.endedOn).toBeNull();
  });

  it("resolves daysPerWeek from week-0 planned_sessions when the column is null", async () => {
    const { getAllBlocksWithCompletionStats } = await import("../queries");
    const rows = await getAllBlocksWithCompletionStats({ limit: 20 });
    const done = rows.find((r) => r.id === "b-done")!;
    expect(done.daysPerWeek).toBe(3);
    // endedOn prefers ended_at over updated_at when both are present
    expect(done.endedOn).toBe("2026-03-28T12:00:00Z");
  });

  it("falls back to updated_at when ended_at is null on a non-active block", async () => {
    const { getAllBlocksWithCompletionStats } = await import("../queries");
    const rows = await getAllBlocksWithCompletionStats({ limit: 20 });
    const custom = rows.find((r) => r.id === "b-custom")!;
    expect(custom.endedOn).toBe("2026-01-20T00:00:00Z");
  });

  it("uses notes as the display name for custom blocks", async () => {
    const { getAllBlocksWithCompletionStats } = await import("../queries");
    const rows = await getAllBlocksWithCompletionStats({ limit: 20 });
    const custom = rows.find((r) => r.id === "b-custom")!;
    expect(custom.archetypeName).toBe("Push/Pull split");
    expect(custom.totalSessions).toBe(0);
  });
});
