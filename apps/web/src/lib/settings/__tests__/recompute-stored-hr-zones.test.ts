import { describe, it, expect } from "vitest";
import { recomputeStoredHrZones } from "../hr-zones-actions";
import type { ZoneBands } from "@/lib/stats/hr-zones";

const BANDS: ZoneBands = { z1Max: 121, z2Max: 142, z3Max: 163, z4Max: 183 };

/**
 * Minimal supabase stub for the recompute path:
 *   from("cardio_logs").select(...).eq(...).not(...) → { data: rows }
 *   from("cardio_logs").update({hr_zones}).eq("id", id) → { error: null }
 */
function makeSupabase(rows: Array<{ id: string; hr_histogram: Record<string, number> | null }>) {
  const updates: Array<{ id: string; hr_zones: Record<string, number> }> = [];
  const supabase = {
    from() {
      return {
        select() {
          return {
            eq() {
              return {
                not() {
                  return Promise.resolve({ data: rows, error: null });
                },
              };
            },
          };
        },
        update(patch: { hr_zones: Record<string, number> }) {
          return {
            eq(_col: string, id: string) {
              updates.push({ id, hr_zones: patch.hr_zones });
              return Promise.resolve({ error: null });
            },
          };
        },
      };
    },
  };
  return { supabase, updates };
}

describe("recomputeStoredHrZones", () => {
  it("returns 0 and writes nothing when bands are null", async () => {
    const { supabase, updates } = makeSupabase([
      { id: "a", hr_histogram: { "150": 600 } },
    ]);
    const n = await recomputeStoredHrZones(supabase as never, "u1", null);
    expect(n).toBe(0);
    expect(updates).toHaveLength(0);
  });

  it("re-buckets each row's histogram into fresh hr_zones", async () => {
    const { supabase, updates } = makeSupabase([
      { id: "a", hr_histogram: { "115": 60, "150": 600 } },
      { id: "b", hr_histogram: { "190": 120 } },
    ]);
    const n = await recomputeStoredHrZones(supabase as never, "u1", BANDS);
    expect(n).toBe(2);
    expect(updates).toEqual([
      { id: "a", hr_zones: { z1: 60, z2: 0, z3: 600, z4: 0, z5: 0 } },
      { id: "b", hr_zones: { z1: 0, z2: 0, z3: 0, z4: 0, z5: 120 } },
    ]);
  });

  it("skips rows whose histogram can't be bucketed", async () => {
    const { supabase, updates } = makeSupabase([
      { id: "a", hr_histogram: null },
      { id: "b", hr_histogram: {} },
    ]);
    const n = await recomputeStoredHrZones(supabase as never, "u1", BANDS);
    expect(n).toBe(0);
    expect(updates).toHaveLength(0);
  });
});
