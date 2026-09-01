/**
 * Auto-deload prior walk — same-block chronology, not week_index across
 * every block.
 */
import { describe, it, expect } from "vitest";
import {
  findDeloadProposalForSession,
  isChronologicallyBefore,
  selectPriorDeloadCandidates,
  type DeloadPriorCandidate,
} from "../deload";
import type { Prescription, PrescriptionItem } from "@hta/db";

const MV = "mv-squat";
const USER = "user-1";

function chrono(
  over: Partial<DeloadPriorCandidate> & { plannedId: string; blockId: string },
): DeloadPriorCandidate {
  return {
    weekIndex: 0,
    dayIndex: 0,
    performedAt: null,
    createdAt: null,
    completedSessionId: `sess-${over.plannedId}`,
    movementId: MV,
    target: 5,
    ...over,
  };
}

describe("isChronologicallyBefore", () => {
  it("prefers performed_at over week_index", () => {
    const earlier = chrono({
      plannedId: "w3",
      blockId: "b1",
      weekIndex: 3,
      performedAt: "2026-01-01T00:00:00.000Z",
    });
    const later = chrono({
      plannedId: "w1",
      blockId: "b1",
      weekIndex: 1,
      performedAt: "2026-01-20T00:00:00.000Z",
    });
    expect(isChronologicallyBefore(earlier, later)).toBe(true);
    expect(isChronologicallyBefore(later, earlier)).toBe(false);
  });

  it("breaks same-day start-of-day ties with created_at", () => {
    const first = chrono({
      plannedId: "a",
      blockId: "b1",
      weekIndex: 1,
      performedAt: "2026-01-10T00:00:00.000Z",
      createdAt: "2026-01-10T08:00:00.000Z",
    });
    const second = chrono({
      plannedId: "b",
      blockId: "b1",
      weekIndex: 1,
      performedAt: "2026-01-10T00:00:00.000Z",
      createdAt: "2026-01-10T18:00:00.000Z",
    });
    expect(isChronologicallyBefore(first, second)).toBe(true);
  });
});

describe("selectPriorDeloadCandidates", () => {
  it("drops other-block week-3 misses that used to false-trigger a week-1 deload", () => {
    const current = chrono({
      plannedId: "cur",
      blockId: "block-b",
      weekIndex: 0,
      performedAt: "2026-03-01T00:00:00.000Z",
    });
    const oldBlockMiss = chrono({
      plannedId: "old-w3",
      blockId: "block-a",
      weekIndex: 2,
      performedAt: "2026-02-01T00:00:00.000Z",
    });
    const priors = selectPriorDeloadCandidates({
      current,
      candidates: [oldBlockMiss],
    });
    expect(priors).toEqual([]);
  });

  it("keeps this-block week-1 when an old-block week-3 hit used to suppress the streak", () => {
    const current = chrono({
      plannedId: "cur-w2",
      blockId: "block-b",
      weekIndex: 1,
      performedAt: "2026-03-08T00:00:00.000Z",
    });
    const oldBlockHit = chrono({
      plannedId: "old-w3",
      blockId: "block-a",
      weekIndex: 2,
      performedAt: "2026-02-15T00:00:00.000Z",
    });
    const sameBlockMiss = chrono({
      plannedId: "cur-w1",
      blockId: "block-b",
      weekIndex: 0,
      performedAt: "2026-03-01T00:00:00.000Z",
    });
    const priors = selectPriorDeloadCandidates({
      current,
      candidates: [oldBlockHit, sameBlockMiss],
    });
    expect(priors.map((p) => p.plannedId)).toEqual(["cur-w1"]);
  });

  it("orders by actual time, not week_index", () => {
    const current = chrono({
      plannedId: "cur",
      blockId: "b1",
      weekIndex: 2,
      performedAt: "2026-03-15T00:00:00.000Z",
    });
    const laterWeekLoggedEarly = chrono({
      plannedId: "w2-early",
      blockId: "b1",
      weekIndex: 1,
      performedAt: "2026-03-20T00:00:00.000Z",
    });
    const earlierWeek = chrono({
      plannedId: "w1",
      blockId: "b1",
      weekIndex: 0,
      performedAt: "2026-03-01T00:00:00.000Z",
    });
    const priors = selectPriorDeloadCandidates({
      current,
      candidates: [laterWeekLoggedEarly, earlierWeek],
    });
    expect(priors.map((p) => p.plannedId)).toEqual(["w1"]);
  });
});

type PlannedRow = {
  id: string;
  block_id: string;
  week_index: number;
  day_index: number;
  completed_session_id: string | null;
  prescription: Prescription;
  user_id: string;
};

