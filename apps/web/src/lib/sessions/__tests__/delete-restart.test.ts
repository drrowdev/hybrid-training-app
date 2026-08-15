/**
 * Regression for delete/cancel → restart.
 *
 * The old attempt remains recoverable, but a new start must materialise a
 * different session row. That is what keeps set-derived progress and the
 * focus cursor at the beginning of the workout.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prescription } from "@hta/db";
import { autoCursorForGroup, groupPrescriptionByMovement } from "../movement-grouping";
import { matchPrescriptionItems } from "../prescription-progress";

type SessionRow = {
  id: string;
  user_id: string;
  title: string;
  slot: string;
  planned_at: string | null;
  deleted_at: string | null;
  completed_at: string | null;
};

type PlannedRow = {
  id: string;
  user_id: string;
  title: string;
  slot: string;
  planned_at: string | null;
  prescription: Prescription;
  completed_session_id: string | null;
};

type LoggedSet = {
  id: string;
  session_id: string;
  movementId: string;
  setKind: string;
  prescriptionItemIndex: number | null;
};

const USER_ID = "00000000-0000-0000-0000-000000000001";
const PLANNED_ID = "11111111-1111-1111-1111-111111111111";
const OLD_SESSION_ID = "22222222-2222-2222-2222-222222222222";
const FRESH_SESSION_ID = "33333333-3333-3333-3333-333333333333";

const prescription: Prescription = {
  items: [
    { movementId: "squat", kind: "main", sets: 1, reps: 5 },
    { movementId: "bench", kind: "main", sets: 1, reps: 5 },
  ],
};

const state: {
  sessions: SessionRow[];
  planned: PlannedRow;
  setLogs: LoggedSet[];
  revalidated: string[];
} = {
  sessions: [],
  planned: {
    id: PLANNED_ID,
    user_id: USER_ID,
    title: "Strength day",
    slot: "single",
    planned_at: null,
    prescription,
    completed_session_id: OLD_SESSION_ID,
  },
  setLogs: [],
  revalidated: [],
};

class RedirectError extends Error {
  constructor(public target: string) {
    super(`redirect to ${target}`);
  }
}

function matches(
  row: Record<string, unknown>,
  eqs: Array<[string, unknown]>,
  ises: Array<[string, unknown]>,
): boolean {
  return (
    eqs.every(([column, value]) => row[column] === value) &&
    ises.every(([column, value]) => (row[column] ?? null) === value)
  );
}

vi.mock("next/cache", () => ({
  revalidatePath: (path: string) => {
    state.revalidated.push(path);
  },
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new RedirectError(path);
  },
}));

vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: vi.fn(),
}));

vi.mock("@/lib/planner/completion", () => ({
  maybeCompleteBlock: vi.fn(),
}));

vi.mock("@/lib/planner/queries", () => ({
  getUserTimezone: async () => "UTC",
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      let operation: "select" | "update" | "insert" | "delete" = "select";
      let patch: Record<string, unknown> = {};
      let payload: Record<string, unknown> = {};
      let hasSelectAfterMutation = false;
      const eqs: Array<[string, unknown]> = [];
      const ises: Array<[string, unknown]> = [];
      const builder: Record<string, unknown> = {};

      const execute = () => {
        if (operation === "select") {
          if (table === "planned_sessions") {
            return { data: state.planned, error: null };
          }
          if (table === "sessions") {
            const row = state.sessions.find((candidate) =>
              matches(candidate as unknown as Record<string, unknown>, eqs, ises),
            );
            return { data: row ?? null, error: null };
          }
          if (table === "set_logs") {
            return {
              data: state.setLogs.filter((row) =>
                matches(row as unknown as Record<string, unknown>, eqs, ises),
              ),
              error: null,
            };
          }
          return { data: null, error: null };
        }

        if (operation === "update") {
          const rows =
            table === "sessions"
              ? state.sessions
              : table === "planned_sessions"
                ? [state.planned]
                : table === "set_logs"
                  ? state.setLogs
                  : [];
          const changed = rows.filter((row) =>
            matches(row as unknown as Record<string, unknown>, eqs, ises),
          );
          for (const row of changed) Object.assign(row, patch);
          return {
            data: hasSelectAfterMutation ? changed[0] ?? null : null,
            error: null,
          };
        }

        if (operation === "insert" && table === "sessions") {
          const row: SessionRow = {
            id: FRESH_SESSION_ID,
            user_id: String(payload.user_id),
            title: String(payload.title),
            slot: String(payload.slot),
            planned_at: (payload.planned_at as string | null) ?? null,
            deleted_at: null,
            completed_at: null,
          };
          state.sessions.push(row);
          return { data: { id: row.id }, error: null };
        }

        if (operation === "insert" && table === "set_logs") {
          const rows = (Array.isArray(payload) ? payload : [payload]) as Array<
            Record<string, unknown>
          >;
          const inserted = rows.map((row, index) => ({
            id: String(row.id ?? `set-${state.setLogs.length + index + 1}`),
            session_id: String(row.session_id),
            movementId: String(row.movementId ?? row.movement_id ?? ""),
            setKind: String(row.setKind ?? row.set_kind ?? "main"),
            prescriptionItemIndex:
              (row.prescriptionItemIndex as number | null | undefined) ??
              (row.prescription_item_index as number | null | undefined) ??
              null,
          }));
          state.setLogs.push(...inserted);
          return { data: inserted, error: null };
        }

        if (operation === "delete" && table === "sessions") {
          state.sessions = state.sessions.filter(
            (row) => !matches(row as unknown as Record<string, unknown>, eqs, ises),
          );
        }

        if (operation === "delete" && table === "set_logs") {
          state.setLogs = state.setLogs.filter(
            (row) => !matches(row as unknown as Record<string, unknown>, eqs, ises),
          );
        }
        return { data: null, error: null };
      };

      // Supabase's `.maybeSingle()` / `.single()` collapse a row set to one
      // row; the table branches above return arrays for `set_logs`.
      const executeSingle = () => {
        const result = execute() as { data: unknown; error: null };
        return Array.isArray(result.data)
          ? { data: result.data[0] ?? null, error: null }
          : result;
      };

      Object.assign(builder, {
        select: () => {
          if (operation !== "select") hasSelectAfterMutation = true;
          return builder;
        },
        update: (nextPatch: Record<string, unknown>) => {
          operation = "update";
          patch = nextPatch;
          return builder;
        },
        insert: (nextPayload: Record<string, unknown>) => {
          operation = "insert";
          payload = nextPayload;
          return builder;
        },
        upsert: (nextPayload: Record<string, unknown>) => {
          operation = "insert";
          payload = nextPayload;
          return builder;
        },
        delete: () => {
          operation = "delete";
          return builder;
        },
        eq: (column: string, value: unknown) => {
          eqs.push([column, value]);
          return builder;
        },
        is: (column: string, value: unknown) => {
          ises.push([column, value]);
          return builder;
        },
        order: () => builder,
        maybeSingle: () => Promise.resolve(executeSingle()),
        single: () => Promise.resolve(executeSingle()),
        then: (
          resolve: (value: { data: unknown; error: null }) => unknown,
        ) => Promise.resolve(resolve(execute() as { data: unknown; error: null })),
      });
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

beforeEach(() => {
  state.sessions = [
    {
      id: OLD_SESSION_ID,
      user_id: USER_ID,
      title: "Strength day",
      slot: "single",
      planned_at: null,
      deleted_at: null,
      completed_at: null,
    },
  ];
  state.planned = {
    id: PLANNED_ID,
    user_id: USER_ID,
    title: "Strength day",
    slot: "single",
    planned_at: null,
    prescription,
    completed_session_id: OLD_SESSION_ID,
  };
  state.setLogs = [
    {
      id: "old-set-1",
      session_id: OLD_SESSION_ID,
      movementId: "squat",
      setKind: "main",
      prescriptionItemIndex: 0,
    },
  ];
  state.revalidated = [];
});

/** Read set logs the way the app does — through the Supabase client. */
async function setLogsForSession(sessionId: string): Promise<LoggedSet[]> {
  const { createClient } = await import("@/lib/supabase/server");
  const supabase = await createClient();
  const { data } = await supabase
    .from("set_logs")
    .select("id, session_id, movementId, setKind, prescriptionItemIndex")
    .eq("session_id", sessionId);
  return (data ?? []) as unknown as LoggedSet[];
}

