/**
 * Unit tests for the soft-delete contract on `sessions`.
 *
 * Mirrors the canonical pattern from `end-block.test.ts` — a minimal
 * in-memory mock store stands in for Supabase so we can assert the
 * exact column writes without spinning up Postgres.
 *
 * Contract under test (AGENTS.md DC-K4):
 *   - `deleteSession` flips `deleted_at` to a timestamp; the row is
 *     NOT removed.
 *   - `restoreSession` flips `deleted_at` back to NULL.
 *   - `permanentlyDeleteSession` actually removes the row.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type SessionRow = {
  id: string;
  user_id: string;
  performed_at: string;
  deleted_at: string | null;
};

const SELF_USER = "00000000-0000-0000-0000-000000000001";
const SESSION_ID = "11111111-1111-1111-1111-111111111111";

const store: { sessions: SessionRow[] } = { sessions: [] };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/engine/region-ledger", () => ({ recomputeRegionState: vi.fn() }));
vi.mock("@/lib/planner/completion", () => ({ maybeCompleteBlock: vi.fn() }));
vi.mock("@/lib/planner/queries", () => ({ getUserTimezone: async () => "UTC" }));

vi.mock("@/lib/supabase/server", () => {
  const matches = (row: SessionRow, eqs: Array<[string, unknown]>, ises: Array<[string, unknown]>) => {
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
          patch?: Partial<SessionRow>;
          eqs: Array<[string, unknown]>;
          ises: Array<[string, unknown]>;
        } = { eqs: [], ises: [] };
        const builder: Record<string, unknown> = {};
        const run = () => {
          if (table !== "sessions") return { data: [], error: null };
          if (state.op === "update") {
            for (const row of store.sessions) {
              if (matches(row, state.eqs, state.ises)) Object.assign(row, state.patch);
            }
            return { data: null, error: null };
          }
          if (state.op === "delete") {
            const keep: SessionRow[] = [];
            for (const row of store.sessions) {
              if (!matches(row, state.eqs, state.ises)) keep.push(row);
            }
            store.sessions = keep;
            return { data: null, error: null };
          }
          return { data: null, error: null };
        };
        const api = {
          select: (() => builder) as (...a: never[]) => unknown,
          update: ((patch: Partial<SessionRow>) => {
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
  store.sessions = [
    {
      id: SESSION_ID,
      user_id: SELF_USER,
      performed_at: "2026-05-01T10:00:00Z",
      deleted_at: null,
    },
  ];
});

describe("deleteSession (soft-delete)", () => {
  it("sets deleted_at to NOW() without removing the row", async () => {
    const { deleteSession } = await import("../actions");
    const fd = new FormData();
    fd.set("id", SESSION_ID);
    const before = Date.now();
    const result = await deleteSession(fd);
    const after = Date.now();

    expect(result.ok).toBe(true);
    expect(store.sessions).toHaveLength(1);
    const row = store.sessions[0]!;
    expect(row.deleted_at).toBeTruthy();
    const ts = new Date(row.deleted_at!).getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
    if (result.ok) {
      expect(result.sessionId).toBe(SESSION_ID);
      expect(result.restoreUrl).toContain(SESSION_ID);
    }
  });
});

describe("restoreSession", () => {
  it("nulls deleted_at", async () => {
    store.sessions[0]!.deleted_at = new Date().toISOString();
    const { restoreSession } = await import("../actions");
    const result = await restoreSession(SESSION_ID);
    expect(result.ok).toBe(true);
    expect(store.sessions[0]!.deleted_at).toBeNull();
  });
});

describe("permanentlyDeleteSession", () => {
  it("hard-removes the row", async () => {
    store.sessions[0]!.deleted_at = new Date().toISOString();
    const { permanentlyDeleteSession } = await import("../actions");
    const result = await permanentlyDeleteSession(SESSION_ID);
    expect(result.ok).toBe(true);
    expect(store.sessions).toHaveLength(0);
  });
});
