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

  it("planned-not-started: resolves a planned_sessions.id directly (no session row yet)", async () => {
    const ctx = makeCtx("u1", {
      sessions: [],
      planned_sessions: [
        {
          id: "planned-7",
          user_id: "u1",
          block_id: "blk-1",
          completed_session_id: null,
          week_index: 0,
          day_index: 0,
          role: "squat",
          title: "Upcoming squat day",
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
                movementId: "m-carry",
                movementName: "Farmer Carry",
                kind: "accessory",
                sets: 3,
                notes: "Low-fatigue grip and trunk durability.",
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
          focus_muscles: [],
          secondary_focus: "none",
          accessory_volume: "medium",
          power_emphasis: false,
          status: "active",
          deleted_at: null,
        },
      ],
      profiles: [],
      limitations: [],
    });

    const out = await getSessionDetail.handler({ sessionId: "planned-7" }, ctx);

    expect(out.found).toBe(true);
    expect(out.onPlan).toBe(true);
    expect(out.session.date).toBeNull(); // not performed yet
    expect(out.session.archetype).toBe("strength_anchor");
    expect(out.movements).toHaveLength(2);
    expect(out.movements.find((m) => m.kind === "accessory")?.why).toBe(
      "Low-fatigue grip and trunk durability.",
    );
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

  it("performance: reports only logged sets, flags prescribed-but-not-performed movements", async () => {
    const ctx = makeCtx("u1", {
      sessions: [
        {
          id: "sess-1",
          user_id: "u1",
          performed_at: `${today}T08:00:00.000Z`,
          title: "Front Squat",
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
          title: "Front Squat",
          session_modality: "pure_strength",
          prescription: {
            items: [
              {
                movementId: "m-fsq",
                movementName: "Front Squat",
                kind: "main",
                sets: 3,
                reps: 5,
                percentTm: 85,
              },
              {
                movementId: "m-carry",
                movementName: "Farmer Carry",
                kind: "accessory",
                sets: 3,
                reps: 10,
              },
              {
                movementId: "m-wallsit",
                movementName: "Wall Sit",
                kind: "accessory",
                sets: 3,
                reps: 10,
              },
            ],
          },
        },
      ],
      // Only ONE working set logged — the Front Squat top set. Accessories
      // were prescribed but never logged.
      set_logs: [
        {
          session_id: "sess-1",
          movement_id: "m-fsq",
          weight_kg: 72.5,
          reps: 5,
          rpe: 7.5,
          set_kind: "main",
          skipped: false,
          created_at: `${today}T08:10:00.000Z`,
        },
      ],
      movements: [{ id: "m-fsq", display_name: "Front Squat", slug: "front_squat" }],
      // Saved 1RM well above the logged top set's e1RM → no PR.
      training_maxes: [
        { user_id: "u1", movement_id: "m-fsq", one_rm_kg: 130 },
      ],
      training_blocks: [
        {
          id: "blk-1",
          user_id: "u1",
          archetype: "strength_anchor",
          started_on: today,
          weeks: 4,
          focus_muscles: [],
          secondary_focus: "none",
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
    // Prescription still lists all three movements…
    expect(out.movements).toHaveLength(3);
    // …but performance reflects the single logged set only.
    expect(out.performance).not.toBeNull();
    expect(out.performance?.hasLog).toBe(true);
    expect(out.performance?.loggedWorkingSets).toBe(1);
    expect(out.performance?.prCount).toBe(0);
    expect(out.performance?.movements).toHaveLength(1);
    expect(out.performance?.movements[0]?.movementId).toBe("m-fsq");
    expect(out.performance?.movements[0]?.loggedSets).toHaveLength(1);
    expect(out.performance?.movements[0]?.loggedSets[0]?.weightKg).toBe(72.5);
    // The two prescribed-but-unlogged accessories surface as not performed.
    expect(out.performance?.notPerformed).toEqual(
      expect.arrayContaining(["Farmer Carry", "Wall Sit"]),
    );
    expect(out.performance?.notPerformed).not.toContain("Front Squat");
    expect(getSessionDetail.outputSchema.safeParse(out).success).toBe(true);
  });

  it("planned-not-started: performance is null (nothing logged yet)", async () => {
    const ctx = makeCtx("u1", {
      sessions: [],
      planned_sessions: [
        {
          id: "planned-9",
          user_id: "u1",
          block_id: null,
          completed_session_id: null,
          week_index: 0,
          day_index: 0,
          role: "squat",
          title: "Upcoming",
          session_modality: "pure_strength",
          prescription: { items: [] },
        },
      ],
      training_blocks: [],
      profiles: [],
      limitations: [],
    });

    const out = await getSessionDetail.handler({ sessionId: "planned-9" }, ctx);
    expect(out.found).toBe(true);
    expect(out.performance).toBeNull();
  });
});
