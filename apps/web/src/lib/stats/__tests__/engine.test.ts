/**
 * Phase 6 engine-page helper tests.
 *
 * The helpers in `lib/stats/engine.ts` mix pure derivation with Supabase
 * queries. We pin the pure boundaries here and use a minimal in-file
 * chainable mock for the I/O-shaped paths — small enough to stay
 * readable and avoid pulling fake-supabase into a table-set it wasn't
 * designed for (region_state, count(head:true)).
 *
 * Coverage matrix:
 *  - btsToTier — DC-G3 thresholds (boundary cases).
 *  - getCeilingExplain — DC-C11 arithmetic with known inputs.
 *  - getDecisionTrace — reproduces the documented reason string given a
 *    seeded block + region_state snapshot.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  btsToTier,
  getCeilingExplain,
  getDecisionTrace,
  getUserTier,
} from "../engine";

type Row = Record<string, unknown>;

type Tables = Record<string, Row[]>;

type Counts = Record<string, number>;

/**
 * Tiny chainable PostgREST-like stub. Just enough surface for the
 * three helpers under test: select/eq/gte/not/is/order/limit/maybeSingle
 * + `select(_, { count: 'exact', head: true })` returning `{count}`.
 *
 * Tables are matched by name; row filters are applied left-to-right.
 */
function makeStub(tables: Tables, counts: Counts = {}): SupabaseClient {
  function from(table: string) {
    let rows = (tables[table] ?? []).slice();
    let headCount: { active: boolean; key: string } | null = null;
    const builder: Record<string, unknown> = {};
    const apply = (pred: (r: Row) => boolean) => {
      rows = rows.filter(pred);
      return builder;
    };
    builder.select = (
      _cols: string,
      opts?: { count?: "exact"; head?: boolean },
    ) => {
      if (opts?.head && opts.count === "exact") {
        headCount = { active: true, key: table };
      }
      return builder;
    };
    builder.eq = (col: string, val: unknown) => apply((r) => r[col] === val);
    builder.neq = (col: string, val: unknown) => apply((r) => r[col] !== val);
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
    builder.order = () => builder;
    builder.limit = (n: number) => {
      rows = rows.slice(0, n);
      return builder;
    };
    builder.maybeSingle = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.single = () => Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.then = (onF: (v: { data: unknown; count?: number; error: null }) => unknown) => {
      if (headCount?.active) {
        const k = headCount.key;
        const c = counts[k] ?? rows.length;
        return Promise.resolve({ data: null, count: c, error: null }).then(onF);
      }
      return Promise.resolve({ data: rows, error: null }).then(onF);
    };
    return builder;
  }
  return { from } as unknown as SupabaseClient;
}

describe("btsToTier — DC-G3 thresholds", () => {
  it("BTS 0..49 → consumer", () => {
    expect(btsToTier(0)).toBe("consumer");
    expect(btsToTier(49)).toBe("consumer");
  });
  it("BTS 50..74 → intermediate (boundary)", () => {
    expect(btsToTier(50)).toBe("intermediate");
    expect(btsToTier(74)).toBe("intermediate");
  });
  it("BTS 75..100 → high_performance (boundary)", () => {
    expect(btsToTier(75)).toBe("high_performance");
    expect(btsToTier(100)).toBe("high_performance");
  });
});

