/**
 * getEngineState — current bucket pressure, per-region freshness, and
 * the ceiling-explain output.
 *
 * Data source: `getBucketPressure`, `getRegionFreshness`, and
 * `getCeilingExplain` from `apps/web/src/lib/stats/engine.ts` /
 * `region-freshness-queries.ts`. These helpers already accept a
 * Supabase client + userId so they slot directly into ctx.
 *
 * Hard shape: 5 buckets + ≤ 7 regions + 1 ceiling row.
 */
import { z } from "zod";
import type { Tool } from "./types";

const bucketSchema = z.object({
  bucket: z.string(),
  percent_of_ceiling: z.number(),
});

const regionSchema = z.object({
  region: z.string(),
  freshness: z.number(),
  atl: z.number(),
  ctl: z.number(),
});

const ceilingSchema = z.object({
  base_ceiling: z.number(),
  recovery_multiplier: z.number(),
  confidence_bias: z.number(),
  final_ceiling: z.number(),
  reasons: z.array(z.string()),
});

const outputSchema = z.object({
  bucket_pressure: z.array(bucketSchema),
  region_freshness: z.array(regionSchema),
  ceiling_explain: ceilingSchema,
});

const inputSchema = z.object({}).strict();

type Input = z.infer<typeof inputSchema>;
type Output = z.infer<typeof outputSchema>;

async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch {
    return fallback;
  }
}

export const getEngineState: Tool<Input, Output> = {
  name: "getEngineState",
  description:
    "Returns the engine's current state: per-bucket pressure (percent of ceiling), per-region freshness with ATL/CTL, and the ceiling-explain breakdown.",
  inputSchema,
  outputSchema,
  async handler(_input, ctx) {
    // Lazy-load to keep the catalogue tree-shakeable from the orchestrator.
    const [{ getBucketPressure, getCeilingExplain }, { getRegionFreshness }] =
      await Promise.all([
        import("@/lib/stats/engine"),
        import("@/lib/stats/region-freshness-queries"),
      ]);

    const [bucket, region, ceiling] = await Promise.all([
      safe(() => getBucketPressure(ctx.supabase, ctx.userId, ctx.tz), []),
      safe(() => getRegionFreshness(ctx.supabase, ctx.userId), []),
      safe(
        () => getCeilingExplain(ctx.supabase, ctx.userId, ctx.tz),
        null as Awaited<ReturnType<typeof getCeilingExplain>> | null,
      ),
    ]);

    const reasons: string[] = [];
    if (ceiling) {
      reasons.push(
        `base from ${ceiling.formula} formula across ${ceiling.basisWeeks.length} basis week(s)`,
        `recovery multiplier ${ceiling.recoveryMultiplier.toFixed(2)}`,
        `confidence bias ${ceiling.confidenceBias.toFixed(2)}`,
      );
      for (const n of ceiling.inputs.notes ?? []) reasons.push(n);
    } else {
      reasons.push("no recovered weeks yet — heuristic default");
    }

    return {
      bucket_pressure: bucket.map((b) => ({
        bucket: b.bucket,
        percent_of_ceiling: b.percentOfCeiling,
      })),
      region_freshness: region.map((r) => ({
        region: r.region,
        freshness: r.freshness,
        atl: r.atl,
        ctl: r.ctl,
      })),
      ceiling_explain: {
        base_ceiling: ceiling?.baseCeiling ?? 0,
        recovery_multiplier: ceiling?.recoveryMultiplier ?? 1,
        confidence_bias: ceiling?.confidenceBias ?? 1,
        final_ceiling: ceiling?.finalCeiling ?? 0,
        reasons,
      },
    };
  },
};
