/**
 * Server-action: `submitBwAssessment`.
 *
 * Covers:
 *   1. Validation rejects out-of-range reps / unacknowledged hinge ack.
 *   2. All-skipped: every family is upserted with its entry node.
 *   3. Mixed signal + chips: the right node ids land in the upsert.
 *   4. Re-submission is idempotent — second call hits upsert again
 *      (Supabase `upsert` is the source of truth for idempotency),
 *      and `bw_assessment_completed_at` is re-stamped.
 *
 * The supabase client is mocked with a chainable builder that records
 * insert / upsert / update / select payloads so the assertions can
 * pin the wire shape.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  MOVEMENT_FAMILIES,
} from "@hta/db";
import { FAMILY_ENTRY_NODE } from "../bw-mapping";

// ── Mock infra ────────────────────────────────────────────────────────

type Calls = {
  upsertedRows: unknown[];
  profileUpdates: unknown[];
  movementNodeQueries: string[][];
};
const calls: Calls = {
  upsertedRows: [],
  profileUpdates: [],
  movementNodeQueries: [],
};

// Build a fake catalog: one row per family for every node_key the
// mapping layer might ask about. The id is `${family}:${nodeKey}` so
// the assertions can introspect what got picked.
function makeCatalogRows(): Array<{ id: string; family: string; node_key: string }> {
  const families: string[] = [...MOVEMENT_FAMILIES];
  const rows: Array<{ id: string; family: string; node_key: string }> = [];
  // Stable list of node keys per family — covers everything either
  // FAMILY_ENTRY_NODE or CHIP_NODE_MAP would return. Mirrors the
  // catalog seed in spirit; we don't need the full DAG here.
  const keysByFamily: Record<string, string[]> = {
    push_h: ["wall_push_up", "counter_push_up", "knee_push_up", "push_up", "decline_push_up", "diamond_push_up", "one_arm_push_up"],
    push_v: ["pike_push_up", "wall_handstand_hold", "freestanding_handstand_hold"],
    pull_h: ["inverted_row"],
    pull_v: ["dead_hang", "scapular_pull", "negative_pull_up", "pull_up", "wide_pull_up", "one_arm_pull_up"],
    squat_unilateral: ["split_squat", "strict_pistol"],
    squat_bilateral: ["bw_squat", "deficit_squat"],
    hinge: ["hip_hinge", "nordic_curl_eccentric"],
    core_anti_flexion: ["dead_bug", "plank", "hollow_body_hold", "l_sit"],
    core_anti_rotation: ["side_plank"],
    planche: ["planche_lean", "tuck_planche"],
    lever_front: ["tuck_front_lever"],
    lever_back: ["tuck_back_lever"],
    muscle_up: ["jumping_muscle_up", "strict_muscle_up"],
    handstand: ["pike_handstand_hold"],
    human_flag: ["clutch_flag", "vertical_flag"],
  };
  for (const family of families) {
    for (const key of keysByFamily[family] ?? []) {
      rows.push({ id: `${family}:${key}`, family, node_key: key });
    }
  }
  return rows;
}

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect to ${path}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => {
    const catalog = makeCatalogRows();
    return {
      auth: {
        getUser: async () => ({
          data: { user: { id: "user-1" } },
        }),
      },
      from: (table: string) => {
        if (table === "movement_nodes") {
          // .select("...").in("family", […])  →  resolves to data
          return {
            select: () => ({
              in: (col: string, vals: string[]) => {
                calls.movementNodeQueries.push(vals);
                return Promise.resolve({
                  data: catalog.filter((c) => vals.includes(c.family)),
                  error: null,
                });
              },
            }),
          };
        }
        if (table === "bw_progress") {
          return {
            upsert: (rows: unknown[]) => {
              calls.upsertedRows.push(...(rows as unknown[]));
              return Promise.resolve({ error: null });
            },
          };
        }
        if (table === "profiles") {
          return {
            update: (payload: unknown) => ({
              eq: () => {
                calls.profileUpdates.push(payload);
                return Promise.resolve({ error: null });
              },
            }),
          };
        }
        throw new Error(`unexpected table: ${table}`);
      },
    };
  },
  getAuthUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
}));

// Import AFTER vi.mock so the mocked supabase is used.
import { submitBwAssessment } from "../bw-assessment";

beforeEach(() => {
  calls.upsertedRows = [];
  calls.profileUpdates = [];
  calls.movementNodeQueries = [];
});

// ── Tests ─────────────────────────────────────────────────────────────

describe("submitBwAssessment validation", () => {
  it("rejects rep counts above 200", async () => {
    const r = await submitBwAssessment({
      pushUpMaxReps: 201,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
      skillChips: [],
      hingeGapAcknowledged: true,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/cannot exceed 200/i);
  });

  it("rejects plank seconds above 600", async () => {
    const r = await submitBwAssessment({
      pushUpMaxReps: null,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: 601,
      skillChips: [],
      hingeGapAcknowledged: true,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects negative rep counts", async () => {
    const r = await submitBwAssessment({
      pushUpMaxReps: -1,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
      skillChips: [],
      hingeGapAcknowledged: true,
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unacknowledged hinge gap", async () => {
    const r = await submitBwAssessment({
      pushUpMaxReps: null,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
      skillChips: [],
      hingeGapAcknowledged: false as unknown as true,
    });
    expect(r.ok).toBe(false);
  });
});

describe("submitBwAssessment behaviour", () => {
  it("all-skipped → every family upserted with its entry node", async () => {
    const r = await submitBwAssessment({
      pushUpMaxReps: null,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
      skillChips: [],
      hingeGapAcknowledged: true,
    });
    expect(r.ok).toBe(true);
    expect(calls.upsertedRows.length).toBe(MOVEMENT_FAMILIES.length);

    for (const row of calls.upsertedRows as Array<{ family: string; current_node_id: string }>) {
      const expectedKey = FAMILY_ENTRY_NODE[row.family as keyof typeof FAMILY_ENTRY_NODE];
      expect(row.current_node_id).toBe(`${row.family}:${expectedKey}`);
    }
    expect(calls.profileUpdates).toHaveLength(1);
    expect(calls.profileUpdates[0]).toMatchObject({
      bw_assessment_completed_at: expect.any(String),
    });
  });

  it("rep tests + chips → mapping + override lands in upsert payload", async () => {
    const r = await submitBwAssessment({
      pushUpMaxReps: 30,
      pullUpMaxReps: 6,
      squatMaxReps: 50,
      plankHoldSeconds: 60,
      skillChips: ["pistol_squat", "tuck_planche", "muscle_up", "l_sit"],
      hingeGapAcknowledged: true,
    });
    expect(r.ok).toBe(true);
    const upserted = new Map(
      (calls.upsertedRows as Array<{ family: string; current_node_id: string }>).map(
        (r) => [r.family, r.current_node_id],
      ),
    );
    expect(upserted.get("push_h")).toBe("push_h:diamond_push_up");
    expect(upserted.get("pull_v")).toBe("pull_v:pull_up");
    expect(upserted.get("squat_bilateral")).toBe("squat_bilateral:deficit_squat");
    // Chip overrides land:
    expect(upserted.get("squat_unilateral")).toBe("squat_unilateral:strict_pistol");
    expect(upserted.get("planche")).toBe("planche:tuck_planche");
    expect(upserted.get("muscle_up")).toBe("muscle_up:strict_muscle_up");
    // l_sit chip overrides the plank-derived hollow_body_hold:
    expect(upserted.get("core_anti_flexion")).toBe("core_anti_flexion:l_sit");
    // Non-signal families fall back to entry node:
    expect(upserted.get("pull_h")).toBe("pull_h:inverted_row");
  });

  it("zeroes accumulators on every upsert (re-calibration semantics)", async () => {
    await submitBwAssessment({
      pushUpMaxReps: 30,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
      skillChips: [],
      hingeGapAcknowledged: true,
    });
    for (const row of calls.upsertedRows as Array<{
      accumulated_tut_seconds: number;
      weeks_at_node: number;
      clean_rep_history: unknown[];
    }>) {
      expect(row.accumulated_tut_seconds).toBe(0);
      expect(row.weeks_at_node).toBe(0);
      expect(row.clean_rep_history).toEqual([]);
    }
  });

  it("two consecutive submissions produce two upsert calls with the same shape (idempotent)", async () => {
    const input = {
      pushUpMaxReps: 10,
      pullUpMaxReps: null,
      squatMaxReps: null,
      plankHoldSeconds: null,
      skillChips: [],
      hingeGapAcknowledged: true,
    };
    const r1 = await submitBwAssessment(input);
    const firstCount = calls.upsertedRows.length;
    const firstPushH = (calls.upsertedRows as Array<{ family: string; current_node_id: string }>)
      .find((r) => r.family === "push_h")?.current_node_id;
    const r2 = await submitBwAssessment(input);
    expect(r1.ok).toBe(true);
    expect(r2.ok).toBe(true);
    // Same number of rows added on the second call:
    expect(calls.upsertedRows.length).toBe(firstCount * 2);
    const secondPushH = (calls.upsertedRows as Array<{ family: string; current_node_id: string }>)
      .slice(firstCount)
      .find((r) => r.family === "push_h")?.current_node_id;
    expect(secondPushH).toBe(firstPushH);
    expect(calls.profileUpdates).toHaveLength(2);
  });
});
