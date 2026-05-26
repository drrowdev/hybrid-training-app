/**
 * Unit tests for `endBlock` server action.
 *
 * The action's two contracts:
 *   1. Status flips to 'archived'.
 *   2. Both `archived_at` AND `ended_at` are set to NOW() — the lifecycle
 *      timestamps introduced in migration 0025. We assert both columns
 *      receive the same instant so historical stats can rely on them.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type BlockRow = {
  id: string;
  status: "active" | "completed" | "archived";
  archetype: string;
  weeks: number;
  started_on: string;
  archived_at: string | null;
  ended_at: string | null;
};

const store: { blocks: BlockRow[] } = { blocks: [] };
const overrideInserts: Array<Record<string, unknown>> = [];

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({
        data: { user: { id: "11111111-2222-2222-2222-222222222222" } },
      }),
    },
    from: (table: string) => {
      const state: {
        update?: Partial<BlockRow>;
        inserts: Array<Record<string, unknown>>;
        eqs: Array<[string, unknown]>;
      } = { eqs: [], inserts: [] };
      const q: Record<string, (...a: never[]) => unknown> = {
        select: (() => q) as (...a: never[]) => unknown,
        update: ((patch: Partial<BlockRow>) => {
          state.update = patch;
          return q as unknown;
        }) as (...a: never[]) => unknown,
        insert: ((row: Record<string, unknown>) => {
          state.inserts.push(row);
          if (table === "engine_override_events") {
            overrideInserts.push(row);
          }
          return q as unknown;
        }) as (...a: never[]) => unknown,
        eq: ((col: string, val: unknown) => {
          state.eqs.push([col, val]);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        maybeSingle: (() =>
          Promise.resolve({
            data:
              table === "training_blocks"
                ? store.blocks.find((b) =>
                    state.eqs.every(
                      ([c, v]) =>
                        (b as unknown as Record<string, unknown>)[c] === v,
                    ),
                  ) ?? null
                : state.inserts[0] ?? null,
            error: null,
          })) as (...a: never[]) => unknown,
        then: ((resolve: (v: { data: unknown; error: null }) => unknown) => {
          if (state.update) {
            for (const row of store.blocks) {
              if (
                state.eqs.every(
                  ([c, v]) =>
                    (row as unknown as Record<string, unknown>)[c] === v,
                )
              ) {
                Object.assign(row, state.update);
              }
            }
          }
          const data =
            table === "planned_sessions"
              ? []
              : state.inserts.length > 0
                ? state.inserts
                : [];
          return Promise.resolve(resolve({ data, error: null }));
        }) as (...a: never[]) => unknown,
      };
      return q;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: "11111111-2222-2222-2222-222222222222" } }, error: null }),
}));

describe("endBlock", () => {
  beforeEach(() => {
    store.blocks = [
      {
        id: "11111111-1111-1111-1111-111111111111",
        status: "active",
        archetype: "strength_anchor",
        weeks: 4,
        started_on: "2026-01-01",
        archived_at: null,
        ended_at: null,
      },
    ];
    overrideInserts.length = 0;
  });

  it("flips status to 'archived' and sets both archived_at AND ended_at", async () => {
    const { endBlock } = await import("../actions");
    const fd = new FormData();
    fd.set("id", "11111111-1111-1111-1111-111111111111");
    const before = Date.now();
    await endBlock(fd);
    const after = Date.now();
    const blk = store.blocks[0]!;
    expect(blk.status).toBe("archived");
    expect(blk.archived_at).toBeTruthy();
    expect(blk.ended_at).toBeTruthy();
    // Both timestamps captured in the same UPDATE → identical instant.
    expect(blk.archived_at).toBe(blk.ended_at);
    const ts = new Date(blk.archived_at!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it("inserts an override-audit row with event_type='manual_end'", async () => {
    const { endBlock } = await import("../actions");
    const fd = new FormData();
    fd.set("id", "11111111-1111-1111-1111-111111111111");
    fd.set("reason", "Switching to a deload block");
    await endBlock(fd);
    expect(overrideInserts.length).toBeGreaterThanOrEqual(1);
    const row = overrideInserts[0]!;
    expect(row.event_type).toBe("manual_end");
    expect(row.block_id).toBe("11111111-1111-1111-1111-111111111111");
    expect(row.reason).toBe("Switching to a deload block");
    const ctx = row.context as Record<string, unknown>;
    expect(ctx.archetype).toBe("strength_anchor");
    expect(ctx.weeks).toBe(4);
  });

  it("rejects malformed ids without touching state", async () => {
    const { endBlock } = await import("../actions");
    const fd = new FormData();
    fd.set("id", "not-a-uuid");
    await expect(endBlock(fd)).rejects.toThrow();
    const blk = store.blocks[0]!;
    expect(blk.status).toBe("active");
    expect(blk.archived_at).toBeNull();
    expect(blk.ended_at).toBeNull();
    expect(overrideInserts).toHaveLength(0);
  });
});
