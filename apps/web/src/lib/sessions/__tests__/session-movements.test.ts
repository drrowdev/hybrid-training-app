/**
 * session_movements server-action tests.
 *
 * Asserts the add/remove contract that backs the freestyle persistence
 * flow now that the two race-prone read+write sequences live behind
 * Postgres RPCs (`add_session_movement`, `remove_session_movement`).
 *
 * The atomicity itself is a property of the SQL — we don't try to
 * exercise true concurrency in a unit test. What we *do* assert here:
 *   - add: the action calls the RPC exactly once with the right args
 *     and does NOT do a separate SELECT max(sort_order) anymore.
 *   - remove: the action calls the RPC exactly once and surfaces the
 *     `has_set_logs` reason as the expected user-facing error;
 *     `not_present` is treated as success.
 *   - ownership / completed-session guards still live in the action
 *     layer and short-circuit before the RPC fires.
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

type RpcCall = { fn: string; args: Record<string, unknown> };

const store: {
  sessions: SessionRow[];
  sessionMovements: SessionMovementRow[];
  setLogs: SetLogRow[];
  currentUserId: string;
  rpcCalls: RpcCall[];
  selectCalls: string[];
} = {
  sessions: [],
  sessionMovements: [],
  setLogs: [],
  currentUserId: SELF_USER,
  rpcCalls: [],
  selectCalls: [],
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

  const handleRpc = (fn: string, args: Record<string, unknown>) => {
    store.rpcCalls.push({ fn, args });

    if (fn === "add_session_movement") {
      const sessionId = args.p_session_id as string;
      const movementId = args.p_movement_id as string;
      const userId = args.p_user_id as string;
      const existing = store.sessionMovements.find(
        (r) => r.session_id === sessionId && r.movement_id === movementId,
      );
      if (existing) {
        return {
          data: [
            {
              session_id: existing.session_id,
              movement_id: existing.movement_id,
              sort_order: existing.sort_order,
            },
          ],
          error: null,
        };
      }
      const maxSort = store.sessionMovements
        .filter((r) => r.session_id === sessionId)
        .reduce((acc, r) => Math.max(acc, r.sort_order), 0);
      const sortOrder = maxSort + 10;
      store.sessionMovements.push({
        session_id: sessionId,
        movement_id: movementId,
        user_id: userId,
        sort_order: sortOrder,
        added_at: new Date().toISOString(),
      });
      return {
        data: [{ session_id: sessionId, movement_id: movementId, sort_order: sortOrder }],
        error: null,
      };
    }

    if (fn === "remove_session_movement") {
      const sessionId = args.p_session_id as string;
      const movementId = args.p_movement_id as string;
      const hasLogs = store.setLogs.some(
        (sl) => sl.session_id === sessionId && sl.movement_id === movementId,
      );
      if (hasLogs) {
        return { data: [{ deleted: false, reason: "has_set_logs" }], error: null };
      }
      const before = store.sessionMovements.length;
      store.sessionMovements = store.sessionMovements.filter(
        (r) => !(r.session_id === sessionId && r.movement_id === movementId),
      );
      if (store.sessionMovements.length === before) {
        return { data: [{ deleted: true, reason: "not_present" }], error: null };
      }
      return { data: [{ deleted: true, reason: "removed" }], error: null };
    }

    return { data: null, error: { message: `unmocked rpc ${fn}` } };
  };

  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: store.currentUserId } } }) },
      rpc: (fn: string, args: Record<string, unknown>) =>
        Promise.resolve(handleRpc(fn, args)),
      from: (table: string) => {
        const state: {
          op?: "select";
          eqs: Array<[string, unknown]>;
          ises: Array<[string, unknown]>;
          selectedTable: string;
        } = { eqs: [], ises: [], selectedTable: table };

        const filtered = () =>
          tableRows(table).filter((r) => matches(r, state.eqs, state.ises));

        const builder: Record<string, unknown> = {};
        const api = {
          select: ((_cols?: string) => {
            state.op = "select";
            store.selectCalls.push(table);
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
          maybeSingle: (() => {
            if (state.op === "select") {
              const rows = filtered();
              return Promise.resolve({ data: rows[0] ?? null, error: null });
            }
            return Promise.resolve({ data: null, error: null });
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
  store.rpcCalls = [];
  store.selectCalls = [];
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

  it("only calls the add_session_movement RPC — no separate SELECT max(sort_order)", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    await addSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    const adds = store.rpcCalls.filter((c) => c.fn === "add_session_movement");
    expect(adds).toHaveLength(1);
    expect(adds[0]!.args).toEqual({
      p_session_id: SESSION_ID,
      p_movement_id: MOVEMENT_ID,
      p_user_id: SELF_USER,
    });
    // The only table SELECT the action should still do is the
    // ownership read on `sessions`; it must NOT read `session_movements`
    // anymore — that lookup is now atomic with the insert inside the RPC.
    expect(store.selectCalls).not.toContain("session_movements");
    expect(store.selectCalls).toContain("sessions");
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
    // Ownership check must short-circuit before the RPC fires.
    expect(store.rpcCalls).toHaveLength(0);
  });

  it("rejects once the session is completed", async () => {
    const { addSessionMovementAction } = await import("../session-movement-actions");
    const result = await addSessionMovementAction(COMPLETED_SESSION_ID, MOVEMENT_ID);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/completed/i);
    expect(store.sessionMovements).toHaveLength(0);
    expect(store.rpcCalls).toHaveLength(0);
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
    const removes = store.rpcCalls.filter((c) => c.fn === "remove_session_movement");
    expect(removes).toHaveLength(1);
    expect(removes[0]!.args).toEqual({
      p_session_id: SESSION_ID,
      p_movement_id: MOVEMENT_ID,
    });
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
    // The RPC returned has_set_logs; the action must not retry or
    // fall back to a delete path.
    const removes = store.rpcCalls.filter((c) => c.fn === "remove_session_movement");
    expect(removes).toHaveLength(1);
  });

  it("treats already-removed (not_present) as success without an error", async () => {
    const { removeSessionMovementAction } = await import("../session-movement-actions");
    // Nothing in session_movements for (SESSION_ID, MOVEMENT_ID), no
    // set_logs either → RPC reports not_present.
    const result = await removeSessionMovementAction(SESSION_ID, MOVEMENT_ID);
    expect(result).toEqual({ ok: true });
    const removes = store.rpcCalls.filter((c) => c.fn === "remove_session_movement");
    expect(removes).toHaveLength(1);
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
    // Ownership check must short-circuit before the RPC fires.
    expect(store.rpcCalls).toHaveLength(0);
  });
});