describe("deleteSession → startSessionDirect", () => {
  it("starts clean with zero progress and the cursor at the first item", async () => {
    // DC-K4: the reversible delete does not silently carry an old override /
    // progress state into the next materialised workout.
    const { deleteSession } = await import("../actions");
    const formData = new FormData();
    formData.set("id", OLD_SESSION_ID);

    const deleted = await deleteSession(formData);
    expect(deleted.ok).toBe(true);
    expect(state.sessions[0]!.deleted_at).toBeTruthy();
    // The cancelled attempt keeps its logs — delete is reversible.
    expect(await setLogsForSession(OLD_SESSION_ID)).toHaveLength(1);

    const { startSessionDirect } = await import("../../planner/actions");
    // Assert against the session we actually LAND on, not a hardcoded id:
    // the pre-fix behaviour revived the soft-deleted session, so the
    // "fresh session has no logs" assertions below have to be evaluated on
    // the redirect target to be able to fail.
    const landedId = await startSessionDirect(PLANNED_ID).then(
      () => {
        throw new Error("startSessionDirect should always redirect");
      },
      (error: unknown) => {
        expect(error).toBeInstanceOf(RedirectError);
        return (error as RedirectError).target.replace("/app/sessions/", "");
      },
    );

    expect(landedId).not.toBe(OLD_SESSION_ID);
    expect(landedId).toBe(FRESH_SESSION_ID);
    expect(state.sessions.map((session) => session.id)).toContain(landedId);
    expect(state.planned.completed_session_id).toBe(landedId);

    // The landed session carries none of the deleted attempt's set logs.
    const freshSets = await setLogsForSession(landedId);
    expect(freshSets).toHaveLength(0);
    expect(state.setLogs).toHaveLength(1);
    expect(state.setLogs[0]!.session_id).toBe(OLD_SESSION_ID);

    const matched = matchPrescriptionItems(state.planned.prescription, freshSets);
    expect(matched.size).toBe(0);

    const [firstGroup] = groupPrescriptionByMovement(state.planned.prescription);
    expect(firstGroup).toBeDefined();
    expect(autoCursorForGroup(firstGroup!, matched)).toBe(0);
  });

  it("keeps a set logged against the fresh session separate from the deleted one", async () => {
    // Guards the mock itself: `set_logs` is a real table here, so the
    // "fresh session has no logs" assertion above is falsifiable rather than
    // vacuously true against an unimplemented table.
    const { deleteSession } = await import("../actions");
    const formData = new FormData();
    formData.set("id", OLD_SESSION_ID);
    await deleteSession(formData);

    const { startSessionDirect } = await import("../../planner/actions");
    await expect(startSessionDirect(PLANNED_ID)).rejects.toBeInstanceOf(
      RedirectError,
    );

    const { createClient } = await import("@/lib/supabase/server");
    const supabase = await createClient();
    await supabase.from("set_logs").insert({
      id: "fresh-set-1",
      session_id: FRESH_SESSION_ID,
      movementId: "squat",
      setKind: "main",
      prescriptionItemIndex: 0,
    });

    const freshSets = await setLogsForSession(FRESH_SESSION_ID);
    expect(freshSets.map((set) => set.id)).toEqual(["fresh-set-1"]);
    const oldSets = await setLogsForSession(OLD_SESSION_ID);
    expect(oldSets.map((set) => set.id)).toEqual(["old-set-1"]);
  });
});