type SessionRow = {
  id: string;
  user_id: string;
  performed_at: string;
  created_at: string | null;
  fatigue: number | null;
  soreness: number | null;
  deleted_at: string | null;
};

type SetRow = {
  session_id: string;
  movement_id: string;
  weight_kg: number;
  reps: number;
  set_kind: string;
  skipped: boolean;
};

function amrapPrescription(): Prescription {
  return {
    items: [
      {
        movementId: MV,
        kind: "main",
        reps: "5+",
        isAmrap: true,
      } as unknown as PrescriptionItem,
    ],
  };
}

function makeDeloadSupabase(db: {
  planned: PlannedRow[];
  sessions: SessionRow[];
  sets: SetRow[];
  existingTriggerCount?: number;
}) {
  const movement = { id: MV, display_name: "Squat" };
  const tm = { one_rm_kg: 200, tm_percent: 90 };

  const builder = (table: string) => {
    const state: {
      eqs: Record<string, unknown>;
      neqs: Record<string, unknown>;
      ins: Record<string, unknown[]>;
      notNull: string[];
      isNull: string[];
      neqKind: string | null;
      countHead: boolean;
    } = {
      eqs: {},
      neqs: {},
      ins: {},
      notNull: [],
      isNull: [],
      neqKind: null,
      countHead: false,
    };

    const matches = <T extends Record<string, unknown>>(rows: T[]): T[] =>
      rows.filter((row) => {
        for (const [col, val] of Object.entries(state.eqs)) {
          if (row[col] !== val) return false;
        }
        for (const [col, val] of Object.entries(state.neqs)) {
          if (row[col] === val) return false;
        }
        for (const [col, ids] of Object.entries(state.ins)) {
          if (!ids.includes(row[col] as never)) return false;
        }
        for (const col of state.notNull) {
          if (row[col] == null) return false;
        }
        for (const col of state.isNull) {
          if (row[col] != null) return false;
        }
        if (state.neqKind && row.set_kind === state.neqKind) return false;
        return true;
      });

    const chain: Record<string, unknown> = {};
    Object.assign(chain, {
      select: (_cols?: string, opts?: { count?: string; head?: boolean }) => {
        state.countHead = !!opts?.head;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        state.eqs[col] = val;
        return chain;
      },
      neq: (col: string, val: unknown) => {
        if (col === "set_kind") state.neqKind = String(val);
        else state.neqs[col] = val;
        return chain;
      },
      in: (col: string, ids: unknown[]) => {
        state.ins[col] = ids;
        return chain;
      },
      is: (col: string, val: unknown) => {
        if (val === null) state.isNull.push(col);
        return chain;
      },
      not: (col: string, op: string, val: unknown) => {
        if (op === "is" && val === null) state.notNull.push(col);
        return chain;
      },
      maybeSingle: async () => {
        if (table === "planned_sessions") {
          return { data: matches(db.planned as never)[0] ?? null, error: null };
        }
        if (table === "sessions") {
          return { data: matches(db.sessions as never)[0] ?? null, error: null };
        }
        if (table === "movements") {
          return { data: movement, error: null };
        }
        if (table === "training_maxes") {
          return { data: tm, error: null };
        }
        return { data: null, error: null };
      },
      then: (resolve: (v: unknown) => unknown) => {
        if (table === "tm_history") {
          return Promise.resolve(
            resolve({
              data: null,
              error: null,
              count: db.existingTriggerCount ?? 0,
            }),
          );
        }
        if (table === "planned_sessions") {
          return Promise.resolve(
            resolve({ data: matches(db.planned as never), error: null }),
          );
        }
        if (table === "sessions") {
          return Promise.resolve(
            resolve({ data: matches(db.sessions as never), error: null }),
          );
        }
        if (table === "set_logs") {
          return Promise.resolve(
            resolve({ data: matches(db.sets as never), error: null }),
          );
        }
        return Promise.resolve(resolve({ data: [], error: null }));
      },
    });
    return chain;
  };

  return { from: (table: string) => builder(table) };
}

function planned(over: Partial<PlannedRow> & { id: string; block_id: string }): PlannedRow {
  return {
    week_index: 0,
    day_index: 0,
    completed_session_id: `sess-${over.id}`,
    prescription: amrapPrescription(),
    user_id: USER,
    ...over,
  };
}

function session(over: Partial<SessionRow> & { id: string; performed_at: string }): SessionRow {
  return {
    user_id: USER,
    created_at: over.performed_at,
    fatigue: null,
    soreness: null,
    deleted_at: null,
    ...over,
  };
}