describe("getCeilingExplain — DC-K1 / DC-C9 / DC-C11 / DC-C13", () => {
  it("true cold start (no planned sessions, no sessions, no sets) → cold_start_conservative", async () => {
    // 0 recovered weeks in the lookback → DC-C13 ladder collapses
    // base to 0 (min of 0 last-4 volumes × 0.9) and pins
    // confidenceBias at 0.8.
    const supabase = makeStub(
      { sessions: [], wellness: [], planned_sessions: [], set_logs: [], training_blocks: [] },
      { sessions: 0 },
    );
    const out = await getCeilingExplain(supabase, "user-1");
    expect(out.formula).toBe("cold_start_conservative");
    expect(out.recoveryMultiplier).toBe(1.0);
    expect(out.confidenceBias).toBe(0.8);
    expect(out.baseCeiling).toBe(0);
    expect(out.finalCeiling).toBe(0);
    expect(out.inputs.recoveredWeeksCount).toBe(0);
    // Cold-start conservative shows the last 4 weeks for context (all
    // with `included: false`) — the "we don't trust the data" surface.
    expect(out.basisWeeks).toHaveLength(4);
    expect(out.basisWeeks.every((b) => !b.included)).toBe(true);
    expect(out.inputs.notes.some((n) => /No fully recovered weeks|cold start/i.test(n))).toBe(true);
  });

  it("returns the new explainer shape with basisWeeks + formula tag (DC-K1)", async () => {
    const supabase = makeStub(
      { sessions: [], wellness: [], planned_sessions: [], set_logs: [], training_blocks: [] },
      { sessions: 0 },
    );
    const out = await getCeilingExplain(supabase, "user-1");
    // Shape contract — the page imports these fields.
    expect(Array.isArray(out.basisWeeks)).toBe(true);
    expect(typeof out.formula).toBe("string");
    expect(out.inputs.notes.length).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────
  // Audit J3 / B4 — daily wellness sliders wire into recoveryMultiplier.
  // These cover the integration plumbing (Promise.all batch, today vs
  // recent split, finalCeiling propagation, null fallback). The pure
  // band math is exercised in lib/engine/__tests__/wellness-recovery.test.ts.
  // ───────────────────────────────────────────────────────────────────
  const ymdOffset = (days: number): string => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it("falls back to 1.0 when no wellness rows exist (preserves pre-PR behaviour)", async () => {
    const supabase = makeStub(
      { sessions: [], wellness: [], planned_sessions: [], set_logs: [], training_blocks: [] },
      { sessions: 0 },
    );
    const out = await getCeilingExplain(supabase, "user-1");
    expect(out.recoveryMultiplier).toBe(1.0);
    expect(
      out.inputs.notes.some((n) => /no daily check-in logged today/i.test(n)),
    ).toBe(true);
  });

  it("falls back to 1.0 when today is logged but baseline is too short (<3 points)", async () => {
    const supabase = makeStub(
      {
        sessions: [],
        wellness: [
          { user_id: "user-1", date: ymdOffset(0), fatigue: 5, soreness: 5 },
          { user_id: "user-1", date: ymdOffset(-1), fatigue: 5, soreness: 5 },
          { user_id: "user-1", date: ymdOffset(-2), fatigue: 5, soreness: 5 },
        ],
        planned_sessions: [],
        set_logs: [],
        training_blocks: [],
      },
      { sessions: 0 },
    );
    const out = await getCeilingExplain(supabase, "user-1");
    expect(out.recoveryMultiplier).toBe(1.0);
    expect(
      out.inputs.notes.some((n) => /not enough recent check-ins/i.test(n)),
    ).toBe(true);
  });

  it("applies a sub-1.0 multiplier when today is more fatigued than the 7-day average", async () => {
    // Baseline averages to score ~3 (fresh). Today is 7 (cooked) →
    // delta ≈ +4 → floor 0.70.
    const supabase = makeStub(
      {
        sessions: [],
        wellness: [
          { user_id: "user-1", date: ymdOffset(0), fatigue: 7, soreness: 7 },
          { user_id: "user-1", date: ymdOffset(-1), fatigue: 3, soreness: 3 },
          { user_id: "user-1", date: ymdOffset(-2), fatigue: 3, soreness: 3 },
          { user_id: "user-1", date: ymdOffset(-3), fatigue: 3, soreness: 3 },
          { user_id: "user-1", date: ymdOffset(-4), fatigue: 3, soreness: 3 },
        ],
        planned_sessions: [],
        set_logs: [],
        training_blocks: [],
      },
      { sessions: 0 },
    );
    const out = await getCeilingExplain(supabase, "user-1");
    expect(out.recoveryMultiplier).toBe(0.7);
    // baseCeiling is 0 for this cold-start scenario, so finalCeiling
    // still computes — but the relationship must hold regardless.
    expect(out.finalCeiling).toBeCloseTo(
      out.baseCeiling * 0.7 * out.confidenceBias,
      10,
    );
    expect(
      out.inputs.notes.some((n) => /more fatigued than your 7-day average/i.test(n)),
    ).toBe(true);
  });

  it("applies a >1.0 multiplier when today is fresher than the 7-day average", async () => {
    // Baseline averages to score ~7 (chronically cooked). Today is 3 →
    // delta = -4 → ceiling 1.10.
    const supabase = makeStub(
      {
        sessions: [],
        wellness: [
          { user_id: "user-1", date: ymdOffset(0), fatigue: 3, soreness: 3 },
          { user_id: "user-1", date: ymdOffset(-1), fatigue: 7, soreness: 7 },
          { user_id: "user-1", date: ymdOffset(-2), fatigue: 7, soreness: 7 },
          { user_id: "user-1", date: ymdOffset(-3), fatigue: 7, soreness: 7 },
          { user_id: "user-1", date: ymdOffset(-4), fatigue: 7, soreness: 7 },
        ],
        planned_sessions: [],
        set_logs: [],
        training_blocks: [],
      },
      { sessions: 0 },
    );
    const out = await getCeilingExplain(supabase, "user-1");
    expect(out.recoveryMultiplier).toBe(1.1);
    expect(
      out.inputs.notes.some((n) => /fresher than your 7-day average/i.test(n)),
    ).toBe(true);
  });
});

describe("getUserTier — DC-G1..G6 inference", () => {
  it("cold start (no profile, no TMs, no sessions) → consumer + low confidence (DC-G5)", async () => {
    const supabase = makeStub(
      { profiles: [], training_maxes: [], planned_sessions: [], sessions: [] },
      { sessions: 0 },
    );
    const out = await getUserTier(supabase, "u1");
    expect(out.tier).toBe("consumer");
    expect(out.inferred).toBe("consumer");
    expect(out.isColdStart).toBe(true);
    expect(out.confidence).toBe("low");
    expect(out.declared).toBeNull();
    expect(out.mismatch).toBe(false);
  });

  it("declared intermediate_2y_5y with no observed data → intermediate, declared wins", async () => {
    const supabase = makeStub(
      {
        profiles: [
          { id: "u1", training_experience: "intermediate_2y_5y", bodyweight_kg: null },
        ],
        training_maxes: [],
        planned_sessions: [],
        sessions: [],
      },
      { sessions: 0 },
    );
    const out = await getUserTier(supabase, "u1");
    expect(out.tier).toBe("intermediate");
    expect(out.declared).toBe("intermediate");
    expect(out.declaredYearsLabel).toMatch(/2\s*\S\s*5 years/i);
    // Inferred falls back to declared when no signal → no mismatch.
    expect(out.mismatch).toBe(false);
    expect(out.isColdStart).toBe(false);
  });

  it("declared advanced_5y_10y but no observed strength data still falls back to declared tier", async () => {
    const supabase = makeStub(
      {
        profiles: [
          { id: "u1", training_experience: "advanced_5y_10y", bodyweight_kg: 80 },
        ],
        training_maxes: [],
        planned_sessions: [],
        sessions: [],
      },
      { sessions: 0 },
    );
    const out = await getUserTier(supabase, "u1");
    expect(out.tier).toBe("high_performance");
    expect(out.declared).toBe("high_performance");
  });

  it("declared highly_advanced_10y_plus maps to high_performance", async () => {
    const supabase = makeStub(
      {
        profiles: [
          {
            id: "u1",
            training_experience: "highly_advanced_10y_plus",
            bodyweight_kg: 80,
          },
        ],
        training_maxes: [],
        planned_sessions: [],
        sessions: [],
      },
      { sessions: 0 },
    );
    const out = await getUserTier(supabase, "u1");
    expect(out.tier).toBe("high_performance");
    expect(out.declared).toBe("high_performance");
    expect(out.declaredYearsLabel).toMatch(/10\+ years/);
  });

  it("declared beginner_lt_6m maps to consumer", async () => {
    const supabase = makeStub(
      {
        profiles: [
          { id: "u1", training_experience: "beginner_lt_6m", bodyweight_kg: null },
        ],
        training_maxes: [],
        planned_sessions: [],
        sessions: [],
      },
      { sessions: 0 },
    );
    const out = await getUserTier(supabase, "u1");
    expect(out.tier).toBe("consumer");
    expect(out.declared).toBe("consumer");
  });
});

describe("getDecisionTrace — narration from live engine state", () => {
  it("no active block → 'no block' headline + setup CTA", async () => {
    const supabase = makeStub({ training_blocks: [], region_state: [], planned_sessions: [] });
    const out = await getDecisionTrace(supabase, "u1", "UTC");
    expect(out.noBlock).toBe(true);
    expect(out.headline).toMatch(/no active block/i);
    expect(out.reasons[0]?.text).toMatch(/plan page/i);
  });

  it("active block + planned session today → headline + cited reasons", async () => {
    const today = new Date().toISOString().slice(0, 10);
    // Block started today so we're in week 0 day 0.
    const block = {
      id: "b1",
      archetype: "strength_anchor",
      started_on: today,
      weeks: 4,
      status: "active",
      deleted_at: null,
      user_id: "u1",
      notes: null,
    };
    const day = new Date(today + "T00:00:00Z").getUTCDay();
    // dayDate math uses ISO weekday (Mon=0..Sun=6) starting from block Monday.
    const isoWeekday = (day + 6) % 7;
    const planned = {
      block_id: "b1",
      week_index: 0,
      day_index: isoWeekday,
      slot: "single",
      title: "Squat day",
      role: "primary",
      prescription: { items: [{ kind: "main", movementName: "Back Squat" }] },
    };
    const region_state = [
      {
        user_id: "u1",
        region: "knee",
        atl: 1,
        baseline_tolerance: 10, // freshness = 0.9 → fresh
      },
      {
        user_id: "u1",
        region: "shoulder_scapular",
        atl: 6,
        baseline_tolerance: 10, // freshness = 0.4 → primed
      },
    ];
    const supabase = makeStub({
      training_blocks: [block],
      planned_sessions: [planned],
      region_state,
    });
    const out = await getDecisionTrace(supabase, "u1", "UTC");
    expect(out.noBlock).toBe(false);
    expect(out.restDay).toBe(false);
    expect(out.headline).toContain("Squat day");
    expect(out.headline).toContain("Back Squat");
    // First bullet cites the archetype + week (DC-F1).
    expect(out.reasons[0]?.cite).toBe("DC-F1");
    expect(out.reasons[0]?.text).toMatch(/Strength Focus/);
    // Region freshness bullet present (DC-C14).
    const freshnessBullet = out.reasons.find((r) => r.cite === "DC-C14");
    expect(freshnessBullet).toBeTruthy();
    expect(freshnessBullet?.text).toMatch(/fresh|primed|loaded/);
    // Top-set intensity bullet (DC-C11).
    const intensityBullet = out.reasons.find((r) => r.cite === "DC-C11");
    expect(intensityBullet?.text).toMatch(/TM/);
  });

  it("active block + no planned session today → rest-day narration", async () => {
    const today = new Date().toISOString().slice(0, 10);
    const block = {
      id: "b1",
      archetype: "strength_anchor",
      started_on: today,
      weeks: 4,
      status: "active",
      deleted_at: null,
      user_id: "u1",
      notes: null,
    };
    const supabase = makeStub({
      training_blocks: [block],
      planned_sessions: [], // nothing planned for today
      region_state: [],
    });
    const out = await getDecisionTrace(supabase, "u1", "UTC");
    expect(out.restDay).toBe(true);
    expect(out.headline).toMatch(/rest day/i);
    expect(out.reasons.some((r) => r.cite === "DC-E1")).toBe(true);
  });
});
