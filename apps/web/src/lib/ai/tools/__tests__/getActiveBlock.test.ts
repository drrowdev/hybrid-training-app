import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getActiveBlock } from "../getActiveBlock";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(userId: string, tables: Parameters<typeof createSupabaseStub>[0]["tables"]) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

describe("getActiveBlock", () => {
  it("happy path: returns archetype + prescribed sessions", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const ctx = makeCtx("u1", {
      training_blocks: [
        {
          id: "blk-1",
          user_id: "u1",
          archetype: "strength_anchor",
          started_on: today,
          weeks: 4,
          notes: null,
          status: "active",
          deleted_at: null,
        },
      ],
      planned_sessions: [
        {
          block_id: "blk-1",
          week_index: 0,
          day_index: 0,
          title: "Day 1",
          role: "squat",
          completed_session_id: null,
          skipped_at: null,
          // user_id intentionally absent — the table has no user_id column;
          // RLS scopes via the parent block.
        },
        {
          block_id: "blk-1",
          week_index: 0,
          day_index: 2,
          title: "Day 2",
          role: "press",
          completed_session_id: "s-99",
          skipped_at: null,
        },
      ],
    });
    const out = await getActiveBlock.handler({}, ctx);
    expect(out.archetype).toBe("strength_anchor");
    expect(out.weeks_total).toBe(4);
    expect(out.prescribed_next_two_weeks).toHaveLength(2);
    expect(out.prescribed_next_two_weeks[1]?.status).toBe("completed");
  });

  it("RLS isolation: user A cannot see user B's active block", async () => {
    const ctx = makeCtx("user-a", {
      training_blocks: [
        {
          id: "blk-b",
          user_id: "user-b",
          archetype: "strength_anchor",
          started_on: "2026-05-01",
          weeks: 4,
          notes: null,
          status: "active",
          deleted_at: null,
        },
      ],
      planned_sessions: [],
    });
    const out = await getActiveBlock.handler({}, ctx);
    expect(out.archetype).toBeNull();
    expect(out.prescribed_next_two_weeks).toEqual([]);
  });

  it("hard cap: schema asserts <= 14 prescribed sessions", () => {
    const sample = Array.from({ length: 14 }).map((_, i) => ({
      date: "2026-05-01",
      week_index: 0,
      day_index: i % 7,
      title: "x",
      role: "x",
      status: "pending" as const,
    }));
    const r = getActiveBlock.outputSchema.safeParse({
      archetype: "strength_anchor",
      started_on: "2026-05-01",
      weeks_total: 4,
      current_week_index: 0,
      prescribed_next_two_weeks: sample,
    });
    expect(r.success).toBe(true);
  });

  it("empty state: no active block returns nulls", async () => {
    const ctx = makeCtx("u1", { training_blocks: [], planned_sessions: [] });
    const out = await getActiveBlock.handler({}, ctx);
    expect(out.archetype).toBeNull();
    expect(out.prescribed_next_two_weeks).toEqual([]);
  });
});
