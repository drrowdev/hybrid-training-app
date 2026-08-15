/**
 * `markExternalCardioComplete` must scope every planned-session write and
 * re-read to the caller (AGENTS.md: RLS on every user-data table; the
 * function already establishes the convention at the stale-link clear).
 * RLS enforces this server-side, but an unscoped filter is a latent
 * hazard the moment the query moves to a service-role client.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-0000000000a1";
const PLANNED_ID = "00000000-0000-4000-8000-0000000000a2";
const CREATED_SESSION_ID = "00000000-0000-4000-8000-0000000000a3";
const WINNER_SESSION_ID = "00000000-0000-4000-8000-0000000000a4";

type QueryCall = {
  table: string;
  op: "select" | "update" | "insert" | "delete";
  eqs: Array<[string, unknown]>;
  ises: Array<[string, unknown]>;
};

const mockState = vi.hoisted(() => ({
  calls: [] as QueryCall[],
  /** When true the conditional link UPDATE affects zero rows (race lost). */
  loseLinkRace: false,
  plannedSelects: 0,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: vi.fn(),
}));
vi.mock("@/lib/engine/recompute-actual-session-load", () => ({
  recomputeActualSessionLoad: vi.fn(),
}));
vi.mock("@/lib/planner/completion", () => ({ maybeCompleteBlock: vi.fn() }));
vi.mock("@/lib/planner/queries", () => ({
  dayDate: vi.fn(),
  getUserTimezone: vi.fn(async () => "UTC"),
}));
vi.mock("@/lib/planner/modifications", () => ({
  applyModificationsToPrescription: (prescription: unknown) => prescription,
  getActiveModifications: vi.fn(async () => []),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const call: QueryCall = { table, op: "select", eqs: [], ises: [] };
      mockState.calls.push(call);
      const builder: Record<string, unknown> = {};

      const execute = () => {
        if (table === "planned_sessions") {
          if (call.op === "select") {
            mockState.plannedSelects += 1;
            if (mockState.plannedSelects === 1) {
              return {
                data: {
                  id: PLANNED_ID,
                  user_id: USER_ID,
                  title: "Zone 2 + squats",
                  completed_session_id: null,
                  prescription: {
                    items: [
                      {
                        movementId: null,
                        kind: "cardio_z2",
                        sets: 1,
                        reps: 1,
                        durationMin: 45,
                      },
                      { movementId: "squat", kind: "main", sets: 3, reps: 5 },
                    ],
                  },
                },
                error: null,
              };
            }
            // The post-race winner re-read.
            return {
              data: { completed_session_id: WINNER_SESSION_ID },
              error: null,
            };
          }
          if (call.op === "update") {
            return {
              data: mockState.loseLinkRace
                ? null
                : { completed_session_id: CREATED_SESSION_ID },
              error: null,
            };
          }
        }
        if (table === "sessions" && call.op === "insert") {
          return { data: { id: CREATED_SESSION_ID }, error: null };
        }
        if (table === "cardio_logs" && call.op === "select") {
          return { data: [], count: 0, error: null };
        }
        return { data: null, count: 0, error: null };
      };

      Object.assign(builder, {
        select: () => builder,
        update: () => {
          call.op = "update";
          return builder;
        },
        insert: () => {
          call.op = "insert";
          return builder;
        },
        delete: () => {
          call.op = "delete";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          call.eqs.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          call.ises.push([column, value]);
          return builder;
        },
        maybeSingle: () => Promise.resolve(execute()),
        single: () => Promise.resolve(execute()),
        then: (resolve: (value: unknown) => unknown) =>
          Promise.resolve(resolve(execute())),
      });
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

function formData() {
  const fd = new FormData();
  fd.set("plannedSessionId", PLANNED_ID);
  fd.set("itemIndex", "0");
  fd.set("programName", "Club run");
  return fd;
}

function plannedCalls(op: QueryCall["op"]): QueryCall[] {
  return mockState.calls.filter(
    (call) => call.table === "planned_sessions" && call.op === op,
  );
}

describe("markExternalCardioComplete user scoping", () => {
  beforeEach(() => {
    mockState.calls = [];
    mockState.loseLinkRace = false;
    mockState.plannedSelects = 0;
  });

  it("scopes the conditional link UPDATE to the caller", async () => {
    const { markExternalCardioComplete } = await import("../actions");

    const result = await markExternalCardioComplete(formData());

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(CREATED_SESSION_ID);
    const updates = plannedCalls("update");
    expect(updates).toHaveLength(1);
    expect(updates[0]!.eqs).toContainEqual(["user_id", USER_ID]);
    expect(updates[0]!.eqs).toContainEqual(["id", PLANNED_ID]);
    expect(updates[0]!.ises).toContainEqual(["completed_session_id", null]);
  });

  it("scopes the lost-race winner re-read to the caller", async () => {
    mockState.loseLinkRace = true;
    const { markExternalCardioComplete } = await import("../actions");

    const result = await markExternalCardioComplete(formData());

    expect(result.ok).toBe(true);
    expect(result.sessionId).toBe(WINNER_SESSION_ID);
    // Two selects: the initial planned fetch and the winner re-read.
    const selects = plannedCalls("select");
    expect(selects).toHaveLength(2);
    expect(selects[1]!.eqs).toContainEqual(["user_id", USER_ID]);
    expect(selects[1]!.eqs).toContainEqual(["id", PLANNED_ID]);
  });
});
