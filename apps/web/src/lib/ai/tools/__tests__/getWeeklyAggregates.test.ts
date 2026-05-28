import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getWeeklyAggregates } from "../getWeeklyAggregates";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(userId: string, tables: Parameters<typeof createSupabaseStub>[0]["tables"]) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

describe("getWeeklyAggregates", () => {
  it("happy path: rolls up tonnage and cardio minutes per week", async () => {
    const performedAt = new Date().toISOString();
    const ctx = makeCtx("u1", {
      sessions: [
        {
          id: "s1",
          user_id: "u1",
          performed_at: performedAt,
          completed_at: performedAt,
          deleted_at: null,
        },
      ],
      set_logs: [
        {
          session_id: "s1",
          weight_kg: 100,
          reps: 5,
          set_kind: "main",
          skipped: false,
        },
        {
          session_id: "s1",
          weight_kg: 50,
          reps: 10,
          set_kind: "warmup",
          skipped: false,
        },
      ],
      cardio_logs: [{ session_id: "s1", duration_sec: 1800 }],
    });
    const out = await getWeeklyAggregates.handler({ weeksBack: 4 }, ctx);
    expect(out.weeks_back).toBe(4);
    expect(out.weeks).toHaveLength(1);
    expect(out.weeks[0]?.tonnage_kg).toBe(500);
    expect(out.weeks[0]?.cardio_minutes).toBe(30);
    expect(out.weeks[0]?.sessions_completed).toBe(1);
  });

  it("RLS isolation: user A cannot see user B's weekly rollups", async () => {
    const ctx = makeCtx("user-a", {
      sessions: [
        {
          id: "s-b",
          user_id: "user-b",
          performed_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          deleted_at: null,
        },
      ],
      set_logs: [],
      cardio_logs: [],
    });
    const out = await getWeeklyAggregates.handler({ weeksBack: 4 }, ctx);
    expect(out.weeks).toEqual([]);
  });

  it("hard cap: weeksBack > 104 is rejected by schema", () => {
    const r = getWeeklyAggregates.inputSchema.safeParse({ weeksBack: 999 });
    expect(r.success).toBe(false);
  });

  it("empty state: no sessions returns empty list", async () => {
    const ctx = makeCtx("u1", {
      sessions: [],
      set_logs: [],
      cardio_logs: [],
    });
    const out = await getWeeklyAggregates.handler({ weeksBack: 8 }, ctx);
    expect(out.weeks).toEqual([]);
  });
});
