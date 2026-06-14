/**
 * getRecentBlocks query shape test.
 *
 * The DB call is mocked at the supabase client layer; this test pins the
 * ordering + limit + projection so the wizard's "Run it again" entry point
 * doesn't silently regress to undefined cardinality or missing fields.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type Captured = {
  order?: { col: string; opts: { ascending: boolean } };
  limit?: number;
  eq?: { col: string; val: string };
};

const captured: Captured = {};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const builder: Record<string, unknown> = {};
    const query = {
      select: vi.fn().mockReturnValue(builder),
      eq: vi.fn((col: string, val: string) => {
        // The first eq() on /training_blocks is user_id; subsequent eq()s
        // come from deriveDaysPerWeek's planned_sessions probe (block_id +
        // week_index). Only capture the user_id filter so the existing
        // assertion stays meaningful.
        if (col === "user_id") captured.eq = { col, val };
        return builder;
      }),
      is: vi.fn().mockReturnValue(builder),
      order: vi.fn((col: string, opts: { ascending: boolean }) => {
        captured.order = { col, opts };
        return builder;
      }),
      limit: vi.fn((n: number) => {
        captured.limit = n;
        return Promise.resolve({
          data: [
            {
              id: "b3",
              archetype: "strength_anchor",
              program_id: "wendler-531",
              program_family: "531",
              started_on: "2026-05-01",
              days_per_week: 4,
              status: "active",
              day_index_overrides: { days: [0, 2, 4, 6], twoADay: false },
              notes: null,
            },
            {
              id: "b2",
              archetype: "endurance_anchor",
              started_on: "2026-04-01",
              days_per_week: 5,
              status: "completed",
              day_index_overrides: null,
              notes: null,
            },
            {
              id: "b1",
              archetype: "hypertrophy_anchor",
              started_on: "2026-03-01",
              days_per_week: null,
              status: "archived",
              day_index_overrides: null,
              notes: null,
            },
            {
              id: "b0",
              archetype: "custom",
              started_on: "2026-02-01",
              days_per_week: 3,
              status: "completed",
              day_index_overrides: null,
              notes: "Bench specialist",
            },
          ],
        });
      }),
    };
    Object.assign(builder, query);
    return {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      // deriveDaysPerWeek queries planned_sessions; return a fixed set of
      // day_index rows so the fallback for b1 (null days_per_week) resolves
      // to 4 distinct days.
      from: vi.fn((table: string) => {
        if (table === "planned_sessions") {
          return {
            select: vi.fn().mockReturnThis(),
            eq: vi.fn().mockImplementation(function eqImpl(this: unknown, col: string, val: unknown) {
              if (col === "block_id" && val === "b1") {
                return {
                  eq: vi.fn().mockResolvedValue({
                    data: [
                      { day_index: 0 },
                      { day_index: 2 },
                      { day_index: 4 },
                      { day_index: 6 },
                      // duplicate to confirm distinct-count behaviour
                      { day_index: 0 },
                    ],
                  }),
                };
              }
              return { eq: vi.fn().mockResolvedValue({ data: [] }) };
            }),
          };
        }
        return query;
      }),
    };
  },
  getAuthUser: async () => ({ data: { user: { id: "u1" } }, error: null }),
}));

beforeEach(() => {
  captured.order = undefined;
  captured.limit = undefined;
  captured.eq = undefined;
});

describe("getRecentBlocks", () => {
  it("orders by started_on desc and limits to 3", async () => {
    const { getRecentBlocks } = await import("../queries");
    const rows = await getRecentBlocks(3);
    expect(captured.order).toEqual({ col: "started_on", opts: { ascending: false } });
    expect(captured.limit).toBe(3);
    expect(rows).toHaveLength(4);
  });

  it("projects archetype + program ids + daysPerWeek + dayIndexOverrides + status + archetypeName", async () => {
    const { getRecentBlocks } = await import("../queries");
    const rows = await getRecentBlocks(3);
    expect(rows[0]).toEqual({
      id: "b3",
      archetype: "strength_anchor",
      archetypeName: "Strength Focus",
      programId: "wendler-531",
      programFamily: "531",
      startedOn: "2026-05-01",
      daysPerWeek: 4,
      status: "active",
      dayIndexOverrides: { days: [0, 2, 4, 6], twoADay: false },
    });
    expect(rows[1]?.dayIndexOverrides).toBeNull();
    expect(rows[1]?.archetypeName).toBe("Endurance Focus");
    // Legacy archetype block with no platform program id maps to null.
    expect(rows[1]?.programId).toBeNull();
  });

  it("derives daysPerWeek from planned_sessions when the column is null", async () => {
    const { getRecentBlocks } = await import("../queries");
    const rows = await getRecentBlocks(3);
    const b1 = rows.find((r) => r.id === "b1");
    expect(b1?.daysPerWeek).toBe(4);
  });

  it("resolves custom blocks to the user-supplied notes label", async () => {
    const { getRecentBlocks } = await import("../queries");
    const rows = await getRecentBlocks(3);
    const custom = rows.find((r) => r.id === "b0");
    expect(custom?.archetypeName).toBe("Bench specialist");
  });
});
