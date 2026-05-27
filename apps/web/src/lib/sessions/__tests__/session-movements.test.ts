/**
 * session_movements server-action tests.
 *
 * Asserts the add/remove contract that backs the freestyle persistence
 * flow:
 *   - add: success, repeat is no-op, unauthorised user blocked,
 *     completed session is blocked.
 *   - remove: success, blocked when any set_logs row exists for the
 *     pair, unauthorised user blocked.
 *
 * Mirrors the in-memory-store mock pattern from `soft-delete.test.ts`
 * and `swap-actions.test.ts` so we don't pull in a real Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type SessionRow = {
  id: string;
  user_id: string;
  completed_at: string | null;
  deleted_at: string | null;
};
type SessionMovementRow = {
  session_id: string;
  movement_id: string;
  user_id: string;
  sort_order: number;
  added_at: string;
};
type SetLogRow = {
  id: string;
  session_id: string;
  movement_id: string;
};

const SELF_USER = "00000000-0000-4000-8000-000000000001";
const OTHER_USER = "00000000-0000-4000-8000-000000000002";
const SESSION_ID = "10000000-0000-4000-8000-000000000010";
const OTHER_SESSION_ID = "10000000-0000-4000-8000-000000000011";
const COMPLETED_SESSION_ID = "10000000-0000-4000-8000-000000000012";
const MOVEMENT_ID = "20000000-0000-4000-8000-0000000000a1";
const MOVEMENT_ID_2 = "20000000-0000-4000-8000-0000000000a2";

const store: {
  sessions: SessionRow[];
  sessionMovements: SessionMovementRow[];
  setLogs: SetLogRow[];
  currentUserId: string;
} = {
  sessions: [],
  sessionMovements: [],
  setLogs: [],
  currentUserId: SELF_USER,
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => {
  const matches = (
    row: Record<string, unknown>,
    eqs: Array<[string, unknown]>,
    ises: Array<[string, unknown]>,
  ) => {
    for (const [c, v] of eqs) if (row[c] !== v) return false;
    for (const [c, v] of ises) if (row[c] !== v) return false;
    return true;
  };

  const tableRows = (table: string): Record<string, unknown>[] => {
    if (table === "sessions") return store.sessions as unknown as Record<string, unknown>[];
    if (table === "session_movements")
      return store.sessionMovements as unknown as Record<string, unknown>[];
    if (table === "set_logs") return store.setLogs as unknown as Record<string, unknown>[];
    return [];
  };

  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: store.currentUserId } } }) },
      from: (table: string) => {
        const state: {
          op?: "select" | "upsert" | "delete";
          upsertRow?: Record<string, unknown>;
          upsertOpts?: { onConflict?: string; ignoreDuplicates?: boolean };
          eqs: Array<[string, unknown]>;
          ises: Array<[string, unknown]>;
          orderCol?: string;
          orderAsc?: boolean;
          limitN?: number;
          headCount?: boolean;
        } = { eqs: [], ises: [] };

        const filtered = () =>
          tableRows(table).filter((r) => matches(r, state.eqs, state.ises));

        const builder: Record<string, unknown> = {};
        const api = {
          select: ((_cols?: string, opts?: { count?: string; head?: boolean }) => {
            state.op = "select";
            if (opts?.head) state.headCount = true;
            return builder;
          }) as (...a: never[]) => unknown,
          upsert: ((
            row: Record<string, unknown>,
            opts?: { onConflict?: string; ignoreDuplicates?: boolean },
          ) => {
            state.op = "upsert";
            state.upsertRow = row;
            state.upsertOpts = opts;
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
          order: ((col: string, opts?: { ascending?: boolean }) => {
            state.orderCol = col;
            state.orderAsc = opts?.ascending ?? true;
            return builder;
          }) as (...a: never[]) => unknown,
          limit: ((n: number) => {
            state.limitN = n;
            return builder;
          }) as (...a: never[]) => unknown,
          maybeSingle: (() => {
            if (state.op === "select") {
              let rows = filtered();
              if (state.orderCol) {
                const col = state.orderCol;
                const asc = state.orderAsc ?? true;
                rows = [...rows].sort((a, b) => {
                  const av = (a[col] as number | string | null) ?? 0;
                  const bv = (b[col] as number | string | null) ?? 0;
                  return av < bv ? (asc ? -1 : 1) : av > bv ? (asc ? 1 : -1) : 0;
                });
              }
              if (state.limitN != null) rows = rows.slice(0, state.limitN);
              return Promise.resolve({ data: rows[0] ?? null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
          }) as (...a: never[]) => unknown,
          then: ((resolve: (v: unknown) => unknown) => {
            if (state.op === "upsert") {
              const row = state.upsertRow!;
              const pk = (state.upsertOpts?.onConflict ?? "").split(",");
              const exists = (
                store.sessionMovements as unknown as Record<string, unknown>[]
              ).some((r) => pk.every((c) => r[c] === row[c]));
              if (!exists) {
                store.sessionMovements.push({
                  session_id: row.session_id as string,
                  movement_id: row.movement_id as string,
                  user_id: row.user_id as string,
                  sort_order: row.sort_order as number,
                  added_at: new Date().toISOString(),
                });
              } else if (!state.upsertOpts?.ignoreDuplicates) {
                // emulate update-on-conflict (unused today)
                const idx = (
                  store.sessionMovements as unknown as Record<string, unknown>[]
                ).findIndex((r) => pk.every((c) => r[c] === row[c]));
                Object.assign(store.sessionMovements[idx]!, row);
              }
              return Promise.resolve(resolve({ data: null, error: null, count: null }));
            }
            if (state.op === "delete") {
              const before = tableRows(table).length;
              const kept = tableRows(table).filter((r) => !matches(r, state.eqs, state.ises));
              if (table === "session_movements") {
                store.sessionMovements = kept as unknown as SessionMovementRow[];
              }
              return Promise.resolve(
                resolve({ data: null, error: null, count: before - kept.length }),
              );
            }
            if (state.op === "select" && state.headCount) {
              return Promise.resolve(
                resolve({ data: null, error: null, count: filtered().length }),
              );
            }
            return Promise.resolve(resolve({ data: filtered(), error: null }));
          }) as (...a: never[]) => unknown,
        };
        Object.assign(builder, api);
        return builder;
      },
    }),
    getAuthUser: async () => ({
      data: { user: { id: store.currentUserId } },
      error: null,
    }),
  };
});

beforeEach(() => {
  store.currentUserId = SELF_USER;
  store.sessions = [
    {
      id: SESSION_ID,
      user_id: SELF_USER,
      completed_at: null,
      deleted_at: null,
    },
    {
      id: OTHER_SESSION_ID,
      user_id: OTHER_USER,
      completed_at: null,
      deleted_at: null,
    },
    {
      id: COMPLETED_SESSION_ID,
      user_id: SELF_USER,
      completed_at: "2026-05-01T11:00:00Z",
      deleted_at: null,
    },
  ];
  store.sessionMovements = [];
  store.setLogs = [];
});

describe("addSessionMovementAction", () => {
  it("inserts a row at sort_order 10 on the first add", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    const result = await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    expect(result).toEqual({ ok: true });
    expect(store.sessionMovements).toHaveLength(1);
    const row = store.sessionMovements[0]!;
    expect(row.session_id).toBe(SESSION_ID);
    expect(row.movement_id).toBe(MOVEMENT_ID);
    expect(row.user_id).toBe(SELF_USER);
    expect(row.sort_order).toBe(10);
  });

  it("assigns max+10 sort_order on subsequent adds", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    const r = await addSessionMovementAction(SESSION_ID, MOVEMENT_ID_2);
    expect(r).toEqual({ ok: true });
    const second = store.sessionMovements.find((m) => m.movement_id === MOVEMENT_ID_2)!;
    expect(second.sort_order).toBe(20);
  });

  it("is idempotent — repeated add of the same movement is a no-op", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    const result = await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    expect(result).toEqual({ ok: true });
    expect(store.sessionMovements).toHaveLength(1);
  });

  it("rejects when the session is not owned by the caller", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    const result = await addSessionMovementAction(OTHER_SESSION_ID, MOVEMENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
    expect(store.sessionMovements).toHaveLength(0);
  });

  it("rejects once the session is completed", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    const result = await addSessionMovementAction(COMPLETED_SESSION_ID, MOVEMENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/completed/i);
    expect(store.sessionMovements).toHaveLength(0);
  });
});

describe("removeSessionMovementAction", () => {
  it("hard-deletes the row when no set has been logged", async () => {
    const { addSessionMovementAction, removeSessionMovementAction } = await import(
      "../session-movement-actions"
    );
    await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    const result = await removeSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    expect(result).toEqual({ ok: true });
    expect(store.sessionMovements).toHaveLength(0);
  });

  it("refuses removal once any set_logs row exists for the pair", async () => {
    const { addSessionMovementAction, removeSessionMovementAction } = await import(
      "../session-movement-actions"
    );
    await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    store.setLogs.push({ id: "sl-1", session_id: SESSION_ID, movement_id: MOVEMENT_ID });
    const result = await removeSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/Done with this movement/i);
    expect(store.sessionMovements).toHaveLength(1);
  });

  it("rejects when the session is not owned by the caller", async () => {
    const { removeSessionMovementAction } = await import("../session-movement-actions");
    // Pre-seed a row owned by OTHER_USER so the delete *could* succeed
    // if ownership weren't checked first.
    store.sessionMovements.push({
      session_id: OTHER_SESSION_ID,
      movement_id: MOVEMENT_ID,
      user_id: OTHER_USER,
      sort_order: 10,
      added_at: new Date().toISOString(),
    });
    const result = await removeSessionMovementAction(OTHER_SESSION_ID, MOVEMENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not found/i);
    expect(store.sessionMovements).toHaveLength(1);
  });
});
