import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getRecentSessions } from "../getRecentSessions";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(userId: string, tables: Parameters<typeof createSupabaseStub>[0]["tables"]) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

describe("getRecentSessions", () => {
  it("happy path: strength + cardio summary", async () => {
    const today = new Date().toISOString();
    const ctx = makeCtx("u1", {
      sessions: [
        {
          id: "s1",
          user_id: "u1",
          performed_at: today,
          duration_min: 45,
          session_rpe: 6.5,
          completed_at: today,
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
          movement: { display_name: "Back Squat" },
        },
      ],
      cardio_logs: [
        {
          session_id: "s1",
          modality: "running",
          duration_sec: 1800,
          distance_km: 5.1,
        },
      ],
    });
    const out = await getRecentSessions.handler({ daysBack: 14 }, ctx);
    expect(out.days_back).toBe(14);
    expect(out.sessions).toHaveLength(1);
    expect(out.sessions[0]?.kind).toBe("mixed");
    expect(out.sessions[0]?.top_signals.join(" ")).toContain("Back Squat");
  });

  it("RLS isolation: user A cannot see user B's sessions", async () => {
    const today = new Date().toISOString();
    const ctx = makeCtx("user-a", {
      sessions: [
        {
          id: "s-b",
          user_id: "user-b",
          performed_at: today,
          duration_min: 60,
          session_rpe: 7,
          completed_at: today,
          deleted_at: null,
        },
      ],
      set_logs: [],
      cardio_logs: [],
    });
    const out = await getRecentSessions.handler({ daysBack: 30 }, ctx);
    expect(out.sessions).toEqual([]);
  });

  it("hard cap: daysBack > 90 is rejected by schema", () => {
    const r = getRecentSessions.inputSchema.safeParse({ daysBack: 365 });
    expect(r.success).toBe(false);
  });

  it("empty state: no sessions returns empty array", async () => {
    const ctx = makeCtx("u1", {
      sessions: [],
      set_logs: [],
      cardio_logs: [],
    });
    const out = await getRecentSessions.handler({ daysBack: 7 }, ctx);
    expect(out.sessions).toEqual([]);
  });
});
