/**
 * Tests for the cache-backed `getRegionFreshnessDetail` read path
 * + its `deriveRegionFreshnessLive` today-fallback helper.
 *
 * Coverage:
 *  - Cached path: returns 14-day strip from `region_state_history`
 *    when fully present (no live data needed).
 *  - Fallback path: when today's snapshot isn't present, the live
 *    value is appended onto the cached series.
 *  - Today-already-snapshotted: live value replaces today's cached row
 *    rather than appending a 15th point.
 *  - Empty: no cache + no live data → region omitted.
 *  - 14-day window math: rows older than today-13 are excluded by the
 *    query filter (cached rows outside the window must not appear).
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRegionFreshnessDetail } from "../engine";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;

function todayYmd(): string {
  // engine.ts uses todayYmd(tz="UTC") → ISO-date in UTC.
  return new Date().toISOString().slice(0, 10);
}

function addDays(ymd: string, days: number): string {
  const d = new Date(ymd + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Tiny chainable PostgREST-like stub. Just enough for
 * getRegionFreshnessDetail + deriveRegionFreshnessLive:
 *   select / eq / in / is / not / gt / gte / lte / order.
 *
 * Tables are matched by name; row filters are applied left-to-right.
 */
function makeStub(tables: Tables): SupabaseClient {
  function from(table: string) {
    let rows = (tables[table] ?? []).slice();
    const builder: Record<string, unknown> = {};
    const apply = (pred: (r: Row) => boolean) => {
      rows = rows.filter(pred);
      return builder;
    };
    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => apply((r) => r[col] === val);
    builder.in = (col: string, vals: unknown[]) => apply((r) => vals.includes(r[col]));
    builder.is = (col: string, val: null) => apply((r) => (r[col] ?? null) === val);
    builder.not = (col: string, op: string, val: unknown) => {
      if (op === "is" && val === null) return apply((r) => r[col] != null);
      return builder;
    };
    builder.gt = (col: string, val: unknown) =>
      apply((r) => r[col] != null && (r[col] as number) > (val as number));
    builder.gte = (col: string, val: unknown) =>
      apply((r) => r[col] != null && String(r[col]) >= String(val));
    builder.lte = (col: string, val: unknown) =>
      apply((r) => r[col] != null && String(r[col]) <= String(val));
    builder.order = () => builder;
    builder.limit = (n: number) => {
      rows = rows.slice(0, n);
      return builder;
    };
    builder.then = (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF);
    return builder;
  }
  return { from } as unknown as SupabaseClient;
}

function makeCachedRow(region: string, date: string, freshness: number, ctx: Record<string, unknown> = {}): Row {
  return {
    user_id: "u1",
    region,
    snapshot_date: date,
    freshness_score: freshness,
    context: ctx,
  };
}

describe("getRegionFreshnessDetail — cache-backed read path", () => {
  it("returns cached 14-day strip when today's row exists (no live needed)", async () => {
    const today = todayYmd();
    const rows: Row[] = [];
    // 14 cached rows ending today.
    for (let i = 13; i >= 0; i--) {
      rows.push(makeCachedRow("knee", addDays(today, -i), 0.5 + i * 0.01));
    }
    const supabase = makeStub({
      region_state_history: rows,
      region_state: [
        { user_id: "u1", region: "knee", atl: 1, ctl: 2, baseline_tolerance: 5, last_load_date: today },
      ],
      sessions: [],
    });
    const out = await getRegionFreshnessDetail(supabase, "u1", "UTC");
    expect(out).toHaveLength(1);
    const knee = out[0];
    expect(knee.region).toBe("knee");
    expect(knee.history).toHaveLength(14);
    // The live derivation runs with empty sessions → ATL=0 → freshness=1.
    // That replaces today's cached value at the tail. The first 13 points
    // remain the cached values.
    expect(knee.history[0]).toBeCloseTo(0.5 + 13 * 0.01);
    expect(knee.history[12]).toBeCloseTo(0.5 + 1 * 0.01);
    expect(knee.currentFreshness).toBeCloseTo(1);
  });

  it("falls back to live for today when cron hasn't snapshotted (appends)", async () => {
    const today = todayYmd();
    // Cached rows for the last 13 days, but NOT today.
    const rows: Row[] = [];
    for (let i = 13; i >= 1; i--) {
      rows.push(makeCachedRow("knee", addDays(today, -i), 0.4));
    }
    const supabase = makeStub({
      region_state_history: rows,
      region_state: [
        { user_id: "u1", region: "knee", atl: 0, ctl: 0, baseline_tolerance: 5, last_load_date: addDays(today, -2) },
      ],
      sessions: [],
    });
    const out = await getRegionFreshnessDetail(supabase, "u1", "UTC");
    expect(out).toHaveLength(1);
    const knee = out[0];
    // 13 cached + 1 live appended.
    expect(knee.history).toHaveLength(14);
    // Live freshness with no sessions and baseline > 0 → ATL=0 → 1.
    expect(knee.history[13]).toBeCloseTo(1);
    expect(knee.currentFreshness).toBeCloseTo(1);
    // lastLoadDate comes from the live region_state row.
    expect(knee.lastLoadDate).toBe(addDays(today, -2));
  });

  it("omits region with no cache and no live signal", async () => {
    const supabase = makeStub({
      region_state_history: [],
      region_state: [],
      sessions: [],
    });
    const out = await getRegionFreshnessDetail(supabase, "u1", "UTC");
    expect(out).toEqual([]);
  });

  it("14-day window math: cached row at today-13 is included, today-14 is filtered by query", async () => {
    const today = todayYmd();
    // Provide rows at boundaries — the stub's gte filter on
    // snapshot_date >= windowStart (today-13) drops the today-14 row.
    const supabase = makeStub({
      region_state_history: [
        makeCachedRow("knee", addDays(today, -14), 0.1), // out of window
        makeCachedRow("knee", addDays(today, -13), 0.2), // boundary in
        makeCachedRow("knee", addDays(today, -1), 0.3),
        makeCachedRow("knee", today, 0.4),
      ],
      region_state: [
        { user_id: "u1", region: "knee", atl: 0, ctl: 0, baseline_tolerance: 5, last_load_date: today },
      ],
      sessions: [],
    });
    const out = await getRegionFreshnessDetail(supabase, "u1", "UTC");
    expect(out).toHaveLength(1);
    // 3 cached rows in-window; the today entry gets replaced by live (1.0).
    expect(out[0].history).toEqual([
      expect.closeTo(0.2),
      expect.closeTo(0.3),
      expect.closeTo(1.0),
    ]);
  });

  it("today-already-snapshotted: live value replaces today (no 15th point)", async () => {
    const today = todayYmd();
    const rows: Row[] = [];
    for (let i = 13; i >= 0; i--) {
      rows.push(makeCachedRow("knee", addDays(today, -i), 0.5));
    }
    const supabase = makeStub({
      region_state_history: rows,
      region_state: [
        { user_id: "u1", region: "knee", atl: 0, ctl: 0, baseline_tolerance: 5, last_load_date: null },
      ],
      sessions: [],
    });
    const out = await getRegionFreshnessDetail(supabase, "u1", "UTC");
    expect(out[0].history).toHaveLength(14);
    // Today (last) is replaced by live (1.0), not appended.
    expect(out[0].history[13]).toBeCloseTo(1);
  });
});
