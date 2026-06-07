import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getLiftProgress } from "../getLiftProgress";
import { createSupabaseStub, type StubRow } from "./_supabase-stub";

function makeCtx(
  userId: string,
  tables: Parameters<typeof createSupabaseStub>[0]["tables"],
) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

const today = new Date().toISOString();

/**
 * set_logs are scoped to their parent session in production via the
 * `sessions!inner` join. The stub can't drive a join filter, so we
 * mirror RLS with a custom filter that reads the nested session owner.
 */
function setLogRls(row: StubRow, ctx: { userId: string }): boolean {
  const s = row.sessions as { user_id?: string } | undefined;
  return s?.user_id === ctx.userId;
}

function setLog(opts: {
  sessionId: string;
  ownerId: string;
  weight: number;
  reps: number;
  rpe: number | null;
  performedAt: string;
}): StubRow {
  return {
    weight_kg: opts.weight,
    reps: opts.reps,
    rpe: opts.rpe,
    skipped: false,
    set_kind: "working",
    movement_id: "m1",
    sessions: {
      id: opts.sessionId,
      user_id: opts.ownerId,
      performed_at: opts.performedAt,
      completed_at: opts.performedAt,
      deleted_at: null,
    },
  };
}

describe("getLiftProgress", () => {
  it("happy path: resolves the lift and returns top sets + an e1RM, schema-valid", async () => {
    const ctx = makeCtx("u1", {
      movements: [
        {
          id: "m1",
          slug: "bench-press",
          display_name: "Bench Press",
          user_id: "u1",
        },
      ],
      set_logs: {
        rows: [
          setLog({ sessionId: "s1", ownerId: "u1", weight: 90, reps: 5, rpe: 7, performedAt: today }),
          setLog({ sessionId: "s2", ownerId: "u1", weight: 95, reps: 5, rpe: 8, performedAt: today }),
          setLog({ sessionId: "s3", ownerId: "u1", weight: 100, reps: 5, rpe: 8, performedAt: today }),
        ],
        rlsFilter: setLogRls,
      },
      training_maxes: [
        { user_id: "u1", movement_id: "m1", one_rm_kg: 110, tm_percent: 90 },
      ],
      tm_history: [
        {
          user_id: "u1",
          movement_id: "m1",
          changed_at: today,
          old_tm_kg: 95,
          new_tm_kg: 99,
          reason: "pr_detection",
        },
      ],
    });

    const out = await getLiftProgress.handler({ movement: "bench" }, ctx);

    expect(out.found).toBe(true);
    expect(out.movement?.displayName).toBe("Bench Press");
    expect(out.movement?.id).toBe("m1");
    expect(out.recent_top_sets.length).toBeGreaterThan(0);
    expect(out.current.e1rm).not.toBeNull();
    expect(out.current.tm_kg).toBe(99);
    expect(out.tm_history.length).toBe(1);
    expect(out.tm_history[0]?.new_tm_kg).toBe(99);
    expect(out.best_ever_e1rm).not.toBeNull();
    expect(["up", "flat", "down", "stalled"]).toContain(out.assessment.direction);

    expect(getLiftProgress.outputSchema.safeParse(out).success).toBe(true);
  });

  it("not found: an unmatched lift returns found:false with a not-found gap, never throws", async () => {
    const ctx = makeCtx("u1", {
      movements: [
        { id: "m1", slug: "squat", display_name: "Squat", user_id: "u1" },
      ],
    });

    const out = await getLiftProgress.handler({ movement: "deadlift" }, ctx);

    expect(out.found).toBe(false);
    expect(out.movement).toBeNull();
    expect(out.recent_top_sets).toEqual([]);
    expect(out.current.e1rm).toBeNull();
    expect(out.data_gaps.some((g) => g.includes("not found"))).toBe(true);
    expect(getLiftProgress.outputSchema.safeParse(out).success).toBe(true);
  });

  it("RLS isolation: another user's set_logs never surface for the lift", async () => {
    const ctx = makeCtx("user-a", {
      movements: [
        {
          id: "m1",
          slug: "bench-press",
          display_name: "Bench Press",
          user_id: "user-a",
        },
      ],
      set_logs: {
        rows: [
          setLog({ sessionId: "s-b", ownerId: "user-b", weight: 140, reps: 3, rpe: 9, performedAt: today }),
        ],
        rlsFilter: setLogRls,
      },
    });

    const out = await getLiftProgress.handler({ movement: "bench press" }, ctx);

    expect(out.found).toBe(true);
    expect(out.recent_top_sets).toEqual([]);
    expect(out.current.e1rm).toBeNull();
    expect(out.data_gaps).toContain("no logged sets for this lift in window");
    expect(getLiftProgress.outputSchema.safeParse(out).success).toBe(true);
  });
});
