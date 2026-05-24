/**
 * Swap-active-movement audit-action test.
 *
 * Asserts the action records an `engine_override_events` row whose
 * `context.kind` is `"movement_swap"` and carries the session id +
 * reason category, per the mid-workout swap contract.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

type Movement = { id: string; slug: string; display_name: string };
type SessionRow = { id: string; user_id: string };

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const ORIGINAL_ID = "00000000-0000-4000-8000-0000000000a1";
const NEW_ID = "00000000-0000-4000-8000-0000000000a2";

const movements: Movement[] = [
  { id: ORIGINAL_ID, slug: "front-squat", display_name: "Front Squat" },
  { id: NEW_ID, slug: "goblet-squat", display_name: "Goblet Squat" },
];
const sessions: SessionRow[] = [{ id: SESSION_ID, user_id: USER_ID }];
const overrideInserts: Array<Record<string, unknown>> = [];

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: USER_ID } } }),
    },
    from: (table: string) => {
      const state: { eqs: Array<[string, unknown]>; insert?: Record<string, unknown> } = { eqs: [] };
      const q: Record<string, (...a: never[]) => unknown> = {
        select: (() => q) as (...a: never[]) => unknown,
        eq: ((col: string, val: unknown) => {
          state.eqs.push([col, val]);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        insert: ((row: Record<string, unknown>) => {
          state.insert = row;
          if (table === "engine_override_events") overrideInserts.push(row);
          return q as unknown;
        }) as (...a: never[]) => unknown,
        maybeSingle: (() => {
          if (table === "movements") {
            const id = state.eqs.find(([c]) => c === "id")?.[1];
            return Promise.resolve({ data: movements.find((m) => m.id === id) ?? null, error: null });
          }
          if (table === "sessions") {
            const id = state.eqs.find(([c]) => c === "id")?.[1];
            return Promise.resolve({ data: sessions.find((s) => s.id === id) ?? null, error: null });
          }
          if (table === "engine_override_events") {
            return Promise.resolve({ data: { id: "ovr-1" }, error: null });
          }
          return Promise.resolve({ data: null, error: null });
        }) as (...a: never[]) => unknown,
      };
      return q;
    },
  }),
}));

describe("swapActiveMovement", () => {
  beforeEach(() => {
    overrideInserts.length = 0;
  });

  it("writes an override-audit row with movement_swap context", async () => {
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "pain");
    fd.set("freeformReason", "right knee twinge");
    const result = await swapActiveMovement(fd);
    expect(result.ok).toBe(true);
    expect(result.newMovement?.slug).toBe("goblet-squat");
    expect(overrideInserts).toHaveLength(1);
    const row = overrideInserts[0]!;
    expect(row.event_type).toBe("swap");
    expect(row.original_movement_slug).toBe("front-squat");
    expect(row.new_movement_slug).toBe("goblet-squat");
    expect(row.user_id).toBe(USER_ID);
    const ctx = row.context as Record<string, unknown>;
    expect(ctx.kind).toBe("movement_swap");
    expect(ctx.sessionId).toBe(SESSION_ID);
    expect(ctx.originalMovementId).toBe(ORIGINAL_ID);
    expect(ctx.newMovementId).toBe(NEW_ID);
    expect(ctx.reasonCategory).toBe("pain");
    expect(ctx.freeformReason).toBe("right knee twinge");
  });

  it("rejects an unknown reason category", async () => {
    const { swapActiveMovement } = await import("../swap-actions");
    const fd = new FormData();
    fd.set("sessionId", SESSION_ID);
    fd.set("originalMovementId", ORIGINAL_ID);
    fd.set("newMovementId", NEW_ID);
    fd.set("reason", "bored");
    const result = await swapActiveMovement(fd);
    expect(result.error).toBeTruthy();
    expect(overrideInserts).toHaveLength(0);
  });
});
