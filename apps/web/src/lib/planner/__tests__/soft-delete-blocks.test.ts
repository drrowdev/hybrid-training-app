/**
 * Unit tests for the soft-delete contract on `training_blocks`.
 *
 * Same in-memory mock pattern as the sessions soft-delete tests.
 *
 * Contract under test (AGENTS.md DC-K4):
 *   - `deleteBlock` sets `deleted_at`; the row stays.
 *   - `restoreBlock` nulls `deleted_at`.
 *   - `permanentlyDeleteBlock` actually removes the row.
 *   - `deleteBlock` is DISTINCT from `endBlock` — it must NOT write
 *     status='archived' (that's the user-visible archive intent;
 *     delete is "remove from history, recoverable for 30 days").
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type BlockRow = {
  id: string;
  user_id: string;
  status: "active" | "completed" | "archived";
  deleted_at: string | null;
  archived_at: string | null;
};

const SELF_USER = "00000000-0000-0000-0000-000000000001";
const BLOCK_ID = "22222222-2222-2222-2222-222222222222";

const store: { blocks: BlockRow[] } = { blocks: [] };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/supabase/server", () => {
  const matches = (row: BlockRow, eqs: Array<[string, unknown]>, ises: Array<[string, unknown]>) => {
    for (const [c, v] of eqs) if ((row as unknown as Record<string, unknown>)[c] !== v) return false;
    for (const [c, v] of ises) if ((row as unknown as Record<string, unknown>)[c] !== v) return false;
    return true;
  };

  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: SELF_USER } } }) },
      from: (table: string) => {
        const state: {
          op?: "update" | "delete";
          patch?: Partial<BlockRow>;
          eqs: Array<[string, unknown]>;
          ises: Array<[string, unknown]>;
        } = { eqs: [], ises: [] };
        const builder: Record<string, unknown> = {};
        const run = () => {
          if (table !== "training_blocks") return { data: [], error: null };
          if (state.op === "update") {
            for (const row of store.blocks) {
              if (matches(row, state.eqs, state.ises)) Object.assign(row, state.patch);
            }
            return { data: null, error: null };
          }
          if (state.op === "delete") {
            const keep: BlockRow[] = [];
            for (const row of store.blocks) {
              if (!matches(row, state.eqs, state.ises)) keep.push(row);
            }
            store.blocks = keep;
            return { data: null, error: null };
          }
          return { data: null, error: null };
        };
        const api = {
          select: (() => builder) as (...a: never[]) => unknown,
          update: ((patch: Partial<BlockRow>) => {
            state.op = "update";
            state.patch = patch;
            return builder;
          }) as (...a: never[]) => unknown,
          delete: (() => {
            state.op = "delete";
            return builder;
          }) as (...a: never[]) => unknown,
          eq: ((col: string, val: unknown) => {
            state.eqs.push([col, val]);
            return builder;
          }) as (...a: never[]) => unknown,
          is: ((col: string, val: unknown) => {
            state.ises.push([col, val]);
            return builder;
          }) as (...a: never[]) => unknown,
          order: (() => builder) as (...a: never[]) => unknown,
          limit: (() => builder) as (...a: never[]) => unknown,
          then: ((resolve: (v: unknown) => unknown) => Promise.resolve(resolve(run()))) as (...a: never[]) => unknown,
        };
        Object.assign(builder, api);
        return builder;
      },
    }),
    getAuthUser: async () => ({ data: { user: { id: SELF_USER } }, error: null }),
  };
});

beforeEach(() => {
  store.blocks = [
    {
      id: BLOCK_ID,
      user_id: SELF_USER,
      status: "active",
      deleted_at: null,
      archived_at: null,
    },
  ];
});

describe("deleteBlock (soft-delete)", () => {
  it("sets deleted_at to NOW() without removing the row", async () => {
    const { deleteBlock } = await import("../actions");
    const fd = new FormData();
    fd.set("id", BLOCK_ID);
    const before = Date.now();
    const result = await deleteBlock(fd);
    const after = Date.now();

    expect(result.ok).toBe(true);
    expect(store.blocks).toHaveLength(1);
    const row = store.blocks[0]!;
    expect(row.deleted_at).toBeTruthy();
    const ts = new Date(row.deleted_at!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    if (result.ok) expect(result.blockId).toBe(BLOCK_ID);
  });

  it("does NOT write status='archived' (delete is distinct from endBlock)", async () => {
    const { deleteBlock } = await import("../actions");
    const fd = new FormData();
    fd.set("id", BLOCK_ID);
    await deleteBlock(fd);
    expect(store.blocks[0]!.status).toBe("active");
    expect(store.blocks[0]!.archived_at).toBeNull();
  });
});

describe("restoreBlock", () => {
  it("nulls deleted_at", async () => {
    store.blocks[0]!.deleted_at = new Date().toISOString();
    const { restoreBlock } = await import("../actions");
    const result = await restoreBlock(BLOCK_ID);
    expect(result.ok).toBe(true);
    expect(store.blocks[0]!.deleted_at).toBeNull();
  });
});

describe("permanentlyDeleteBlock", () => {
  it("hard-removes the row", async () => {
    store.blocks[0]!.deleted_at = new Date().toISOString();
    const { permanentlyDeleteBlock } = await import("../actions");
    const result = await permanentlyDeleteBlock(BLOCK_ID);
    expect(result.ok).toBe(true);
    expect(store.blocks).toHaveLength(0);
  });
});
