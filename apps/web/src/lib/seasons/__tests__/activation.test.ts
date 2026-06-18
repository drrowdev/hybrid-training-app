/**
 * Unit tests for `activateSeasonBlock` (ADR 0051 Phase 0, slice D).
 *
 * Contract:
 *   - a still-PLANNED, user-owned target flips to active + links block_id, and
 *     any prior ACTIVE block in the same season flips to done;
 *   - a missing / foreign / non-planned target is a complete no-op (no writes).
 *
 * The Supabase client is faked: the lookup returns a configurable row and every
 * `.update(...).eq(...)` chain is captured so we can assert the writes.
 */
import { describe, it, expect, vi } from "vitest";

// The helper imports "server-only" (a guard that throws outside RSC); stub it
// so the module loads under vitest's node environment.
vi.mock("server-only", () => ({}));

import { activateSeasonBlock } from "../activation";

type Update = { patch: Record<string, unknown>; eqs: Array<[string, unknown]> };

function fakeSupabase(lookup: Record<string, unknown> | null) {
  const updates: Update[] = [];
  const client = {
    from: (_table: string) => {
      const chain = {
        // select(...).eq(...).eq(...).maybeSingle()
        select: () => chain,
        update: (patch: Record<string, unknown>) => {
          const u: Update = { patch, eqs: [] };
          updates.push(u);
          const upChain = {
            eq: (col: string, val: unknown) => {
              u.eqs.push([col, val]);
              return upChain;
            },
          };
          return upChain;
        },
        eq: () => chain,
        maybeSingle: () => Promise.resolve({ data: lookup, error: null }),
      };
      return chain;
    },
  };
  return { client, updates };
}

const USER = "11111111-1111-1111-1111-111111111111";
const SEASON = "22222222-2222-2222-2222-222222222222";
const SEASON_BLOCK = "33333333-3333-3333-3333-333333333333";
const NEW_BLOCK = "44444444-4444-4444-4444-444444444444";

describe("activateSeasonBlock", () => {
  it("flips prior active → done and the planned target → active + links block_id", async () => {
    const { client, updates } = fakeSupabase({
      id: SEASON_BLOCK,
      season_id: SEASON,
      status: "planned",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await activateSeasonBlock(client as any, USER, SEASON_BLOCK, NEW_BLOCK);

    expect(updates).toHaveLength(2);
    // 1) prior active → done, scoped to the season + user.
    expect(updates[0]!.patch).toEqual({ status: "done" });
    expect(updates[0]!.eqs).toContainEqual(["season_id", SEASON]);
    expect(updates[0]!.eqs).toContainEqual(["user_id", USER]);
    expect(updates[0]!.eqs).toContainEqual(["status", "active"]);
    // 2) target → active + block link, guarded on planned.
    expect(updates[1]!.patch).toEqual({ status: "active", block_id: NEW_BLOCK });
    expect(updates[1]!.eqs).toContainEqual(["id", SEASON_BLOCK]);
    expect(updates[1]!.eqs).toContainEqual(["user_id", USER]);
    expect(updates[1]!.eqs).toContainEqual(["status", "planned"]);
  });

  it("is a no-op when the target is missing (foreign / stale id)", async () => {
    const { client, updates } = fakeSupabase(null);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await activateSeasonBlock(client as any, USER, SEASON_BLOCK, NEW_BLOCK);
    expect(updates).toHaveLength(0);
  });

  it("is a no-op when the target is not planned (already active/done)", async () => {
    const { client, updates } = fakeSupabase({
      id: SEASON_BLOCK,
      season_id: SEASON,
      status: "active",
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await activateSeasonBlock(client as any, USER, SEASON_BLOCK, NEW_BLOCK);
    expect(updates).toHaveLength(0);
  });
});
