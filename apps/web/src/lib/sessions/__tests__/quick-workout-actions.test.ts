/**
 * Quick-workout server-action tests.
 *
 * Covers the Today-page entry points:
 *   - startQuickStrengthSession → empty session, returns the new id
 *   - repeatRecentSession      → clone strength shape (movements only);
 *     NEVER copies set_logs or cardio, NEVER links the new session to a
 *     planned_sessions row, and returns the new id
 *
 * Both RETURN the new session id (the Today sheet navigates client-side)
 * rather than calling redirect(); the `next/navigation` mock below still
 * backs the no-user `redirect("/login")` guard.
 *
 * The regression test at the bottom proves the "ad-hoc doesn't complete
 * the planned day" accounting invariant: no insert / update touches
 * `planned_sessions.completed_session_id` from any of these actions.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const SELF = "00000000-0000-4000-8000-000000000001";
const OTHER = "00000000-0000-4000-8000-0000000000ff";
const SOURCE_SESSION = "11111111-0000-4000-8000-000000000010";
const OTHER_USER_SESSION = "11111111-0000-4000-8000-0000000000ee";
const MOVEMENT_A = "20000000-0000-4000-8000-0000000000a1";
const MOVEMENT_B = "20000000-0000-4000-8000-0000000000a2";

type SessionRow = {
  id: string;
  user_id: string;
  title: string | null;
  completed_at: string | null;
  deleted_at: string | null;
};
type SessionMovementRow = {
  session_id: string;
  movement_id: string;
  sort_order: number;
};
type CardioRow = {
  session_id: string;
  movement_id: string | null;
  block_index: number;
  modality: string;
  duration_sec: number;
  avg_hr_bpm?: number | null;
  distance_km?: number | null;
  rpe?: number | null;
};
type SetLogRow = {
  session_id: string;
  movement_id: string;
};
type PlannedRow = {
  id: string;
  user_id: string;
  completed_session_id: string | null;
};

type RpcCall = { fn: string; args: Record<string, unknown> };

const store: {
  currentUserId: string;
  sessions: SessionRow[];
  sessionMovements: SessionMovementRow[];
  cardioLogs: CardioRow[];
  setLogs: SetLogRow[];
  plannedSessions: PlannedRow[];
  inserts: Array<{ table: string; row: Record<string, unknown> }>;
  updates: Array<{ table: string; patch: Record<string, unknown>; eqs: Array<[string, unknown]> }>;
  rpcCalls: RpcCall[];
  nextId: number;
} = {
  currentUserId: SELF,
  sessions: [],
  sessionMovements: [],
  cardioLogs: [],
  setLogs: [],
  plannedSessions: [],
  inserts: [],
  updates: [],
  rpcCalls: [],
  nextId: 0,
};

function newId(): string {
  store.nextId += 1;
  return `99999999-0000-4000-8000-${String(store.nextId).padStart(12, "0")}`;
}

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

class RedirectError extends Error {
  digest: string;
  constructor(url: string) {
    super(`NEXT_REDIRECT;replace;${url}`);
    this.digest = `NEXT_REDIRECT;replace;${url};303`;
  }
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new RedirectError(url);
  },
}));

// Engine recompute hooks aren't exercised by these actions but the
// `actions.ts` module imports them at the top — stub everything that
// would otherwise need a real DB connection.
vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: vi.fn(async () => undefined),
}));
vi.mock("@/lib/engine/recompute-actual-session-load", () => ({
  recomputeActualSessionLoad: vi.fn(async () => undefined),
}));
vi.mock("@/lib/planner/completion", () => ({
  maybeCompleteBlock: vi.fn(async () => undefined),
}));
vi.mock("@/lib/planner/queries", () => ({
  getUserTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/planner/archetypes", () => ({
  roundToPlate: (n: number) => Math.round(n),
}));
vi.mock("@/lib/sessions/strength-prescribed", () => ({
  sessionPrescribesStrength: () => false,
}));
vi.mock("@/lib/engine/overrides", () => ({
  recordOverrideEvent: vi.fn(async () => undefined),
}));
vi.mock("./prescription-mutations", () => ({
  applyPrescriptionSwap: (p: unknown) => p,
}));

vi.mock("@/lib/supabase/server", () => {
  const tableRows = (table: string): Record<string, unknown>[] => {
    if (table === "sessions") return store.sessions as unknown as Record<string, unknown>[];
    if (table === "session_movements")
      return store.sessionMovements as unknown as Record<string, unknown>[];
    if (table === "cardio_logs")
      return store.cardioLogs as unknown as Record<string, unknown>[];
    if (table === "set_logs") return store.setLogs as unknown as Record<string, unknown>[];
    if (table === "planned_sessions")
      return store.plannedSessions as unknown as Record<string, unknown>[];
    return [];
  };

  const handleRpc = (fn: string, args: Record<string, unknown>) => {
    store.rpcCalls.push({ fn, args });
    if (fn === "add_session_movement") {
      const sessionId = args.p_session_id as string;
      const movementId = args.p_movement_id as string;
      const existing = store.sessionMovements.find(
        (r) => r.session_id === sessionId && r.movement_id === movementId,
      );
      if (existing) {
        return Promise.resolve({ data: [existing], error: null });
      }
      const maxSort = store.sessionMovements
        .filter((r) => r.session_id === sessionId)
        .reduce((acc, r) => Math.max(acc, r.sort_order), 0);
      store.sessionMovements.push({
        session_id: sessionId,
        movement_id: movementId,
        sort_order: maxSort + 10,
      });
      return Promise.resolve({ data: [{ session_id: sessionId, movement_id: movementId }], error: null });
    }
    return Promise.resolve({ data: null, error: { message: `unmocked rpc ${fn}` } });
  };

  return {
    createClient: async () => ({
      auth: { getUser: async () => ({ data: { user: { id: store.currentUserId } } }) },
      rpc: (fn: string, args: Record<string, unknown>) => handleRpc(fn, args),
      from: (table: string) => {
        const state: {
          op?: "select" | "insert" | "update";
          eqs: Array<[string, unknown]>;
          ises: Array<[string, unknown]>;
          ins?: Array<[string, unknown[]]>;
          orderField?: string;
          orderAsc?: boolean;
          patch?: Record<string, unknown>;
          inserted?: Record<string, unknown> | null;
        } = { eqs: [], ises: [] };

        const matches = (row: Record<string, unknown>) => {
          for (const [c, v] of state.eqs) if (row[c] !== v) return false;
          for (const [c, v] of state.ises) {
            if (v === null) {
              if (row[c] !== null && row[c] !== undefined) return false;
            } else if (row[c] !== v) return false;
          }
          if (state.ins) {
            for (const [c, vals] of state.ins) {
              if (!vals.includes(row[c] as never)) return false;
            }
          }
          return true;
        };
        const filtered = () => tableRows(table).filter(matches);

        const builder: Record<string, unknown> = {};
        const api = {
          select: ((_cols?: string) => {
            state.op = state.op ?? "select";
            return builder;
          }) as unknown,
          insert: ((row: Record<string, unknown> | Record<string, unknown>[]) => {
            state.op = "insert";
            const rows = Array.isArray(row) ? row : [row];
            for (const r of rows) {
              store.inserts.push({ table, row: r });
              if (table === "sessions") {
                const inserted: SessionRow = {
                  id: (r.id as string | undefined) ?? newId(),
                  user_id: r.user_id as string,
                  title: (r.title as string | null) ?? null,
                  completed_at: null,
                  deleted_at: null,
                };
                store.sessions.push(inserted);
                state.inserted = inserted as unknown as Record<string, unknown>;
              } else if (table === "cardio_logs") {
                const inserted: CardioRow = {
                  session_id: r.session_id as string,
                  movement_id: (r.movement_id as string | null) ?? null,
                  block_index: (r.block_index as number) ?? 0,
                  modality: r.modality as string,
                  duration_sec: r.duration_sec as number,
                };
                store.cardioLogs.push(inserted);
                state.inserted = inserted as unknown as Record<string, unknown>;
              } else if (table === "set_logs") {
                const inserted: SetLogRow = {
                  session_id: r.session_id as string,
                  movement_id: r.movement_id as string,
                };
                store.setLogs.push(inserted);
                state.inserted = inserted as unknown as Record<string, unknown>;
              } else if (table === "planned_sessions") {
                store.plannedSessions.push(r as unknown as PlannedRow);
                state.inserted = r;
              }
            }
            return builder;
          }) as unknown,
          update: ((patch: Record<string, unknown>) => {
            state.op = "update";
            state.patch = patch;
            return builder;
          }) as unknown,
          eq: ((col: string, val: unknown) => {
            state.eqs.push([col, val]);
            return builder;
          }) as unknown,
          is: ((col: string, val: unknown) => {
            state.ises.push([col, val]);
            return builder;
          }) as unknown,
          in: ((col: string, vals: unknown[]) => {
            (state.ins ??= []).push([col, vals]);
            return builder;
          }) as unknown,
          not: ((_col: string, _op: string, _val: unknown) => builder) as unknown,
          gte: ((_col: string, _val: unknown) => builder) as unknown,
          lt: ((_col: string, _val: unknown) => builder) as unknown,
          order: ((col: string, opts?: { ascending?: boolean }) => {
            state.orderField = col;
            state.orderAsc = opts?.ascending !== false;
            return builder;
          }) as unknown,
          limit: ((_n: number) => builder) as unknown,
          maybeSingle: (async () => {
            const row = filtered()[0] ?? null;
            return { data: row, error: null };
          }) as unknown,
          single: (async () => {
            if (state.op === "insert" && state.inserted) {
              return { data: state.inserted, error: null };
            }
            const row = filtered()[0] ?? null;
            return { data: row, error: row ? null : { message: "not found" } };
          }) as unknown,
          then: undefined as unknown,
        };
        Object.assign(builder, api);
        // Make the builder thenable so `await supabase.from(...).select(...).eq(...)` resolves
        // to { data, error } (used by the list reads in repeatRecentSession).
        builder.then = ((resolve: (v: { data: unknown; error: null }) => void) => {
          if (state.op === "update") {
            const target = tableRows(table).filter(matches);
            for (const row of target) {
              Object.assign(row, state.patch);
              store.updates.push({ table, patch: state.patch!, eqs: state.eqs });
            }
            resolve({ data: null, error: null });
            return;
          }
          const rows = filtered().map((r) => {
            if (state.orderField) {
              return r;
            }
            return r;
          });
          if (state.orderField) {
            rows.sort((a, b) => {
              const av = (a as Record<string, unknown>)[state.orderField!];
              const bv = (b as Record<string, unknown>)[state.orderField!];
              if (av == null || bv == null) return 0;
              if (av < bv) return state.orderAsc ? -1 : 1;
              if (av > bv) return state.orderAsc ? 1 : -1;
              return 0;
            });
          }
          resolve({ data: rows, error: null });
        }) as unknown;
        return builder;
      },
    }),
    getAuthUser: async () => ({
      data: { user: { id: store.currentUserId } },
      error: null,
    }),
  };
});

function reset() {
  store.currentUserId = SELF;
  store.sessions = [
    {
      id: SOURCE_SESSION,
      user_id: SELF,
      title: "Tuesday push",
      completed_at: "2026-05-05T11:00:00Z",
      deleted_at: null,
    },
    {
      id: OTHER_USER_SESSION,
      user_id: OTHER,
      title: "Their session",
      completed_at: "2026-05-05T11:00:00Z",
      deleted_at: null,
    },
  ];
  store.sessionMovements = [
    { session_id: SOURCE_SESSION, movement_id: MOVEMENT_A, sort_order: 10 },
    { session_id: SOURCE_SESSION, movement_id: MOVEMENT_B, sort_order: 20 },
  ];
  store.cardioLogs = [];
  store.setLogs = [
    { session_id: SOURCE_SESSION, movement_id: MOVEMENT_A },
    { session_id: SOURCE_SESSION, movement_id: MOVEMENT_A },
    { session_id: SOURCE_SESSION, movement_id: MOVEMENT_B },
  ];
  store.plannedSessions = [
    { id: "ps-today", user_id: SELF, completed_session_id: null },
  ];
  store.inserts = [];
  store.updates = [];
  store.rpcCalls = [];
  store.nextId = 0;
}

beforeEach(() => {
  reset();
});

describe("startQuickStrengthSession", () => {
  it("creates an empty session and returns its id, with no movements or cardio attached", async () => {
    const { startQuickStrengthSession } = await import("../actions");
    const id = await startQuickStrengthSession();

    const created = store.sessions.find((s) => s.id !== SOURCE_SESSION && s.user_id === SELF)!;
    expect(created).toBeDefined();
    expect(created.title).toBe("Quick workout");
    expect(id).toBe(created.id);

    expect(store.sessionMovements.filter((m) => m.session_id === created.id)).toHaveLength(0);
    expect(store.cardioLogs.filter((c) => c.session_id === created.id)).toHaveLength(0);
    expect(store.setLogs.filter((s) => s.session_id === created.id)).toHaveLength(0);
  });

  it("does NOT mark today's planned session complete", async () => {
    const { startQuickStrengthSession } = await import("../actions");
    await startQuickStrengthSession();
    expect(store.plannedSessions[0]!.completed_session_id).toBeNull();
  });
});

describe("repeatRecentSession", () => {
  it("copies strength movements from the source but NOT set_logs or cardio", async () => {
    // A source cardio block must NOT be cloned — quick workouts are
    // strength-only; ad-hoc cardio is logged through the cardio surfaces.
    store.cardioLogs.push({
      session_id: SOURCE_SESSION,
      movement_id: null,
      block_index: 0,
      modality: "run",
      duration_sec: 32 * 60,
      avg_hr_bpm: 165,
      distance_km: 6.4,
      rpe: 7,
    });

    const { repeatRecentSession } = await import("../actions");
    const id = await repeatRecentSession({ sessionId: SOURCE_SESSION });

    const created = store.sessions.find(
      (s) => s.id !== SOURCE_SESSION && s.id !== OTHER_USER_SESSION && s.user_id === SELF,
    )!;
    expect(created).toBeDefined();
    expect(created.title).toBe("Tuesday push");
    expect(id).toBe(created.id);

    const newMovements = store.sessionMovements
      .filter((m) => m.session_id === created.id)
      .map((m) => m.movement_id)
      .sort();
    expect(newMovements).toEqual([MOVEMENT_A, MOVEMENT_B].sort());

    // Cardio is NOT cloned into the new session.
    const newCardio = store.cardioLogs.filter((c) => c.session_id === created.id);
    expect(newCardio).toHaveLength(0);
    const cardioInsert = store.inserts.find(
      (i) => i.table === "cardio_logs" && i.row.session_id === created.id,
    );
    expect(cardioInsert).toBeUndefined();

    // Set logs from the source are NOT copied into the new session.
    expect(store.setLogs.filter((s) => s.session_id === created.id)).toHaveLength(0);
  });

  it("rejects a session owned by a different user (RLS-respect)", async () => {
    const { repeatRecentSession } = await import("../actions");
    await expect(
      repeatRecentSession({ sessionId: OTHER_USER_SESSION }),
    ).rejects.toThrow(/Session not found/);
    // Nothing was created.
    expect(store.sessions.filter((s) => s.user_id === SELF && s.title === "Their session")).toHaveLength(0);
  });

  it("does NOT touch planned_sessions.completed_session_id (ad-hoc accounting regression)", async () => {
    const { repeatRecentSession } = await import("../actions");
    await repeatRecentSession({ sessionId: SOURCE_SESSION });
    expect(store.updates.find((u) => u.table === "planned_sessions")).toBeUndefined();
    expect(store.plannedSessions[0]!.completed_session_id).toBeNull();
  });
});
