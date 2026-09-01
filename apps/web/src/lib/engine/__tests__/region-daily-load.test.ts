import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveRegionFreshnessLive } from "@/lib/stats/region-state-snapshot";
import { recomputeRegionState } from "../region-ledger";
import { deriveDailyRegionLoad } from "../region-daily-load";

const USER_ID = "00000000-0000-4000-8000-000000000001";

describe("deriveDailyRegionLoad", () => {
  it("uses the same strength and cardio rules for each local day", () => {
    const daily = deriveDailyRegionLoad({
      userTz: "America/Los_Angeles",
      sets: [
        {
          performedAt: "2025-03-09T07:30:00Z",
          weightKg: 100,
          reps: 5,
          rpe: null,
          setKind: "main",
          skipped: false,
          movement: {
            primary_region: "knee",
            secondary_regions: ["foot_ankle_calf"],
          },
        },
        {
          performedAt: "2025-03-09T07:30:00Z",
          weightKg: 100,
          reps: 5,
          rpe: 10,
          setKind: "warmup",
          skipped: false,
          movement: { primary_region: "knee", secondary_regions: [] },
        },
        {
          performedAt: "2025-03-09T07:30:00Z",
          weightKg: 100,
          reps: 5,
          rpe: 10,
          setKind: "main",
          skipped: true,
          movement: { primary_region: "knee", secondary_regions: [] },
        },
      ],
      cardio: [
        {
          performedAt: "2025-03-09T07:30:00Z",
          durationSec: 30 * 60,
          rpe: 6,
          modality: "run",
          hrZones: null,
          movement: null,
        },
      ],
    });

    // 07:30Z is 23:30 on Mar 8 in Los Angeles, immediately before DST starts.
    expect(daily.get("knee")?.get("2025-03-08")).toBeCloseTo(394);
    expect(daily.get("foot_ankle_calf")?.get("2025-03-08")).toBeCloseTo(197);
    expect(daily.get("knee")?.has("2025-03-09")).toBe(false);
  });

  it("uses the user day across Helsinki's daylight-saving boundary", () => {
    const daily = deriveDailyRegionLoad({
      userTz: "Europe/Helsinki",
      sets: [
        {
          performedAt: "2025-03-30T21:30:00Z",
          weightKg: 100,
          reps: 5,
          rpe: 7,
          setKind: "main",
          skipped: false,
          movement: { primary_region: "knee", secondary_regions: [] },
        },
      ],
      cardio: [],
    });

    // Helsinki is UTC+3 after its Mar 30 spring-forward, so this is Mar 31.
    expect(daily.get("knee")?.get("2025-03-31")).toBeCloseTo(275);
    expect(daily.get("knee")?.has("2025-03-30")).toBe(false);
  });
});

describe("region ledger and live snapshot", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-03-31T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("produce identical regional load state from matching strength and cardio logs", async () => {
    const store = {
      sessions: [
        {
          id: "session-1",
          user_id: USER_ID,
          performed_at: "2025-03-30T21:30:00Z",
          completed_at: "2025-03-30T22:00:00Z",
          deleted_at: null,
        },
      ],
      set_logs: [
        {
          session_id: "session-1",
          weight_kg: 100,
          reps: 5,
          rpe: 7,
          set_kind: "main",
          skipped: false,
          movement: {
            primary_region: "knee",
            secondary_regions: ["foot_ankle_calf"],
          },
        },
      ],
      cardio_logs: [
        {
          session_id: "session-1",
          duration_sec: 30 * 60,
          rpe: 6,
          modality: "run",
          hr_zones: null,
          movement: null,
        },
      ],
      region_state: [] as Array<Record<string, unknown>>,
    };
    const supabase = makeRegionStateStub(store);

    await recomputeRegionState(supabase, USER_ID, "Europe/Helsinki");
    const live = await deriveRegionFreshnessLive(
      supabase,
      USER_ID,
      "Europe/Helsinki",
    );

    for (const persisted of store.region_state) {
      if (
        Number(persisted.atl) <= 0 &&
        Number(persisted.baseline_tolerance) <= 0
      ) {
        continue;
      }
      const liveRow = live.get(persisted.region as never);
      expect(liveRow?.atl).toBeCloseTo(Number(persisted.atl), 10);
      expect(liveRow?.baseline).toBeCloseTo(
        Number(persisted.baseline_tolerance),
        10,
      );
    }
  });

  it("fails when stale regional state cannot be cleared", async () => {
    const sessionQuery = {
      eq: () => sessionQuery,
      not: () => sessionQuery,
      is: () => sessionQuery,
      order: async () => ({ data: [], error: null }),
    };
    const supabase = {
      from: (table: string) =>
        table === "sessions"
          ? { select: () => sessionQuery }
          : {
              delete: () => ({
                eq: async () => ({ error: { message: "region delete denied" } }),
              }),
            },
    };

    await expect(
      recomputeRegionState(supabase as never, USER_ID, "America/Los_Angeles"),
    ).rejects.toThrow("region delete denied");
  });
});

function makeRegionStateStub(store: {
  sessions: Array<Record<string, unknown>>;
  set_logs: Array<Record<string, unknown>>;
  cardio_logs: Array<Record<string, unknown>>;
  region_state: Array<Record<string, unknown>>;
}) {
  return {
    from(table: keyof typeof store) {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        in: () => builder,
        not: () => builder,
        is: () => builder,
        gte: () => builder,
        gt: () => builder,
        order: () => builder,
        delete: () => ({
          eq: async () => ({ error: null }),
        }),
        upsert: async (rows: Array<Record<string, unknown>>) => {
          store.region_state.splice(0, store.region_state.length, ...rows);
          return { error: null };
        },
        then: (resolve: (result: { data: unknown; error: null }) => unknown) =>
          Promise.resolve({ data: store[table], error: null }).then(resolve),
      });
      return builder;
    },
  } as never;
}
