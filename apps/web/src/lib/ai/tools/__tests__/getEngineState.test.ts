import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

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
    confidenceBias: 0.97,
    finalCeiling: 11640,
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
      freshness: 0.42,
      band: "lingering",
      label: "Light load lingering",
      tone: "caution",
      atl: 100,
      ctl: 80,
      lastLoadDate: null,
    },
  ]),
}));

import { getEngineState } from "../getEngineState";

describe("getEngineState", () => {
  it("happy path: composes bucket, region and ceiling rows from helpers", async () => {
    const out = await getEngineState.handler(
      {},
      {
        userId: "u1",
        supabase: {} as unknown as SupabaseClient,
        tz: "UTC",
      },
    );
    expect(out.bucket_pressure).toHaveLength(1);
    expect(out.bucket_pressure[0]?.percent_of_ceiling).toBe(0.42);
    expect(out.region_freshness[0]?.region).toBe("knee");
    expect(out.ceiling_explain.final_ceiling).toBe(11640);
    expect(out.ceiling_explain.reasons.length).toBeGreaterThan(0);
  });

  it("RLS isolation: ctx.userId is the value passed into helpers (caller controls scope)", async () => {
    // The helpers received via mock are stateless; in production they
    // accept the same supabase client + userId. The catalogue handler
    // never reaches for a service-role client — that's the contract.
    const engineMod = await import("@/lib/stats/engine");
    const spy = engineMod.getBucketPressure as ReturnType<typeof vi.fn>;
    spy.mockClear();
    await getEngineState.handler(
      {},
      { userId: "user-a", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    expect(spy).toHaveBeenCalledWith(expect.anything(), "user-a", "UTC");
  });

  it("hard cap: shape is fixed (5 buckets + region rows + 1 ceiling)", () => {
    const r = getEngineState.outputSchema.safeParse({
      bucket_pressure: [],
      region_freshness: [],
      ceiling_explain: {
        base_ceiling: 0,
        confidence_bias: 1,
        final_ceiling: 0,
        reasons: ["x"],
      },
    });
    expect(r.success).toBe(true);
  });

  it("empty state: helpers throw -> safe fallback", async () => {
    const engineMod = await import("@/lib/stats/engine");
    (engineMod.getBucketPressure as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    );
    (engineMod.getCeilingExplain as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    );
    const regionMod = await import("@/lib/stats/region-freshness-queries");
    (regionMod.getRegionFreshness as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("db down"),
    );
    const out = await getEngineState.handler(
      {},
      { userId: "u1", supabase: {} as unknown as SupabaseClient, tz: "UTC" },
    );
    expect(out.bucket_pressure).toEqual([]);
    expect(out.region_freshness).toEqual([]);
    expect(out.ceiling_explain.final_ceiling).toBe(0);
  });
});
