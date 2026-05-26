/**
 * Regression test for the perf-audit F6 fix in `getSisterMovements`.
 *
 * The previous implementation awaited each peer's working-set fetch
 * sequentially. We now `Promise.all(...)` over peers, so 6 peers fire
 * 6 concurrent reads and the wall time is `max(...)` not `sum(...)`.
 *
 * The test installs a stub Supabase client that:
 *   1. Returns the global movements catalogue from `.from("movements")`.
 *   2. Returns a controlled-delay set_logs result from `.from("set_logs")`
 *      and records the timestamps when each call starts.
 *
 * If the calls are sequential the start gaps are ≥ DELAY_MS; if they are
 * parallel all start gaps fit inside a single DELAY_MS window.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSisterMovements } from "../movement";

const SELF_ID = "self-id";

const PEER_CATALOG: Array<{
  id: string;
  slug: string;
  display_name: string;
  pattern: string;
  functional_roles: string[];
}> = [
  { id: "p1", slug: "low-bar-back-squat", display_name: "Low-Bar Back Squat", pattern: "squat", functional_roles: ["knee_dom"] },
  { id: "p2", slug: "front-squat", display_name: "Front Squat", pattern: "squat", functional_roles: ["knee_dom"] },
  { id: "p3", slug: "safety-bar-squat", display_name: "Safety Bar Squat", pattern: "squat", functional_roles: ["knee_dom"] },
  { id: "p4", slug: "hack-squat", display_name: "Hack Squat", pattern: "squat", functional_roles: ["knee_dom"] },
  { id: "p5", slug: "goblet-squat", display_name: "Goblet Squat", pattern: "squat", functional_roles: ["knee_dom"] },
  { id: "p6", slug: "zercher-squat", display_name: "Zercher Squat", pattern: "squat", functional_roles: ["knee_dom"] },
  {
    id: SELF_ID,
    slug: "high-bar-back-squat",
    display_name: "High-Bar Back Squat",
    pattern: "squat",
    functional_roles: ["knee_dom"],
  },
];

function makeStubSupabase(opts: {
  delayMs: number;
  onSetLogsCall: (movementId: string, t: number) => void;
}): SupabaseClient {
  return {
    from(table: string) {
      if (table === "movements") {
        // Return the global catalogue.
        const q = {
          select() { return q; },
          eq() { return q; },
          is() { return Promise.resolve({ data: PEER_CATALOG, error: null }); },
        };
        return q;
      }
      if (table === "set_logs") {
        let movementId = "";
        const q = {
          select() { return q; },
          eq(col: string, value: unknown) {
            if (col === "movement_id") movementId = value as string;
            return q;
          },
          is() { return q; },
          not() { return q; },
          neq() { return q; },
          gt() { return q; },
          order() {
            opts.onSetLogsCall(movementId, Date.now());
            return new Promise((resolve) =>
              setTimeout(
                () => resolve({ data: [], error: null }),
                opts.delayMs,
              ),
            );
          },
        };
        return q;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as SupabaseClient;
}

describe("getSisterMovements", () => {
  it("returns one result per scored peer (up to limit) with matching shape", async () => {
    const calls: Array<{ movementId: string; t: number }> = [];
    const supabase = makeStubSupabase({
      delayMs: 0,
      onSetLogsCall: (movementId, t) => calls.push({ movementId, t }),
    });
    const result = await getSisterMovements(
      supabase,
      "user-1",
      { id: SELF_ID, pattern: "squat", functionalRoles: ["knee_dom"] },
      6,
    );
    // Six peers scored above zero (shared pattern + role overlap),
    // self filtered out.
    expect(result).toHaveLength(6);
    for (const r of result) {
      expect(r.id).not.toBe(SELF_ID);
      expect(typeof r.slug).toBe("string");
      expect(typeof r.displayName).toBe("string");
      // No set_logs in the stub ⇒ e1rm is null but the field is present.
      expect(r.e1rm).toBeNull();
    }
    // Each peer triggers exactly one set_logs lookup.
    expect(calls).toHaveLength(6);
    expect(new Set(calls.map((c) => c.movementId)).size).toBe(6);
  });

  it("issues peer queries in parallel (Promise.all), not serially", async () => {
    const DELAY_MS = 25;
    const calls: Array<{ movementId: string; t: number }> = [];
    const supabase = makeStubSupabase({
      delayMs: DELAY_MS,
      onSetLogsCall: (movementId, t) => calls.push({ movementId, t }),
    });
    const start = Date.now();
    await getSisterMovements(
      supabase,
      "user-1",
      { id: SELF_ID, pattern: "squat", functionalRoles: ["knee_dom"] },
      6,
    );
    const elapsed = Date.now() - start;
    // 6 parallel ~DELAY_MS waits should finish well under serial cost
    // (6 × DELAY_MS = 150ms). Generous upper bound so CI jitter
    // doesn't flake.
    expect(elapsed).toBeLessThan(DELAY_MS * 3);
    // All call timestamps land within one DELAY_MS window of the first.
    const firstT = calls[0]!.t;
    const spread = Math.max(...calls.map((c) => c.t)) - firstT;
    expect(spread).toBeLessThan(DELAY_MS);
  });
});
