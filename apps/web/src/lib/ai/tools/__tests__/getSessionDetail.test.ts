import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { getSessionDetail } from "../getSessionDetail";
import { createSupabaseStub } from "./_supabase-stub";

function makeCtx(
  userId: string,
  tables: Parameters<typeof createSupabaseStub>[0]["tables"],
) {
  const { client } = createSupabaseStub({ userId, tables });
  return { userId, supabase: client as unknown as SupabaseClient, tz: "UTC" };
}

const today = new Date().toISOString().slice(0, 10);

describe("getSessionDetail", () => {
  it("happy path: on-plan session exposes movements (incl. accessory why) + goal archetype", async () => {
    const ctx = makeCtx("u1", {
      sessions: [
        {
          id: "sess-1",
          user_id: "u1",
          performed_at: `${today}T08:00:00.000Z`,
          title: "Squat day",
          prescription: null,
          deleted_at: null,
        },
      ],
      planned_sessions: [
        {
          user_id: "u1",
          block_id: "blk-1",
          completed_session_id: "sess-1",
          week_index: 0,
          day_index: 0,
          role: "squat",
          title: "Squat day",
          session_modality: "pure_strength",
          prescription: {
            items: [
              {
                movementId: "m-squat",
                movementName: "Back Squat",
                kind: "main",
                sets: 3,
                reps: 5,
                percentTm: 85,
              },
              {
                movementId: "m-curl",
                movementName: "Barbell Curl",
                kind: "accessory",
                sets: 3,
                reps: 10,
                targetRir: { min: 1, max: 3 },
                notes: "Biased toward your biceps focus muscle for this block.",
              },
            ],
          },
        },
      ],
      training_blocks: [
        {
          id: "blk-1",
          user_id: "u1",
          archetype: "strength_anchor",
          started_on: today,
          weeks: 4,
          focus_muscles: ["biceps"],
          secondary_focus: "muscle",
          accessory_volume: "high",
          power_emphasis: false,
          status: "active",
          deleted_at: null,
        },
      ],
      profiles: [],
      limitations: [],
    });

    const out = await getSessionDetail.handler({ sessionId: "sess-1" }, ctx);

    expect(out.found).toBe(true);
    expect(out.onPlan).toBe(true);
    expect(out.session.archetype).toBe("strength_anchor");
    expect(out.movements).toHaveLength(2);

    const accessory = out.movements.find((m) => m.kind === "accessory");
    expect(accessory?.name).toBe("Barbell Curl");
    expect(accessory?.why).toBe(
      "Biased toward your biceps focus muscle for this block.",
    );
    expect(accessory?.intensity).toContain("RIR 1-3");

    expect(out.generationContext.goal?.archetype).toBe("strength_anchor");
    expect(out.generationContext.goal?.focusMuscles).toEqual(["biceps"]);
  });

  it("RLS isolation: a session owned by user-b is invisible to user-a", async () => {
    const ctx = makeCtx("user-a", {
      sessions: [
        {
          id: "sess-b",
          user_id: "user-b",
          performed_at: `${today}T08:00:00.000Z`,
          title: "Not yours",
          prescription: null,
          deleted_at: null,
        },
      ],
      planned_sessions: [],
      training_blocks: [],
      profiles: [],
      limitations: [],
    });

    const out = await getSessionDetail.handler({ sessionId: "sess-b" }, ctx);

    expect(out.found).toBe(false);
    expect(out.movements).toEqual([]);
    expect(out.generationContext.goal).toBeNull();
  });

  it("off-plan: a quick session sources movements from sessions.prescription", async () => {
    const ctx = makeCtx("u1", {
      sessions: [
        {
          id: "sess-q",
          user_id: "u1",
          performed_at: `${today}T08:00:00.000Z`,
          title: "Quick lift",
          prescription: {
            items: [
              {
                movementId: "m-bench",
                movementName: "Bench Press",
                kind: "main",
                sets: 5,
                reps: 5,
              },
            ],
          },
          deleted_at: null,
        },
      ],
      planned_sessions: [],
      training_blocks: [],
      profiles: [],
      limitations: [],
    });

    const out = await getSessionDetail.handler({ sessionId: "sess-q" }, ctx);

    expect(out.found).toBe(true);
    expect(out.onPlan).toBe(false);
    expect(out.session.phase).toBe("off-plan / quick session");
    expect(out.movements).toHaveLength(1);
    expect(out.movements[0]?.name).toBe("Bench Press");
    expect(out.movements[0]?.setsReps).toBe("5x5");
  });
});
