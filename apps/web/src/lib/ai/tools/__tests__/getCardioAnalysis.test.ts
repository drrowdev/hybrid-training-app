import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getCardioAnalysis } from "../getCardioAnalysis";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(
  userId: string,
  tables: Parameters<typeof createSupabaseStub>[0]["tables"],
) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

const today = new Date().toISOString();

describe("getCardioAnalysis", () => {
  it("happy path: per-modality volume from owned cardio_logs is populated and schema-valid", async () => {
    const ctx = makeCtx("u1", {
      sessions: [
        { id: "s1", user_id: "u1", performed_at: today, deleted_at: null },
      ],
      // cardio_logs are scoped via the parent session — no user_id/id column
      // here, RLS is enforced by the session-id join in the handler.
      cardio_logs: [
        {
          session_id: "s1",
          modality: "run",
          duration_sec: 1800,
          avg_hr_bpm: 150,
          hr_zones: null,
          rpe: null,
        },
        {
          session_id: "s1",
          modality: "bike",
          duration_sec: 3600,
          avg_hr_bpm: 130,
          hr_zones: null,
          rpe: null,
        },
      ],
    });

    const out = await getCardioAnalysis.handler({ daysBack: 90 }, ctx);

    const mods = out.modality_breakdown.map((m) => m.modality).sort();
    expect(mods).toEqual(["bike", "run"]);
    const run = out.modality_breakdown.find((m) => m.modality === "run")!;
    expect(run.minutes).toBe(30);
    expect(run.sessions).toBe(1);
    expect(run.avg_hr_bpm).toBe(150);

    // strength interference is driven purely by the cardio blocks.
    expect(out.strength_interference).not.toBeNull();
    expect(out.strength_interference!.scalar).toBeGreaterThanOrEqual(0.6);
    expect(out.strength_interference!.scalar).toBeLessThanOrEqual(1.0);

    expect(out.window_days).toBe(90);
    // No Strava in the stub → HR/pace helpers degrade to nulls + flags.
    expect(out.data_gaps).toContain("no Strava connected");

    expect(getCardioAnalysis.outputSchema.safeParse(out).success).toBe(true);
  });

  it("RLS isolation: a cardio log on another user's session is not surfaced", async () => {
    const ctx = makeCtx("user-a", {
      sessions: [
        { id: "s-a", user_id: "user-a", performed_at: today, deleted_at: null },
        { id: "s-b", user_id: "user-b", performed_at: today, deleted_at: null },
      ],
      cardio_logs: [
        {
          session_id: "s-b",
          modality: "run",
          duration_sec: 2400,
          avg_hr_bpm: 160,
          hr_zones: null,
          rpe: null,
        },
      ],
    });

    const out = await getCardioAnalysis.handler({ daysBack: 90 }, ctx);

    // user-a owns no cardio — user-b's run must never leak through.
    expect(out.modality_breakdown).toEqual([]);
    expect(out.strength_interference).toBeNull();
    expect(out.data_gaps).toContain("no cardio logged in window");
  });

  it("empty state: no cardio → empty arrays/nulls + data_gaps, never throws", async () => {
    const ctx = makeCtx("u1", { sessions: [], cardio_logs: [] });

    const out = await getCardioAnalysis.handler({}, ctx);

    expect(out.window_days).toBe(90);
    expect(out.modality_breakdown).toEqual([]);
    expect(out.hr_zones).toBeNull();
    expect(out.polarized_split).toBeNull();
    expect(out.pace_trend).toBeNull();
    expect(out.pace_prs).toEqual([]);
    expect(out.strength_interference).toBeNull();
    expect(out.data_gaps.length).toBeGreaterThan(0);
    expect(getCardioAnalysis.outputSchema.safeParse(out).success).toBe(true);
  });
});
