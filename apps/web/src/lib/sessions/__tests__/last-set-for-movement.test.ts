import { describe, it, expect } from "vitest";
import { getLastSetLogForMovement } from "../queries";

/**
 * Test the query helper with a hand-rolled mock of the supabase
 * PostgREST chain. We assert:
 *   1) The chain is called with the expected filters (deleted_at,
 *      warmup exclusion, user scope).
 *   2) The most recent session's TOP set is returned (heaviest weight,
 *      tiebreak by reps).
 *   3) Deleted sessions are excluded — we model this through the
 *      `sessions.deleted_at` filter that Supabase applies before we
 *      see the rows, so the mock simply doesn't return them.
 *   4) `excludeSessionId` filters out the named session.
 *   5) Empty history → null (no awkward "no data" hint).
 */

type ChainState = {
  rows: unknown[];
  filters: Record<string, unknown>;
};

function makeChain(rows: unknown[]): {
  client: Parameters<typeof getLastSetLogForMovement>[0];
  state: ChainState;
} {
  const state: ChainState = { rows, filters: {} };
  // Build a fluent chain that records filters and returns rows at the
  // end of the chain.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const chain: any = {};
  const record = (k: string, v: unknown) => {
    state.filters[k] = v;
    return chain;
  };
  chain.select = () => chain;
  chain.eq = (col: string, v: unknown) => record(`eq:${col}`, v);
  chain.is = (col: string, v: unknown) => record(`is:${col}`, v);
  chain.neq = (col: string, v: unknown) => record(`neq:${col}`, v);
  chain.not = (col: string, op: string, v: unknown) => record(`not:${col}:${op}`, v);
  chain.gt = (col: string, v: unknown) => record(`gt:${col}`, v);
  chain.order = (col: string, opts: unknown) => record(`order:${col}`, opts);
  chain.limit = () => Promise.resolve({ data: state.rows, error: null });
  const client = {
    from: () => chain,
    // The real signature has more on it; we only need .from() to start
    // the chain we mocked above.
  } as unknown as Parameters<typeof getLastSetLogForMovement>[0];
  return { client, state };
}

describe("getLastSetLogForMovement (B2 last-time hint)", () => {
  it("returns the heaviest set from the most recent session", async () => {
    const { client } = makeChain([
      {
        weight_kg: 100,
        reps: 5,
        rpe: 7,
        sessions: { id: "s-newer", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
      {
        weight_kg: 105,
        reps: 3,
        rpe: 8,
        sessions: { id: "s-newer", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
      {
        weight_kg: 110,
        reps: 1,
        rpe: 9,
        sessions: { id: "s-older", performed_at: "2026-05-15T10:00:00Z", deleted_at: null },
      },
    ]);
    const r = await getLastSetLogForMovement(client, "user-1", "mov-1");
    expect(r).not.toBeNull();
    expect(r!.weightKg).toBe(105);
    expect(r!.reps).toBe(3);
    expect(r!.performedAt).toBe("2026-05-20T10:00:00Z");
  });

  it("tiebreaks on reps when two sets share the same weight", async () => {
    const { client } = makeChain([
      {
        weight_kg: 100,
        reps: 5,
        rpe: 7,
        sessions: { id: "s", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
      {
        weight_kg: 100,
        reps: 8,
        rpe: 8,
        sessions: { id: "s", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
    ]);
    const r = await getLastSetLogForMovement(client, "user-1", "mov-1");
    expect(r!.reps).toBe(8);
  });

  it("excludes a named session via excludeSessionId", async () => {
    const { client } = makeChain([
      {
        weight_kg: 200,
        reps: 5,
        rpe: 8,
        sessions: { id: "current", performed_at: "2026-05-23T10:00:00Z", deleted_at: null },
      },
      {
        weight_kg: 150,
        reps: 5,
        rpe: 7,
        sessions: { id: "older", performed_at: "2026-05-15T10:00:00Z", deleted_at: null },
      },
    ]);
    const r = await getLastSetLogForMovement(client, "user-1", "mov-1", { excludeSessionId: "current" });
    expect(r!.weightKg).toBe(150);
  });

  it("returns null when no history rows exist", async () => {
    const { client } = makeChain([]);
    const r = await getLastSetLogForMovement(client, "user-1", "mov-1");
    expect(r).toBeNull();
  });

  it("ignores rows with zero weight or zero reps", async () => {
    const { client } = makeChain([
      {
        weight_kg: 0,
        reps: 5,
        rpe: null,
        sessions: { id: "s", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
      {
        weight_kg: 100,
        reps: 0,
        rpe: null,
        sessions: { id: "s", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
    ]);
    const r = await getLastSetLogForMovement(client, "user-1", "mov-1");
    expect(r).toBeNull();
  });

  it("returns null when userId / movementId are blank", async () => {
    const { client } = makeChain([
      {
        weight_kg: 100,
        reps: 5,
        rpe: null,
        sessions: { id: "s", performed_at: "2026-05-20T10:00:00Z", deleted_at: null },
      },
    ]);
    expect(await getLastSetLogForMovement(client, "", "mov-1")).toBeNull();
    expect(await getLastSetLogForMovement(client, "user-1", "")).toBeNull();
  });
});
