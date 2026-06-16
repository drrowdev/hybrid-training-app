/**
 * Per-block two-a-day resolution in `buildBlockAssemblyContext` (migration 0110).
 *
 * Proves the resolution contract that moves the two-a-day choice from the global
 * profile setting to a per-block value:
 *   (a) `allowsTwoADays: true`  → uses the curated two-a-day day pool (AM/PM slots);
 *   (b) `allowsTwoADays` null/undefined → falls back to the profile value, byte-
 *       identical to the pre-0110 read (so existing callers / existing blocks are
 *       unchanged);
 *   (c) per-block `false` OVERRIDES a profile `true`.
 *
 * The heavy DB collaborators (picker catalog, limitations, timezone, accessory
 * history) are stubbed; the direct reads (profiles / events / movements /
 * training_maxes) are served by a small chainable supabase mock so the build
 * reaches a successful `ctx` whose `activeDays` reveal the chosen day pool.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

vi.mock("../picker-catalog", () => ({
  // Non-empty so the `pickerCatalog.length === 0` guard passes; the build only
  // checks length, assembly (not exercised here) is what actually consumes it.
  loadPickerCatalog: vi.fn().mockResolvedValue([
    { id: "cat_1", slug: "cat-1", roles: [] },
  ]),
}));
vi.mock("../limitations-context", () => ({
  readLimitationsContext: vi.fn().mockResolvedValue({
    blockedRegions: new Set<string>(),
    blockedMuscles: new Set<string>(),
    blockedMovementIds: new Set<string>(),
    allowedMovementIds: new Set<string>(),
    tendinopathyActive: false,
  }),
}));
vi.mock("../cardio-catalog", () => ({
  loadCardioCatalog: vi.fn().mockResolvedValue([]),
}));
vi.mock("../accessory-history-queries", () => ({
  getPreviousBlockAccessoryIdsByRole: vi.fn().mockResolvedValue(new Map()),
}));
vi.mock("../queries", () => ({
  getUserTimezone: vi.fn().mockResolvedValue("UTC"),
}));
vi.mock("@/lib/stats/region-spike-queries", () => ({
  getElbowForearmAtlRatio: vi.fn().mockResolvedValue(1.0),
}));

import { buildBlockAssemblyContext } from "../build-block-assembly-context";

/**
 * Minimal chainable supabase mock. Each `.from(table)` returns a fresh builder
 * that is both awaitable (resolves to `{ data, error }`) and exposes
 * `maybeSingle()`. Movement rows are synthesised for every requested slug (all
 * in-band, all TM-backed) so strength-day resolution always succeeds.
 */
function makeSupabase(profile: Record<string, unknown> | null): SupabaseClient {
  function builderFor(table: string) {
    let inCol: string | null = null;
    let inVals: string[] = [];

    function dataFor(): { data: unknown; error: null } {
      if (table === "movements") {
        const slugs = inCol === "slug" ? inVals : [];
        return {
          data: slugs.map((slug) => ({
            id: `mv_${slug}`,
            slug,
            display_name: slug,
            experience_min: 0,
            experience_max: 4,
          })),
          error: null,
        };
      }
      if (table === "training_maxes") {
        const ids = inCol === "movement_id" ? inVals : [];
        return {
          data: ids.map((id) => ({ movement_id: id, updated_at: "2026-01-01T00:00:00Z" })),
          error: null,
        };
      }
      return { data: [], error: null };
    }

    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: () => builder,
      is: () => Promise.resolve(dataFor()),
      gte: () => builder,
      order: () => builder,
      limit: () => builder,
      in: (col: string, vals: string[]) => {
        inCol = col;
        inVals = vals;
        return builder;
      },
      maybeSingle: () =>
        Promise.resolve(
          table === "profiles" ? { data: profile, error: null } : { data: null, error: null },
        ),
      then: (resolve: (v: unknown) => unknown) => resolve(dataFor()),
    };
    return builder;
  }

  return {
    from: vi.fn((table: string) => builderFor(table)),
  } as unknown as SupabaseClient;
}

const baseInput = {
  archetypeId: "concurrent_hybrid" as const,
  startedOn: "2026-01-05",
  daysPerWeek: 6,
  dayIndexOverrides: null,
  powerEmphasis: false,
  focusMuscles: [] as const,
  cardioSource: "internal" as const,
  cardioSourceName: null,
};

function hasTwoADaySlots(activeDays: ReadonlyArray<{ slot?: string }>): boolean {
  return activeDays.some((d) => d.slot === "am" || d.slot === "pm");
}

describe("buildBlockAssemblyContext — per-block two-a-day (migration 0110)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("(a) allowsTwoADays: true uses the two-a-day day pool", async () => {
    const supabase = makeSupabase({ allows_two_a_days: false });
    const res = await buildBlockAssemblyContext(supabase, "user-1", {
      ...baseInput,
      allowsTwoADays: true,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ctx.allowsTwoADays).toBe(true);
    expect(hasTwoADaySlots(res.ctx.activeDays)).toBe(true);
  });

  it("(b) undefined falls back to the profile value (byte-identical)", async () => {
    // Profile says two-a-day ON, caller passes nothing → profile wins.
    const onlyProfileOn = await buildBlockAssemblyContext(
      makeSupabase({ allows_two_a_days: true }),
      "user-1",
      baseInput, // no allowsTwoADays key
    );
    expect(onlyProfileOn.ok).toBe(true);
    if (!onlyProfileOn.ok) return;
    expect(onlyProfileOn.ctx.allowsTwoADays).toBe(true);
    expect(hasTwoADaySlots(onlyProfileOn.ctx.activeDays)).toBe(true);

    // Profile says OFF, caller passes nothing → profile wins (single sessions).
    const onlyProfileOff = await buildBlockAssemblyContext(
      makeSupabase({ allows_two_a_days: false }),
      "user-1",
      baseInput,
    );
    expect(onlyProfileOff.ok).toBe(true);
    if (!onlyProfileOff.ok) return;
    expect(onlyProfileOff.ctx.allowsTwoADays).toBe(false);
    expect(hasTwoADaySlots(onlyProfileOff.ctx.activeDays)).toBe(false);

    // Explicit null behaves identically to undefined (the column-null / legacy case).
    const explicitNull = await buildBlockAssemblyContext(
      makeSupabase({ allows_two_a_days: true }),
      "user-1",
      { ...baseInput, allowsTwoADays: null },
    );
    expect(explicitNull.ok).toBe(true);
    if (!explicitNull.ok) return;
    expect(explicitNull.ctx.allowsTwoADays).toBe(true);
  });

  it("(c) per-block false overrides a profile true", async () => {
    const supabase = makeSupabase({ allows_two_a_days: true });
    const res = await buildBlockAssemblyContext(supabase, "user-1", {
      ...baseInput,
      allowsTwoADays: false,
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.ctx.allowsTwoADays).toBe(false);
    expect(hasTwoADaySlots(res.ctx.activeDays)).toBe(false);
  });
});
