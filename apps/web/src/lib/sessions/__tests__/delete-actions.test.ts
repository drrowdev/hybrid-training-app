/**
 * deleteSet / deleteCardio error-surfacing tests (defect #5).
 *
 * Both actions previously destructured `{ error }` from the Supabase
 * `.delete()` call and never checked it, so a failed delete (RLS denial,
 * dropped connection, etc.) returned successfully to the caller. The set
 * or cardio entry stayed on screen, but `MovementFocusView.runUndo`'s
 * optimistic "it's gone" state (and the plain `<form action={deleteCardio}>`
 * on the session page) had no way to know the delete never happened.
 *
 * #792 ("fix(recovery): unify session load state") independently fixed the
 * same throw-on-error behavior while reworking the post-completion recompute
 * call (now `recomputeAfterCompletedSessionMutation` from
 * `../post-completion-recompute`, replacing the old
 * `recomputeActualSessionLoad` import this file used to mock). These tests
 * are kept — rewritten against the merged helper — as regression coverage
 * pinning that throw-on-error behavior directly against `deleteSet`/
 * `deleteCardio`, since no other test in the suite exercises those two
 * functions' own error handling (the other post-#792 tests exercise the
 * recompute helper's internals, not the delete actions).
 *
 * These actions are plain server actions with no component to mount, so —
 * consistent with this repo's "no jsdom/RTL" testing convention — they're
 * exercised directly against a mocked Supabase client rather than via a
 * rendered component.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const SET_ID = "00000000-0000-4000-8000-0000000000b1";
const CARDIO_ID = "00000000-0000-4000-8000-0000000000c1";

let setLogsDeleteError: string | null = null;
let cardioLogsDeleteError: string | null = null;
const deleteCalls: Array<{ table: string; eqs: Array<[string, unknown]> }> = [];

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("../post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: vi.fn(async () => ({ recomputed: false })),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u-1" } } }) },
    from: (table: string) => {
      const eqs: Array<[string, unknown]> = [];
      const builder: {
        eq: (col: string, val: unknown) => typeof builder;
        then: (
          resolve: (v: { error: { message: string } | null }) => unknown,
          reject?: (e: unknown) => unknown,
        ) => unknown;
      } = {
        eq: (col: string, val: unknown) => {
          eqs.push([col, val]);
          return builder;
        },
        then: (resolve, reject) => {
          deleteCalls.push({ table, eqs });
          const message =
            table === "set_logs"
              ? setLogsDeleteError
              : table === "cardio_logs"
                ? cardioLogsDeleteError
                : null;
          return Promise.resolve({
            error: message ? { message } : null,
          }).then(resolve, reject);
        },
      };
      return {
        delete: () => builder,
      };
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: "u-1" } }, error: null }),
}));

describe("deleteSet / deleteCardio (defect #5)", () => {
  beforeEach(() => {
    setLogsDeleteError = null;
    cardioLogsDeleteError = null;
    deleteCalls.length = 0;
  });

  it("deleteSet silently succeeds and targets set_logs by id when the delete lands", async () => {
    const { deleteSet } = await import("../actions");
    const fd = new FormData();
    fd.set("id", SET_ID);
    fd.set("sessionId", SESSION_ID);

    await expect(deleteSet(fd)).resolves.toBeUndefined();
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.table).toBe("set_logs");
    expect(deleteCalls[0]!.eqs).toEqual([["id", SET_ID]]);
  });

  it("deleteSet throws instead of silently ignoring a database error", async () => {
    setLogsDeleteError = "insert or update violates row-level security policy";
    const { deleteSet } = await import("../actions");
    const fd = new FormData();
    fd.set("id", SET_ID);
    fd.set("sessionId", SESSION_ID);

    await expect(deleteSet(fd)).rejects.toThrow(/row-level security/);
  });

  it("deleteCardio silently succeeds and targets cardio_logs by id when the delete lands", async () => {
    const { deleteCardio } = await import("../actions");
    const fd = new FormData();
    fd.set("id", CARDIO_ID);
    fd.set("sessionId", SESSION_ID);

    await expect(deleteCardio(fd)).resolves.toBeUndefined();
    expect(deleteCalls).toHaveLength(1);
    expect(deleteCalls[0]!.table).toBe("cardio_logs");
    expect(deleteCalls[0]!.eqs).toEqual([["id", CARDIO_ID]]);
  });

  it("deleteCardio throws instead of silently ignoring a database error", async () => {
    cardioLogsDeleteError = "connection reset";
    const { deleteCardio } = await import("../actions");
    const fd = new FormData();
    fd.set("id", CARDIO_ID);
    fd.set("sessionId", SESSION_ID);

    await expect(deleteCardio(fd)).rejects.toThrow(/connection reset/);
  });
});
