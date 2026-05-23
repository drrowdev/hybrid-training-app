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
  archived_at: string | null;
  ended_at: string | null;
};

const store: { blocks: BlockRow[] } = { blocks: [] };

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (_table: string) => {
      void _table;
      const state: { update?: Partial<BlockRow>; eqs: Array<[string, unknown]> } = {
        eqs: [],
      };
      const q: Record<string, (...a: never[]) => unknown> = {
        update: ((patch: Partial<BlockRow>) => {
          state.update = patch;
          return q as unknown;
        }) as (...a: never[]) => unknown,
        eq: ((col: string, val: unknown) => {
          state.eqs.push([col, val]);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        then: ((resolve: (v: { error: null }) => unknown) => {
          if (state.update) {
            for (const row of store.blocks) {
              if (state.eqs.every(([c, v]) => (row as unknown as Record<string, unknown>)[c] === v)) {
                Object.assign(row, state.update);
              }
            }
          }
          return Promise.resolve(resolve({ error: null }));
        }) as (...a: never[]) => unknown,
      };
      return q;
    },
  }),
}));

describe("endBlock", () => {
  beforeEach(() => {
    store.blocks = [
      { id: "11111111-1111-1111-1111-111111111111", status: "active", archived_at: null, ended_at: null },
    ];
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

  it("rejects malformed ids without touching state", async () => {
    const { endBlock } = await import("../actions");
    const fd = new FormData();
    fd.set("id", "not-a-uuid");
    await expect(endBlock(fd)).rejects.toThrow();
    const blk = store.blocks[0]!;
    expect(blk.status).toBe("active");
    expect(blk.archived_at).toBeNull();
    expect(blk.ended_at).toBeNull();
  });
});