function missSet(sessionId: string, reps = 3): SetRow {
  return {
    session_id: sessionId,
    movement_id: MV,
    weight_kg: 100,
    reps,
    set_kind: "main",
    skipped: false,
  };
}

function hitSet(sessionId: string): SetRow {
  return missSet(sessionId, 5);
}

describe("findDeloadProposalForSession — multi-block", () => {
  it("does not fire when only the previous block's week-3 was a miss", async () => {
    // Old bug: week_index desc across all blocks paired block-A week 3
    // with block-B week 1.
    const supabase = makeDeloadSupabase({
      planned: [
        planned({
          id: "cur",
          block_id: "block-b",
          week_index: 0,
          completed_session_id: "sess-cur",
        }),
        planned({
          id: "old-w3",
          block_id: "block-a",
          week_index: 2,
          completed_session_id: "sess-old",
        }),
      ],
      sessions: [
        session({ id: "sess-cur", performed_at: "2026-03-01T00:00:00.000Z" }),
        session({ id: "sess-old", performed_at: "2026-02-01T00:00:00.000Z" }),
      ],
      sets: [missSet("sess-cur"), missSet("sess-old")],
    });

    const proposal = await findDeloadProposalForSession(
      supabase as never,
      USER,
      "sess-cur",
    );
    expect(proposal).toBeNull();
  });

  it("still fires on two misses this block even if an old week-3 was a hit", async () => {
    // Old bug: week_index desc saw the old hit first and broke the streak.
    const supabase = makeDeloadSupabase({
      planned: [
        planned({
          id: "cur",
          block_id: "block-b",
          week_index: 1,
          completed_session_id: "sess-cur",
        }),
        planned({
          id: "w1",
          block_id: "block-b",
          week_index: 0,
          completed_session_id: "sess-w1",
        }),
        planned({
          id: "old-w3",
          block_id: "block-a",
          week_index: 2,
          completed_session_id: "sess-old",
        }),
      ],
      sessions: [
        session({ id: "sess-cur", performed_at: "2026-03-08T00:00:00.000Z" }),
        session({ id: "sess-w1", performed_at: "2026-03-01T00:00:00.000Z" }),
        session({ id: "sess-old", performed_at: "2026-02-15T00:00:00.000Z" }),
      ],
      sets: [missSet("sess-cur"), missSet("sess-w1"), hitSet("sess-old")],
    });

    const proposal = await findDeloadProposalForSession(
      supabase as never,
      USER,
      "sess-cur",
    );
    expect(proposal).not.toBeNull();
    expect(proposal?.missContext).toHaveLength(2);
    expect(proposal?.missContext.map((m) => m.sessionId)).toEqual([
      "sess-cur",
      "sess-w1",
    ]);
  });

  it("skips a missing prior session instead of treating it as a hit", async () => {
    const supabase = makeDeloadSupabase({
      planned: [
        planned({
          id: "cur",
          block_id: "block-b",
          week_index: 2,
          completed_session_id: "sess-cur",
        }),
        planned({
          id: "ghost",
          block_id: "block-b",
          week_index: 1,
          completed_session_id: "sess-ghost",
        }),
        planned({
          id: "w1",
          block_id: "block-b",
          week_index: 0,
          completed_session_id: "sess-w1",
        }),
      ],
      sessions: [
        session({ id: "sess-cur", performed_at: "2026-03-15T00:00:00.000Z" }),
        session({ id: "sess-w1", performed_at: "2026-03-01T00:00:00.000Z" }),
      ],
      sets: [missSet("sess-cur"), missSet("sess-w1")],
    });

    const proposal = await findDeloadProposalForSession(
      supabase as never,
      USER,
      "sess-cur",
    );
    expect(proposal).not.toBeNull();
    expect(proposal?.missContext.map((m) => m.sessionId)).toEqual([
      "sess-cur",
      "sess-w1",
    ]);
  });

  it("does not fire when the newest real prior was a hit", async () => {
    const supabase = makeDeloadSupabase({
      planned: [
        planned({
          id: "cur",
          block_id: "block-b",
          week_index: 1,
          completed_session_id: "sess-cur",
        }),
        planned({
          id: "w1",
          block_id: "block-b",
          week_index: 0,
          completed_session_id: "sess-w1",
        }),
      ],
      sessions: [
        session({ id: "sess-cur", performed_at: "2026-03-08T00:00:00.000Z" }),
        session({ id: "sess-w1", performed_at: "2026-03-01T00:00:00.000Z" }),
      ],
      sets: [missSet("sess-cur"), hitSet("sess-w1")],
    });

    expect(
      await findDeloadProposalForSession(supabase as never, USER, "sess-cur"),
    ).toBeNull();
  });
});
