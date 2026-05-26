/**
 * PR Z1 — cross-device sync action tests.
 *
 * Each action mocks the Supabase server client and asserts:
 *   1. The right table got UPDATEd with the right columns.
 *   2. The defence-in-depth `.eq("user_id", user.id)` (or `id`,
 *      depending on the table) was applied so an unauthenticated /
 *      cross-user write can't slip through even when RLS is mid-
 *      change.
 *
 * Inline factory — no shared harness because Vitest's `vi.mock` is
 * top-level only and the existing tests in this folder all roll their
 * own. See `swap-actions.test.ts` for the established pattern.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000099";
const PLANNED_SESSION_ID = "00000000-0000-4000-8000-0000000000c1";

type UpdateCall = {
  table: string;
  update: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
};

const calls: UpdateCall[] = [];

vi.mock("next/cache", () => ({
  revalidatePath: () => {},
}));

vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect called — not signed in");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
    from: (table: string) => {
      const call: UpdateCall = { table, update: {}, eqs: [] };
      const q: Record<string, (...a: never[]) => unknown> = {
        update: ((row: Record<string, unknown>) => {
          call.update = row;
          calls.push(call);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        eq: ((col: string, val: unknown) => {
          call.eqs.push([col, val]);
          return Promise.resolve({ error: null });
        }) as (...a: never[]) => unknown,
      };
      // The action chain is `.update(...).eq("id", ...).eq("user_id", ...)`.
      // Make every eq return a thenable so the first `.eq` settles the
      // promise while the second still works for chains that need it.
      const eqChain = (col: string, val: unknown) => {
        call.eqs.push([col, val]);
        const next = {
          eq: eqChain,
          then: (onF: (v: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(onF),
        };
        return next;
      };
      q.eq = eqChain as unknown as (...a: never[]) => unknown;
      return q;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

describe("updatePlannedSessionNotes (PR Z1)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("updates planned_sessions.notes for the row, scoped to the user", async () => {
    const { updatePlannedSessionNotes } = await import("../actions");
    const result = await updatePlannedSessionNotes(
      PLANNED_SESSION_ID,
      "stay tight on the front rack",
    );
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.table).toBe("planned_sessions");
    expect(c.update).toEqual({ notes: "stay tight on the front rack" });
    expect(c.eqs).toEqual([
      ["id", PLANNED_SESSION_ID],
      ["user_id", USER_ID],
    ]);
  });

  it("persists null when the text is empty (or whitespace-only)", async () => {
    const { updatePlannedSessionNotes } = await import("../actions");
    await updatePlannedSessionNotes(PLANNED_SESSION_ID, "   ");
    expect(calls[0]!.update).toEqual({ notes: null });
  });

  it("rejects a non-UUID id without touching the DB", async () => {
    const { updatePlannedSessionNotes } = await import("../actions");
    const result = await updatePlannedSessionNotes("not-a-uuid", "x");
    expect(result.error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });

  it("caps notes at 2000 chars", async () => {
    const { updatePlannedSessionNotes } = await import("../actions");
    const result = await updatePlannedSessionNotes(
      PLANNED_SESSION_ID,
      "x".repeat(2001),
    );
    expect(result.error).toBeTruthy();
    expect(calls).toHaveLength(0);
  });
});
