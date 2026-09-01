/**
 * logCardioSession server action — success + failure path coverage.
 *
 * Uses the same lightweight Supabase mock pattern as
 * `swap-actions.test.ts` so we don't pull in a full Postgres stub.
 * The mock records every insert / update so the assertions can prove
 * the action wrote the right row + flipped `sessions.completed_at`
 * when `completed=true`.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const OTHER_USER_ID = "00000000-0000-4000-8000-0000000000ff";

type SessionRow = {
  id: string;
  user_id: string;
  completed_at: string | null;
};

const sessions: SessionRow[] = [
  { id: SESSION_ID, user_id: USER_ID, completed_at: null },
];

const cardioInserts: Array<Record<string, unknown>> = [];
const sessionUpdates: Array<{ id: string; patch: Record<string, unknown> }> = [];
let cardioBlockInsertError: { code: string; message: string } | null = null;
let existingCardioClientId: string | null = null;
// review-208 #2 — per-table count returned to the hybrid guard. Tests
// override these to simulate unlogged strength work.
const tableCounts: Record<string, number> = {
  cardio_logs: 0,
  session_items: 0,
  set_logs: 0,
};

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
    from: (table: string) => {
      const state: {
        eqs: Array<[string, unknown]>;
        isNull: string | null;
        update?: Record<string, unknown>;
        countOnly?: boolean;
      } = { eqs: [], isNull: null };

      const builder: Record<string, unknown> = {};

      const select = (
        _cols: string,
        opts?: { count?: string; head?: boolean },
      ) => {
        state.countOnly = !!opts?.head;
        return builder;
      };
      const eq = (col: string, val: unknown) => {
        state.eqs.push([col, val]);
        return builder;
      };
      const is = (col: string, _val: unknown) => {
        state.isNull = col;
        return builder;
      };
      const order = () => builder;
      const maybeSingle = async () => {
        if (table === "sessions") {
          const id = state.eqs.find(([c]) => c === "id")?.[1];
          const row = sessions.find((s) => s.id === id) ?? null;
          return { data: row, error: null };
        }
        if (table === "planned_sessions") {
          return { data: null, error: null };
        }
        if (table === "cardio_logs") {
          const clientLogId = state.eqs.find(([c]) => c === "client_log_id")?.[1];
          return {
            data:
              clientLogId && clientLogId === existingCardioClientId
                ? { id: "existing-cardio-id" }
                : null,
            error: null,
          };
        }
        return { data: null, error: null };
      };

      const insert = (row: Record<string, unknown>) => {
        if (table === "cardio_logs") cardioInserts.push(row);
        return {
          select: () => ({
            single: async () => ({ data: { id: "new-id" }, error: null }),
          }),
          // bare insert (no chained select) — returns { error: null }.
          then: (
            resolve: (v: { error: { code: string; message: string } | null }) => unknown,
          ) =>
            resolve({ error: cardioBlockInsertError }),
        };
      };

      // review-208 #1 — action now uses upsert(...,{onConflict})
      // instead of insert. Mock it to call into the same insert sink
      // so existing assertions keep working.
      const upsert = (
        row: Record<string, unknown>,
        _opts?: { onConflict?: string },
      ) => {
        if (table === "cardio_logs") cardioInserts.push(row);
        return Promise.resolve({ error: null });
      };

      const update = (patch: Record<string, unknown>) => {
        state.update = patch;
        return {
          eq: (col: string, val: unknown) => {
            if (table === "sessions" && col === "id") {
              sessionUpdates.push({ id: val as string, patch });
              const s = sessions.find((r) => r.id === val);
              if (s && patch.completed_at !== undefined) {
                s.completed_at = patch.completed_at as string | null;
              }
            }
            return Promise.resolve({ error: null });
          },
        };
      };

      Object.assign(builder, {
        select,
        eq,
        is,
        order,
        maybeSingle,
        insert,
        upsert,
        update,
      });

      // Count query (`.select("id", { count: "exact", head: true })`)
      // resolves via `await` on the builder itself when `.eq()` is
      // not chained further. Emulate that by returning a thenable
      // when `countOnly` is true. Per-table count comes from the
      // shared `tableCounts` map so tests can simulate hybrid state.
      (builder as { then?: unknown }).then = (
        resolve: (v: { count: number; error: null }) => unknown,
      ) => resolve({ count: tableCounts[table] ?? 0, error: null });

      return builder;
    },
  }),
  getAuthUser: async () => ({
    data: { user: { id: USER_ID } },
    error: null,
  }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: () => undefined,
}));

vi.mock("@/lib/engine/region-ledger", () => ({
  recomputeRegionState: async () => undefined,
}));

vi.mock("@/lib/engine/recompute-actual-session-load", () => ({
  recomputeActualSessionLoad: async () => undefined,
}));
vi.mock("../post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: async () => ({ recomputed: false }),
}));

vi.mock("@/lib/planner/completion", () => ({
  maybeCompleteBlock: async () => undefined,
}));

vi.mock("@/lib/planner/queries", () => ({
  getUserTimezone: async () => "UTC",
}));

describe("logCardioSession", () => {
  beforeEach(() => {
    cardioInserts.length = 0;
    sessionUpdates.length = 0;
    sessions[0]!.completed_at = null;
    sessions[0]!.user_id = USER_ID;
    tableCounts.cardio_logs = 0;
    tableCounts.session_items = 0;
    tableCounts.set_logs = 0;
    cardioBlockInsertError = null;
    existingCardioClientId = null;
  });

  it("writes a cardio_logs row and marks the session completed on the happy path", async () => {
    const { logCardioSession } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("completed", "true");
    fd.set("actualDurationMin", "35");
    fd.set("avgRpe", "8");
    fd.set("notes", "Felt strong on intervals 3 and 4.");
    fd.set("modality", "running");

    const res = await logCardioSession(fd);
    expect(res).toEqual({ ok: true });

    expect(cardioInserts).toHaveLength(1);
    const row = cardioInserts[0]!;
    expect(row.session_id).toBe(SESSION_ID);
    expect(row.duration_sec).toBe(35 * 60);
    expect(row.rpe).toBe(8);
    expect(row.notes).toBe("Felt strong on intervals 3 and 4.");
    expect(row.modality).toBe("running");

    // The session is flipped to completed and inherits duration + RPE.
    const update = sessionUpdates.find((u) => u.id === SESSION_ID);
    expect(update).toBeDefined();
    expect(update!.patch.completed_at).toBeTypeOf("string");
    expect(update!.patch.duration_min).toBe(35);
    expect(update!.patch.session_rpe).toBe(8);
  });

  it("returns a structured error when validation fails", async () => {
    const { logCardioSession } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", "not-a-uuid");
    fd.set("actualDurationMin", "10");

    const res = await logCardioSession(fd);
    expect(res.ok).toBeUndefined();
    expect(res.error).toBeTypeOf("string");
    expect(res.errorCode).toBe("validation");
    expect(cardioInserts).toHaveLength(0);
    expect(sessionUpdates).toHaveLength(0);
  });

  it("returns a Not your session error when the user doesn't own the row", async () => {
    sessions[0]!.user_id = OTHER_USER_ID;
    const { logCardioSession } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("actualDurationMin", "30");

    const res = await logCardioSession(fd);
    expect(res.error).toMatch(/not your session/i);
    expect(res.errorCode).toBe("forbidden");
    expect(cardioInserts).toHaveLength(0);
  });

  it("persists the client id used for an idempotent replay", async () => {
    const { logCardioSession } = await import("../actions");
    const clientLogId = "00000000-0000-4000-8000-000000000099";
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("actualDurationMin", "20");
    fd.set("clientLogId", clientLogId);

    const res = await logCardioSession(fd);
    expect(res).toEqual({ ok: true });
    expect(cardioInserts[0]?.client_log_id).toBe(clientLogId);
  });

  it("does not treat a different unique conflict as an idempotent replay", async () => {
    const { addCardioBlock } = await import("../actions");
    const clientLogId = "00000000-0000-4000-8000-000000000098";
    cardioBlockInsertError = {
      code: "23505",
      message: "cardio_logs_session_id_block_index_key",
    };
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("movementId", "00000000-0000-4000-8000-000000000011");
    fd.set("modality", "running");
    fd.set("durationSec", "1200");
    fd.set("clientLogId", clientLogId);

    const res = await addCardioBlock(fd);

    expect(res.errorCode).toBe("transient");
    expect(res.ok).toBeUndefined();
  });

  it("accepts a unique conflict only when the client id already exists", async () => {
    const { addCardioBlock } = await import("../actions");
    const clientLogId = "00000000-0000-4000-8000-000000000097";
    cardioBlockInsertError = { code: "23505", message: "duplicate client id" };
    existingCardioClientId = clientLogId;
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("movementId", "00000000-0000-4000-8000-000000000011");
    fd.set("modality", "running");
    fd.set("durationSec", "1200");
    fd.set("clientLogId", clientLogId);

    const res = await addCardioBlock(fd);

    expect(res).toEqual({ ok: true });
  });

  it("logs but does NOT flip completed_at when completed=false (skip path)", async () => {
    const { logCardioSession } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("completed", "false");
    fd.set("actualDurationMin", "15");

    const res = await logCardioSession(fd);
    expect(res).toEqual({ ok: true });
    expect(cardioInserts).toHaveLength(1);
    expect(sessionUpdates).toHaveLength(0);
    expect(sessions[0]!.completed_at).toBeNull();
  });

  // review-208 #2 — hybrid session with unlogged strength must NOT
  // auto-complete the session via the cardio path. The cardio log
  // still writes; only the completed_at flip is gated.
  it("does NOT flip completed_at on hybrid sessions with zero strength sets", async () => {
    tableCounts.session_items = 2; // squat + ohp prescribed
    tableCounts.set_logs = 0; // user logged no strength sets

    const { logCardioSession } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("completed", "true");
    fd.set("actualDurationMin", "35");
    fd.set("avgRpe", "7");

    const res = await logCardioSession(fd);
    expect(res).toEqual({ ok: true });
    expect(cardioInserts).toHaveLength(1);
    // No session update — strength finish bar must take over.
    expect(sessionUpdates).toHaveLength(0);
    expect(sessions[0]!.completed_at).toBeNull();
  });

  // Regression guard: hybrid session WITH logged strength sets still
  // completes via the cardio path.
  it("DOES flip completed_at on hybrid sessions when strength sets are already logged", async () => {
    tableCounts.session_items = 2;
    tableCounts.set_logs = 6; // user already logged sets

    const { logCardioSession } = await import("../actions");

    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("completed", "true");
    fd.set("actualDurationMin", "35");

    const res = await logCardioSession(fd);
    expect(res).toEqual({ ok: true });
    expect(cardioInserts).toHaveLength(1);
    expect(sessionUpdates).toHaveLength(1);
    expect(sessions[0]!.completed_at).toBeTypeOf("string");
  });

  // review-208 #3 — Zod schema now uses `.strict()`. The action's
  // explicit field-by-field FormData unpacking already acts as a
  // whitelist, but `.strict()` is defense-in-depth for any future
  // refactor that switches to `Object.fromEntries(formData)`.
  // Not directly testable here because the spoofed field would never
  // reach Zod under the current unpacking — verified by static
  // inspection of `logCardioSession`.
});
