/**
 * `addStrengthSet` must re-stamp derived state when the set lands on an
 * ALREADY-COMPLETED session.
 *
 * Before this change the action performed NO recomputation at all — the
 * restriction on adding a set to a finished session was purely UI-level, so the
 * moment the UI allowed it (`AddSetAfterCompletion`, reached from the drawer's
 * ✎ Edit) `planned_sessions.effective_stress_load` and `region_state` would
 * silently drift.
 *
 * Uses the lightweight Supabase mock pattern from `log-cardio-session.test.ts`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const MOVEMENT_ID = "00000000-0000-4000-8000-000000000020";

const setInserts: Array<Record<string, unknown>> = [];
const recomputeCalls: Array<Record<string, unknown>> = [];
const revalidated: string[] = [];

/** Flip to simulate an offline-outbox replay hitting the unique index. */
let insertConflict = false;
/** What the shared post-completion helper reports back. */
let recomputed = false;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    rpc: async () => ({
      data: null,
      error: { code: "PGRST202", message: "Function not found" },
    }),
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      Object.assign(builder, {
        select: () => builder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: table === "set_logs" ? { id: "existing-row" } : null,
          error: null,
        }),
        insert: (row: Record<string, unknown>) => {
          if (table === "set_logs") setInserts.push(row);
          return {
            select: () => ({
              single: async () =>
                insertConflict
                  ? { data: null, error: { code: "23505", message: "dupe" } }
                  : { data: { id: "new-row" }, error: null },
            }),
          };
        },
      });
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (p: string) => {
    revalidated.push(p);
  },
}));

vi.mock("../post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: async (
    args: Record<string, unknown>,
  ) => {
    recomputeCalls.push(args);
    return { recomputed };
  },
}));

function postHocSet(): FormData {
  const fd = new FormData();
  fd.set("sessionId", SESSION_ID);
  fd.set("movementId", MOVEMENT_ID);
  fd.set("setKind", "main");
  fd.set("weightKg", "100");
  fd.set("reps", "5");
  // No `prescriptionItemIndex` — a post-hoc set has no prescribed slot.
  return fd;
}

describe("addStrengthSet — post-completion recompute", () => {
  beforeEach(() => {
    setInserts.length = 0;
    recomputeCalls.length = 0;
    revalidated.length = 0;
    insertConflict = false;
    recomputed = false;
  });

  it("routes every new row through the shared post-completion recompute", async () => {
    const { addStrengthSet } = await import("../actions");
    const res = await addStrengthSet(postHocSet());
    expect(res.ok).toBe(true);
    expect(recomputeCalls).toHaveLength(1);
    expect(recomputeCalls[0]).toMatchObject({
      sessionId: SESSION_ID,
      userId: USER_ID,
    });
  });

  it("stores a NULL prescription_item_index for a post-hoc set", async () => {
    // The join key that drives movement attribution. NULL is the only value
    // that cannot collide with, or shift, an existing index.
    const { addStrengthSet } = await import("../actions");
    await addStrengthSet(postHocSet());
    expect(setInserts).toHaveLength(1);
    expect(setInserts[0]!.prescription_item_index).toBeNull();
    expect(setInserts[0]!.skipped).toBe(false);
  });

  it("revalidates Today + Plan + the session ONLY when the session was complete", async () => {
    const { addStrengthSet } = await import("../actions");

    // In-flight session: the helper reports no recompute, and the live-logging
    // hot path must stay free of per-set page rebuilds (the optimistic overlay
    // owns the in-session snapshot).
    recomputed = false;
    await addStrengthSet(postHocSet());
    expect(revalidated).toEqual([]);

    // Completed session: `effective_stress_load` just moved, and Today + Plan
    // both read it.
    recomputed = true;
    await addStrengthSet(postHocSet());
    expect(revalidated).toEqual([
      "/app",
      "/app/plan",
      `/app/sessions/${SESSION_ID}`,
    ]);
  });

  it("skips the recompute on a duplicate offline replay", async () => {
    // A 23505 on `client_log_id` means the row was already persisted, so
    // nothing derived moved — recomputing the whole region ledger again would
    // be pure waste.
    insertConflict = true;
    const fd = postHocSet();
    fd.set("clientLogId", "11111111-1111-4111-8111-1111111111ab");
    const { addStrengthSet } = await import("../actions");
    const res = await addStrengthSet(fd);
    expect(res.ok).toBe(true);
    expect(recomputeCalls).toHaveLength(0);
  });
});
