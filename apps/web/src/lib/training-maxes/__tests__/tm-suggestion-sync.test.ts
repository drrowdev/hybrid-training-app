/**
 * Action-level TM suggestion sync: create / update / drop pending rows
 * after completion or a later set edit.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { syncTmSuggestionsForSession } from "../tm-suggestion-sync";

const USER = "user-1";
const SESSION = "sess-1";
const MV = "mv-squat";
const SET = "set-1";

type SetLog = {
  id: string;
  movement_id: string;
  weight_kg: number | null;
  reps: number | null;
  rpe: number | null;
  set_kind: string;
  notes: string | null;
  skipped: boolean;
  prescribed: { isAmrap?: boolean } | null;
};

type Suggestion = {
  id: string;
  movement_id: string;
  derived_from_set_log_id: string | null;
  status: string;
  current_tm_kg: number;
  suggested_tm_kg: number;
  derived_formula: string | null;
  source: string;
  derived_from_session_id?: string;
};

const db: {
  completedAt: string | null;
  sets: SetLog[];
  suggestions: Suggestion[];
  inserts: Suggestion[];
  updates: Array<{ id: string; patch: Record<string, unknown> }>;
  deletes: string[][];
} = {
  completedAt: "2026-03-01T18:00:00.000Z",
  sets: [],
  suggestions: [],
  inserts: [],
  updates: [],
  deletes: [],
};

function qualifyingAmrap(over: Partial<SetLog> = {}): SetLog {
  return {
    id: SET,
    movement_id: MV,
    weight_kg: 100,
    reps: 5,
    rpe: null,
    set_kind: "main",
    notes: null,
    skipped: false,
    prescribed: { isAmrap: true },
    ...over,
  };
}

function makeSupabase() {
  return {
    from(table: string) {
      const state: {
        eqs: Record<string, unknown>;
        ins: Record<string, unknown[]>;
      } = { eqs: {}, ins: {} };
      const chain: Record<string, unknown> = {};
      Object.assign(chain, {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          state.eqs[col] = val;
          return chain;
        },
        in: (col: string, ids: unknown[]) => {
          state.ins[col] = ids;
          return chain;
        },
        maybeSingle: async () => {
          if (table === "sessions") {
            return {
              data: db.completedAt
                ? {
                    id: SESSION,
                    user_id: USER,
                    completed_at: db.completedAt,
                  }
                : { id: SESSION, user_id: USER, completed_at: null },
              error: null,
            };
          }
          if (table === "profiles") {
            return { data: { tm_percent_default: 90 }, error: null };
          }
          return { data: null, error: null };
        },
        delete: () => chain,
        update: (patch: Record<string, unknown>) => {
          const apply = () => {
            const id = state.eqs.id as string | undefined;
            if (id) db.updates.push({ id, patch });
            db.suggestions = db.suggestions.map((row) =>
              row.id === id && row.status === "pending"
                ? { ...row, ...patch }
                : row,
            );
          };
          Object.assign(chain, {
            then: (resolve: (v: unknown) => unknown) => {
              apply();
              return Promise.resolve(resolve({ data: null, error: null }));
            },
          });
          return chain;
        },
        insert: (row: Record<string, unknown>) => {
          const inserted = {
            id: `new-${db.inserts.length + 1}`,
            movement_id: row.movement_id as string,
            derived_from_set_log_id: row.derived_from_set_log_id as string,
            status: "pending",
            current_tm_kg: row.current_tm_kg as number,
            suggested_tm_kg: row.suggested_tm_kg as number,
            derived_formula: row.derived_formula as string,
            source: row.source as string,
          };
          db.inserts.push(inserted);
          db.suggestions.push(inserted);
          return {
            select: () => ({
              maybeSingle: async () => ({ data: { id: inserted.id }, error: null }),
            }),
          };
        },
        then: (resolve: (v: unknown) => unknown) => {
          if (table === "set_logs") {
            return Promise.resolve(resolve({ data: db.sets, error: null }));
          }
          if (table === "tm_suggestions") {
            if (state.ins.id) {
              db.deletes.push(state.ins.id as string[]);
              const drop = new Set(state.ins.id as string[]);
              db.suggestions = db.suggestions.filter((row) => !drop.has(row.id));
              return Promise.resolve(resolve({ data: null, error: null }));
            }
            return Promise.resolve(
              resolve({ data: db.suggestions, error: null }),
            );
          }
          if (table === "training_maxes") {
            return Promise.resolve(
              resolve({
                data: [
                  { movement_id: MV, one_rm_kg: 100, tm_percent: 90 },
                ],
                error: null,
              }),
            );
          }
          return Promise.resolve(resolve({ data: [], error: null }));
        },
      });
      return chain;
    },
  };
}

describe("syncTmSuggestionsForSession", () => {
  beforeEach(() => {
    db.completedAt = "2026-03-01T18:00:00.000Z";
    db.sets = [];
    db.suggestions = [];
    db.inserts = [];
    db.updates = [];
    db.deletes = [];
  });

  it("no-ops while the session is still in flight", async () => {
    db.completedAt = null;
    db.sets = [qualifyingAmrap()];
    const created = await syncTmSuggestionsForSession(
      makeSupabase() as never,
      USER,
      SESSION,
    );
    expect(created).toEqual([]);
    expect(db.inserts).toHaveLength(0);
  });

  it("creates a pending suggestion for a stored AMRAP, including 3+ at 4 reps", async () => {
    db.sets = [qualifyingAmrap({ reps: 4 })];
    const created = await syncTmSuggestionsForSession(
      makeSupabase() as never,
      USER,
      SESSION,
    );
    expect(created).toHaveLength(1);
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0]?.derived_from_set_log_id).toBe(SET);
  });

  it("does not treat a programmed 5 as an AMRAP", async () => {
    db.sets = [qualifyingAmrap({ reps: 5, prescribed: { isAmrap: false } })];
    const created = await syncTmSuggestionsForSession(
      makeSupabase() as never,
      USER,
      SESSION,
    );
    expect(created).toEqual([]);
    expect(db.inserts).toHaveLength(0);
  });

  it("removes a pending suggestion after the source set is gone", async () => {
    db.sets = [];
    db.suggestions = [
      {
        id: "pending-1",
        movement_id: MV,
        derived_from_set_log_id: null,
        status: "pending",
        current_tm_kg: 180,
        suggested_tm_kg: 185,
        derived_formula: "brzycki",
        source: "derived_amrap",
      },
    ];
    await syncTmSuggestionsForSession(makeSupabase() as never, USER, SESSION);
    expect(db.deletes).toEqual([["pending-1"]]);
    expect(db.suggestions).toEqual([]);
  });

  it("updates a pending suggestion when the logged set still qualifies", async () => {
    db.sets = [qualifyingAmrap({ reps: 5 })];
    db.suggestions = [
      {
        id: "pending-1",
        movement_id: MV,
        derived_from_set_log_id: SET,
        status: "pending",
        current_tm_kg: 90,
        suggested_tm_kg: 200,
        derived_formula: "brzycki",
        source: "derived_amrap",
      },
    ];
    const created = await syncTmSuggestionsForSession(
      makeSupabase() as never,
      USER,
      SESSION,
    );
    expect(created).toEqual([]);
    expect(db.updates).toHaveLength(1);
    expect(db.updates[0]?.id).toBe("pending-1");
    expect(db.inserts).toHaveLength(0);
  });

  it("does not insert a second pending row for the same set", async () => {
    db.sets = [qualifyingAmrap()];
    db.suggestions = [
      {
        id: "pending-1",
        movement_id: MV,
        derived_from_set_log_id: SET,
        status: "pending",
        current_tm_kg: 90,
        suggested_tm_kg: 112.5,
        derived_formula: "brzycki",
        source: "derived_amrap",
      },
    ];
    const created = await syncTmSuggestionsForSession(
      makeSupabase() as never,
      USER,
      SESSION,
    );
    expect(created).toEqual([]);
    expect(db.inserts).toHaveLength(0);
  });

  it("leaves accepted and dismissed history alone", async () => {
    db.sets = [];
    db.suggestions = [
      {
        id: "acc",
        movement_id: MV,
        derived_from_set_log_id: SET,
        status: "accepted",
        current_tm_kg: 180,
        suggested_tm_kg: 185,
        derived_formula: "brzycki",
        source: "derived_amrap",
      },
      {
        id: "dis",
        movement_id: MV,
        derived_from_set_log_id: "set-old",
        status: "dismissed",
        current_tm_kg: 180,
        suggested_tm_kg: 185,
        derived_formula: "brzycki",
        source: "derived_amrap",
      },
    ];
    await syncTmSuggestionsForSession(makeSupabase() as never, USER, SESSION);
    expect(db.deletes).toEqual([]);
    expect(db.suggestions.map((s) => s.id)).toEqual(["acc", "dis"]);
  });
});
