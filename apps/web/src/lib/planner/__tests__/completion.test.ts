/**
 * Unit tests for maybeCompleteBlock.
 *
 * Models the Supabase REST surface with an in-memory store keyed by
 * table name so each test can compose its own minimal world. We pin
 * the four cases called out in the PR spec:
 *
 *   1. Block 1/28 done       → stays 'active'
 *   2. Block 28/28 done      → flips to 'completed'
 *   3. Block already archived → never overwritten (manual wins)
 *   4. Block already completed → idempotent no-op
 */
import { describe, it, expect, beforeEach } from "vitest";
import { maybeCompleteBlock } from "../completion";
import type { SupabaseClient } from "@supabase/supabase-js";

type Block = { id: string; status: "active" | "completed" | "archived" };
type Planned = {
  id: string;
  block_id: string;
  completed_session_id: string | null;
  skipped_at: string | null;
};

type Store = {
  training_blocks: Block[];
  planned_sessions: Planned[];
};

function makeClient(store: Store) {
  function builder(table: keyof Store) {
    const state: {
      eqs: Array<[string, unknown]>;
      iss: Array<[string, unknown]>;
      head: boolean;
      countMode: boolean;
      update?: Record<string, unknown>;
      single?: boolean;
    } = { eqs: [], iss: [], head: false, countMode: false };

    function matches(row: Record<string, unknown>): boolean {
      return (
        state.eqs.every(([col, val]) => row[col] === val) &&
        state.iss.every(([col, val]) => row[col] === val)
      );
    }

    function resolveSelect(): {
      data: unknown;
      count: number | null;
      error: null;
    } {
      const rows = (store[table] as Record<string, unknown>[]).filter(matches);
      if (state.head) {
        return { data: null, count: rows.length, error: null };
      }
      if (state.single) {
        return { data: rows[0] ?? null, count: null, error: null };
      }
      return { data: rows, count: null, error: null };
    }

    function resolveUpdate(): { data: null; error: null } {
      const rows = store[table] as Record<string, unknown>[];
      for (const row of rows) {
        if (matches(row) && state.update) Object.assign(row, state.update);
      }
      return { data: null, error: null };
    }

    const q: Record<string, (...a: never[]) => unknown> = {
      select: ((_proj?: string, opts?: { count?: string; head?: boolean }) => {
        if (opts?.count === "exact") state.countMode = true;
        if (opts?.head) state.head = true;
        return q as unknown;
      }) as (...a: never[]) => unknown,
      eq: ((col: string, val: unknown) => {
        state.eqs.push([col, val]);
        return q as unknown;
      }) as (...a: never[]) => unknown,
      is: ((col: string, val: unknown) => {
        state.iss.push([col, val]);
        return q as unknown;
      }) as (...a: never[]) => unknown,
      update: ((patch: Record<string, unknown>) => {
        state.update = patch;
        return q as unknown;
      }) as (...a: never[]) => unknown,
      maybeSingle: () => {
        state.single = true;
        return Promise.resolve(resolveSelect());
      },
      then: ((
        resolve: (v: ReturnType<typeof resolveSelect>) => unknown,
      ) => {
        const out = state.update ? resolveUpdate() : resolveSelect();
        return Promise.resolve(resolve(out as ReturnType<typeof resolveSelect>));
      }) as (...a: never[]) => unknown,
    };
    return q;
  }

  return {
    from: (table: string) => builder(table as keyof Store),
  } as unknown as SupabaseClient;
}

function seedBlock(
  status: Block["status"],
  total: number,
  completed: number,
): Store {
  const blockId = "blk-1";
  const planned: Planned[] = [];
  for (let i = 0; i < total; i++) {
    planned.push({
      id: `ps-${i}`,
      block_id: blockId,
      completed_session_id: i < completed ? `s-${i}` : null,
      skipped_at: null,
    });
  }
  return {
    training_blocks: [{ id: blockId, status }],
    planned_sessions: planned,
  };
}

describe("maybeCompleteBlock", () => {
  let store: Store;
  beforeEach(() => {
    store = seedBlock("active", 28, 1);
  });

  it("leaves 'active' alone when sessions remain (1/28 done)", async () => {
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "blk-1");
    expect(store.training_blocks[0]!.status).toBe("active");
  });

  it("flips to 'completed' when every planned session is linked (28/28)", async () => {
    store = seedBlock("active", 28, 28);
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "blk-1");
    expect(store.training_blocks[0]!.status).toBe("completed");
  });

  it("flips to 'completed' when all sessions are either linked or skipped", async () => {
    store = seedBlock("active", 4, 3);
    // mark the last one as skipped
    store.planned_sessions[3]!.skipped_at = "2026-05-01T00:00:00Z";
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "blk-1");
    expect(store.training_blocks[0]!.status).toBe("completed");
  });

  it("never overwrites 'archived' (manual end wins)", async () => {
    store = seedBlock("archived", 28, 28);
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "blk-1");
    expect(store.training_blocks[0]!.status).toBe("archived");
  });

  it("is idempotent on 'completed'", async () => {
    store = seedBlock("completed", 28, 28);
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "blk-1");
    expect(store.training_blocks[0]!.status).toBe("completed");
  });

  it("does nothing for a block with zero planned_sessions (never started)", async () => {
    store = {
      training_blocks: [{ id: "blk-1", status: "active" }],
      planned_sessions: [],
    };
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "blk-1");
    expect(store.training_blocks[0]!.status).toBe("active");
  });

  it("does nothing for a missing block id", async () => {
    const sb = makeClient(store);
    await maybeCompleteBlock(sb, "does-not-exist");
    expect(store.training_blocks[0]!.status).toBe("active");
  });
});
