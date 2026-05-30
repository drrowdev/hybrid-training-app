/**
 * Tests for the ADR 0012 previous-block accessory history query.
 *
 * Uses a hand-rolled fake supabase client (no new deps) implementing just
 * the query-builder surface the helper touches. Focuses on the row →
 * Map<role, Set<movementId>> shaping and the graceful-empty fallbacks.
 */
import { describe, expect, it } from "vitest";
import { getPreviousBlockAccessoryIdsByRole } from "../accessory-history-queries";

type Row = Record<string, unknown>;

function fakeSupabase(tables: Record<string, Row[]>) {
  const builder = (rows: Row[]) => {
    const q: Record<string, unknown> = {
      select: () => q,
      eq: () => q,
      order: () => q,
      limit: () => q,
      then: <T,>(fn: (v: { data: Row[]; error: null }) => T) =>
        Promise.resolve(fn({ data: rows, error: null })),
    };
    return q;
  };
  return {
    from: (table: string) => builder(tables[table] ?? []),
  } as unknown as Parameters<typeof getPreviousBlockAccessoryIdsByRole>[0];
}

const item = (movementId: string, kind: string) => ({ movementId, kind });

describe("getPreviousBlockAccessoryIdsByRole (ADR 0012)", () => {
  it("returns an empty map for a user with no prior block", async () => {
    const out = await getPreviousBlockAccessoryIdsByRole(fakeSupabase({}), "u");
    expect(out.size).toBe(0);
  });

  it("groups accessory + power-primer movement ids by day-role", async () => {
    const supabase = fakeSupabase({
      training_blocks: [{ id: "blk1" }],
      planned_sessions: [
        {
          role: "primary",
          prescription: {
            items: [
              item("main-squat", "main"),
              item("acc-chinup", "accessory"),
              item("primer-jump", "power_potentiation"),
            ],
          },
        },
        {
          role: "secondary",
          prescription: { items: [item("acc-dip", "accessory")] },
        },
      ],
    });
    const out = await getPreviousBlockAccessoryIdsByRole(supabase, "u");
    expect([...(out.get("primary") ?? [])].sort()).toEqual(["acc-chinup", "primer-jump"]);
    expect([...(out.get("secondary") ?? [])]).toEqual(["acc-dip"]);
    // The main lift is NOT a rotatable kind and must be excluded.
    expect(out.get("primary")?.has("main-squat")).toBe(false);
  });

  it("skips rows with no role and rows with a malformed prescription", async () => {
    const supabase = fakeSupabase({
      training_blocks: [{ id: "blk1" }],
      planned_sessions: [
        { role: null, prescription: { items: [item("acc-x", "accessory")] } },
        { role: "primary", prescription: null },
        { role: "primary", prescription: { items: [item("acc-row", "accessory")] } },
      ],
    });
    const out = await getPreviousBlockAccessoryIdsByRole(supabase, "u");
    expect(out.size).toBe(1);
    expect([...(out.get("primary") ?? [])]).toEqual(["acc-row"]);
  });
});
