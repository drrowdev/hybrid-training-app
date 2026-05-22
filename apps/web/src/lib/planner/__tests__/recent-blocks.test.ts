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
        captured.eq = { col, val };
        return builder;
      }),
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
              started_on: "2026-05-01",
              days_per_week: 4,
              status: "active",
              day_index_overrides: { days: [0, 2, 4, 6], twoADay: false },
            },
            {
              id: "b2",
              archetype: "endurance_anchor",
              started_on: "2026-04-01",
              days_per_week: 5,
              status: "completed",
              day_index_overrides: null,
            },
            {
              id: "b1",
              archetype: "hypertrophy_anchor",
              started_on: "2026-03-01",
              days_per_week: 4,
              status: "archived",
              day_index_overrides: null,
            },
          ],
        });
      }),
    };
    Object.assign(builder, query);
    return {
      auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
      from: vi.fn(() => query),
    };
  },
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
    expect(rows).toHaveLength(3);
  });

  it("projects archetype + daysPerWeek + dayIndexOverrides + status", async () => {
    const { getRecentBlocks } = await import("../queries");
    const rows = await getRecentBlocks(3);
    expect(rows[0]).toEqual({
      id: "b3",
      archetype: "strength_anchor",
      startedOn: "2026-05-01",
      daysPerWeek: 4,
      status: "active",
      dayIndexOverrides: { days: [0, 2, 4, 6], twoADay: false },
    });
    expect(rows[1]?.dayIndexOverrides).toBeNull();
  });
});
