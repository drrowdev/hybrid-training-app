import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getPrTimeline } from "../getPrTimeline";
import { createSupabaseStub } from "./_supabase-stub";

/**
 * The PR tool joins through `sessions!inner` so RLS isolation is
 * enforced via the parent session's `user_id`. Our stub doesn't model
 * the join filter; emulate it by tagging the `session.user_id` on each
 * row so the test reads like the live query.
 */
function makeCtx(userId: string, rows: unknown[]) {
  // Use a custom rlsFilter that respects session.user_id since set_logs
  // itself has no user_id column.
  const { client } = createSupabaseStub({
    userId,
    tables: {
      set_logs: {
        rows: rows as Array<Record<string, unknown>>,
        rlsFilter: (row, ctx) => {
          const session = (row as { session?: { user_id?: string } })
            .session;
          return session?.user_id === ctx.userId;
        },
      },
    },
  });
  return {
    userId,
    supabase: client as unknown as SupabaseClient,
    tz: "UTC",
  };
}

describe("getPrTimeline", () => {
  it("happy path: returns top PR per movement, sorted by weight", async () => {
    const ctx = makeCtx("u1", [
      {
        weight_kg: 100,
        reps: 5,
        session: {
          user_id: "u1",
          performed_at: "2026-05-01T10:00:00Z",
          deleted_at: null,
        },
        movement: { display_name: "Back Squat" },
      },
      {
        weight_kg: 95,
        reps: 5,
        session: {
          user_id: "u1",
          performed_at: "2026-04-01T10:00:00Z",
          deleted_at: null,
        },
        movement: { display_name: "Back Squat" },
      },
      {
        weight_kg: 70,
        reps: 5,
        session: {
          user_id: "u1",
          performed_at: "2026-05-03T10:00:00Z",
          deleted_at: null,
        },
        movement: { display_name: "Bench Press" },
      },
    ]);
    const out = await getPrTimeline.handler({}, ctx);
    expect(out.prs).toHaveLength(2);
    expect(out.prs[0]?.movement).toBe("Back Squat");
    expect(out.prs[0]?.value).toBe(100);
  });

  it("filter: movement substring narrows results", async () => {
    const ctx = makeCtx("u1", [
      {
        weight_kg: 100,
        reps: 5,
        session: {
          user_id: "u1",
          performed_at: "2026-05-01T10:00:00Z",
          deleted_at: null,
        },
        movement: { display_name: "Back Squat" },
      },
      {
        weight_kg: 70,
        reps: 5,
        session: {
          user_id: "u1",
          performed_at: "2026-05-03T10:00:00Z",
          deleted_at: null,
        },
        movement: { display_name: "Bench Press" },
      },
    ]);
    const out = await getPrTimeline.handler({ movement: "bench" }, ctx);
    expect(out.prs).toHaveLength(1);
    expect(out.prs[0]?.movement).toBe("Bench Press");
  });

  it("RLS isolation: user A never sees user B's PRs", async () => {
    const ctx = makeCtx("user-a", [
      {
        weight_kg: 200,
        reps: 1,
        session: {
          user_id: "user-b",
          performed_at: "2026-05-01T10:00:00Z",
          deleted_at: null,
        },
        movement: { display_name: "Back Squat" },
      },
    ]);
    const out = await getPrTimeline.handler({}, ctx);
    expect(out.prs).toEqual([]);
  });

  it("hard cap: outputSchema accepts well within 250-row limit", () => {
    const r = getPrTimeline.outputSchema.safeParse({
      prs: Array.from({ length: 250 }).map((_, i) => ({
        date: "2026-01-01",
        movement: `m-${i}`,
        kind: "weight" as const,
        value: 10,
        unit: "kg" as const,
        reps: 5,
      })),
    });
    expect(r.success).toBe(true);
  });

  it("empty state: no sets returns empty PR list", async () => {
    const ctx = makeCtx("u1", []);
    const out = await getPrTimeline.handler({}, ctx);
    expect(out.prs).toEqual([]);
  });
});
