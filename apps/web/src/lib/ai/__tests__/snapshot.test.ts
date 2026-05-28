import { describe, expect, it, vi } from "vitest";

// Stub the engine helpers so the snapshot builder runs in isolation.
vi.mock("@/lib/stats/engine", () => ({
  getBucketPressure: vi.fn(async () => [
    {
      bucket: "neural",
      label: "",
      description: "",
      currentPressure: 0,
      ceiling: 0,
      percentOfCeiling: 0.42,
      atl: 0,
      ctl: 0,
      why: "",
    },
  ]),
  getCeilingExplain: vi.fn(async () => ({
    baseCeiling: 12000,
    recoveryMultiplier: 0.93,
    confidenceBias: 0.97,
    finalCeiling: 10827,
    basisWeeks: [{ weekStart: "2026-04-01", weeklyTonnageKg: 12000 }],
    formula: "median-3-recovered",
    inputs: {
      completedSessions28d: 12,
      recoveredWeeksCount: 3,
      dataCompleteness: 0.9,
      notes: ["recovery muscle within range"],
    },
  })),
}));
vi.mock("@/lib/stats/region-freshness-queries", () => ({
  getRegionFreshness: vi.fn(async () => [
    {
      region: "knee",
      regionLabel: "Knees & quads",
      freshness: 0.4,
      band: "lingering",
      label: "Light load lingering",
      tone: "caution",
      atl: 100,
      ctl: 80,
      lastLoadDate: null,
    },
  ]),
  classifyFreshness: () => ({
    band: "ready" as const,
    label: "Ready",
    tone: "ok" as const,
  }),
}));
vi.mock("@/lib/stats/active-block-progress", () => ({
  getActiveBlockProgress: vi.fn(async () => ({
    blockId: "b1",
    archetypeName: "Strength Focus",
    weeks: 4,
    daysPerWeek: 4,
    currentWeek: 2,
    currentDayInWeek: 2,
    totalScheduled: 16,
    scheduledToDate: 6,
    logged: 5,
    skipped: 1,
  })),
}));
vi.mock("@/lib/planner/limitations-context", () => ({
  readLimitationsContext: vi.fn(async () => ({
    blockedRegions: new Set<string>(["knee"]),
    tendinopathyActive: false,
  })),
}));

import { buildEngineSnapshot, GET_ENGINE_SNAPSHOT_TOOL } from "../snapshot";

type Row = Record<string, unknown>;

function tableRowsBuilder(rows: Record<string, Row[]>) {
  return (name: string) => {
    const data = rows[name] ?? [];
    type Q = {
      select: () => Q;
      eq: () => Q;
      gte: () => Q;
      is: () => Q;
      not: () => Q;
      gt: () => Q;
      neq: () => Q;
      in: () => Q;
      order: () => Q;
      limit: () => Q;
      maybeSingle: () => Promise<{ data: Row | null }>;
      then: (resolve: (v: { data: Row[] }) => void) => Promise<void>;
    };
    const queryable: Q = {
      select: () => queryable,
      eq: () => queryable,
      gte: () => queryable,
      is: () => queryable,
      not: () => queryable,
      gt: () => queryable,
      neq: () => queryable,
      in: () => queryable,
      order: () => queryable,
      limit: () => queryable,
      maybeSingle: async () => ({ data: data[0] ?? null }),
      then: (resolve) => Promise.resolve({ data }).then(resolve),
    };
    return queryable;
  };
}

describe("buildEngineSnapshot", () => {
  it("returns the locked shape with knowledge embedded", async () => {
    const stub = {
      from: tableRowsBuilder({
        memories: [
          { category: "goal", text: "marathon under 4h", created_at: "2026-01-01" },
        ],
        profiles: [
          {
            training_experience: "intermediate_2y_5y",
            equipment: { preset: "home" },
            wizard_day_pref: {
              byArchetype: { strength_anchor: { "4": { days: [1, 2, 3, 4], twoADay: false } } },
            },
            timezone: "UTC",
          },
        ],
        limitations: [{ region: "knee", kind: "tendinopathy", resolved_at: null }],
        sessions: [],
        wellness: [{ date: "2026-05-01", fatigue: 3, soreness: 2 }],
        set_logs: [],
        cardio_logs: [],
        training_blocks: [
          {
            started_on: "2026-04-22",
            archetype: "strength_anchor",
            planned_sessions: [
              {
                week_index: 1,
                day_index: 0,
                completed_session_id: "s1",
                skipped_at: null,
                prescription: null,
              },
              {
                week_index: 2,
                day_index: 0,
                completed_session_id: null,
                skipped_at: null,
                prescription: null,
              },
            ],
          },
        ],
      }),
    } as unknown as Parameters<typeof buildEngineSnapshot>[0];

    const snap = await buildEngineSnapshot(stub, "u1", "UTC");
    expect(snap.user_tz).toBe("UTC");
    expect(snap.memories).toEqual([
      { category: "goal", text: "marathon under 4h" },
    ]);
    expect(snap.profile.experience_tier).toBe("intermediate_2y_5y");
    expect(snap.profile.declared_limitations).toEqual([
      { region: "knee", kind: "tendinopathy" },
    ]);
    expect(snap.profile.archetype_preferences).toContain("strength_anchor");
    expect(snap.active_block?.archetype).toBe("Strength Focus");
    expect(snap.engine_state.bucket_pressure.neural).toBe(0.42);
    expect(snap.engine_state.ceiling_explain.final_ceiling).toBe(10827);
    expect(snap.engine_state.ceiling_explain.reasons.length).toBeGreaterThan(
      0,
    );
    expect(snap.knowledge.archetypes.length).toBeGreaterThan(0);
    expect(snap.knowledge.calibration_policy).toContain("CP-1");
    expect(snap.knowledge.constants_table).toContain("ATL decay");
  });

  it("handles missing data gracefully (cold-start user)", async () => {
    const stub = {
      from: tableRowsBuilder({}),
    } as unknown as Parameters<typeof buildEngineSnapshot>[0];
    const snap = await buildEngineSnapshot(stub, "u1", "UTC");
    expect(snap.memories).toEqual([]);
    expect(snap.profile.experience_tier).toBeNull();
    expect(snap.profile.declared_limitations).toEqual([]);
    expect(snap.last_90d.sessions).toEqual([]);
    expect(snap.prs).toEqual([]);
  });

  it("GET_ENGINE_SNAPSHOT_TOOL has the locked shape", () => {
    expect(GET_ENGINE_SNAPSHOT_TOOL.name).toBe("getEngineSnapshot");
    expect(GET_ENGINE_SNAPSHOT_TOOL.inputSchema).toEqual({
      type: "object",
      properties: {},
      required: [],
    });
  });
});
