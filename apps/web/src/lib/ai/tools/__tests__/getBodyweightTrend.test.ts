import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getBodyweightTrend } from "../getBodyweightTrend";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(
  userId: string,
  tables: Parameters<typeof createSupabaseStub>[0]["tables"],
) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

/** YYYY-MM-DD `n` days before today (UTC). */
function ymdDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

describe("getBodyweightTrend", () => {
  it("happy path: a downward trend in a lean_out phase reads as losing + aligned", async () => {
    const ctx = makeCtx("u1", {
      wellness: [
        { user_id: "u1", date: ymdDaysAgo(60), bodyweight_kg: 84 },
        { user_id: "u1", date: ymdDaysAgo(40), bodyweight_kg: 83 },
        { user_id: "u1", date: ymdDaysAgo(20), bodyweight_kg: 82 },
        { user_id: "u1", date: ymdDaysAgo(2), bodyweight_kg: 81 },
      ],
      profiles: [
        {
          id: "u1",
          body_comp_phase: "lean_out",
          phase_started_at: ymdDaysAgo(56),
          phase_target_weeks: 12,
        },
      ],
    });

    const out = await getBodyweightTrend.handler({}, ctx);

    expect(out.num_entries).toBe(4);
    expect(out.latest?.kg).toBe(81);
    expect(out.delta_kg).toBe(-3);
    expect(out.slope_kg_per_week).not.toBeNull();
    expect(out.slope_kg_per_week!).toBeLessThan(0);
    expect(out.slope_pct_bw_per_week).not.toBeNull();
    expect(out.assessment.direction).toBe("losing");
    expect(out.phase.declared).toBe("lean_out");
    expect(out.phase.target_weeks).toBe(12);
    expect(out.phase.weeks_elapsed).not.toBeNull();
    expect(out.assessment.aligned_with_phase).toBe(true);
    expect(out.data_gaps).not.toContain("no bodyweight logged in window");

    expect(getBodyweightTrend.outputSchema.safeParse(out).success).toBe(true);
  });

  it("misalignment: losing weight while in a gain phase flags aligned:false", async () => {
    const ctx = makeCtx("u1", {
      wellness: [
        { user_id: "u1", date: ymdDaysAgo(40), bodyweight_kg: 90 },
        { user_id: "u1", date: ymdDaysAgo(20), bodyweight_kg: 89 },
        { user_id: "u1", date: ymdDaysAgo(2), bodyweight_kg: 88 },
      ],
      profiles: [
        {
          id: "u1",
          body_comp_phase: "gain",
          phase_started_at: ymdDaysAgo(30),
          phase_target_weeks: 8,
        },
      ],
    });

    const out = await getBodyweightTrend.handler({ daysBack: 60 }, ctx);

    expect(out.assessment.direction).toBe("losing");
    expect(out.phase.declared).toBe("gain");
    expect(out.assessment.aligned_with_phase).toBe(false);
    expect(out.assessment.signal).toContain("NOT aligned");
    expect(getBodyweightTrend.outputSchema.safeParse(out).success).toBe(true);
  });

  it("no data: empty wellness returns latest:null, stable, with a not-logged gap, never throws", async () => {
    const ctx = makeCtx("u1", {
      wellness: [],
      profiles: [{ id: "u1", body_comp_phase: "maintain", phase_started_at: null, phase_target_weeks: null }],
    });

    const out = await getBodyweightTrend.handler({}, ctx);

    expect(out.num_entries).toBe(0);
    expect(out.latest).toBeNull();
    expect(out.delta_kg).toBeNull();
    expect(out.slope_kg_per_week).toBeNull();
    expect(out.assessment.direction).toBe("stable");
    expect(out.data_gaps).toContain("no bodyweight logged in window");
    expect(getBodyweightTrend.outputSchema.safeParse(out).success).toBe(true);
  });

  it("RLS isolation: another user's weigh-ins never surface", async () => {
    const ctx = makeCtx("user-a", {
      wellness: [
        { user_id: "user-b", date: ymdDaysAgo(10), bodyweight_kg: 70 },
        { user_id: "user-b", date: ymdDaysAgo(2), bodyweight_kg: 71 },
      ],
      profiles: [
        { id: "user-a", body_comp_phase: null, phase_started_at: null, phase_target_weeks: null },
      ],
    });

    const out = await getBodyweightTrend.handler({}, ctx);

    expect(out.num_entries).toBe(0);
    expect(out.latest).toBeNull();
    expect(out.phase.declared).toBeNull();
    expect(out.data_gaps).toContain("no bodyweight logged in window");
    expect(out.data_gaps).toContain("no body-composition phase declared");
    expect(getBodyweightTrend.outputSchema.safeParse(out).success).toBe(true);
  });
});
