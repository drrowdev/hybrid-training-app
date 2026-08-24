/**
 * Regression test for the atomic-block-creation data-integrity fix.
 *
 * `archivePriorActiveBlocks` is the final, conditional step of block creation:
 * it must archive only OTHER active blocks (scoped to the user, excluding the
 * just-created block) and report — rather than throw — when the update fails,
 * so the caller can treat an archive failure as non-fatal (a recoverable
 * two-active state) instead of orphaning the user.
 *
 * Uses a hand-rolled fake supabase client (no new deps) that records the
 * filter chain and update payload the helper applies.
 */
import { describe, expect, it } from "vitest";
import { archivePriorActiveBlocks } from "../archive-prior-blocks";

type UpdateCall = {
  table: string;
  payload: Record<string, unknown>;
  eq: Array<[string, unknown]>;
  neq: Array<[string, unknown]>;
  in: Array<[string, unknown]>;
};

function fakeSupabase(
  error: { message: string } | null = null,
  archived: { id: string }[] = [],
) {
  const calls: UpdateCall[] = [];
  const client = {
    from(table: string) {
      return {
        update(payload: Record<string, unknown>) {
          const call: UpdateCall = { table, payload, eq: [], neq: [], in: [] };
          calls.push(call);
          const q: Record<string, unknown> = {
            eq(col: string, val: unknown) {
              call.eq.push([col, val]);
              return q;
            },
            neq(col: string, val: unknown) {
              call.neq.push([col, val]);
              return q;
            },
            in(col: string, vals: unknown[]) {
              call.in.push([col, vals]);
              return q;
            },
            select: () => q,
            then: <T,>(
              fn: (v: { data: { id: string }[]; error: { message: string } | null }) => T,
            ) => Promise.resolve(fn({ data: archived, error })),
          };
          return q;
        },
      };
    },
  } as unknown as Parameters<typeof archivePriorActiveBlocks>[0];
  return { client, calls };
}

describe("archivePriorActiveBlocks (atomic block creation fix)", () => {
  it("archives only OTHER active blocks for the user, excluding the new block", async () => {
    const { client, calls } = fakeSupabase();
    const out = await archivePriorActiveBlocks(client, "user-1", "new-block");

    expect(out.error).toBeNull();
    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.table).toBe("training_blocks");
    expect(call.payload.status).toBe("archived");
    expect(call.payload.archived_at).toBeTruthy();
    expect(call.payload.ended_at).toBeTruthy();
    // Must scope to the user and to active rows, and exclude the new block so
    // the just-created active block survives.
    expect(call.eq).toContainEqual(["user_id", "user-1"]);
    expect(call.eq).toContainEqual(["status", "active"]);
    expect(call.neq).toContainEqual(["id", "new-block"]);
  });

  it("retires nudges that belonged to the blocks it archived", async () => {
    const { client, calls } = fakeSupabase(null, [{ id: "old-1" }, { id: "old-2" }]);
    await archivePriorActiveBlocks(client, "user-1", "new-block");

    const nudges = calls.find((c) => c.table === "program_recommendations");
    expect(nudges, "pending advice for an archived plan should not survive it").toBeTruthy();
    expect(nudges!.payload.status).toBe("dismissed");
    expect(nudges!.eq).toContainEqual(["user_id", "user-1"]);
    expect(nudges!.eq).toContainEqual(["status", "pending"]);
    expect(nudges!.in).toContainEqual(["block_id", ["old-1", "old-2"]]);
  });

  it("leaves nudges alone when there was nothing to archive", async () => {
    const { client, calls } = fakeSupabase(null, []);
    await archivePriorActiveBlocks(client, "user-1", "new-block");
    expect(calls.some((c) => c.table === "program_recommendations")).toBe(false);
  });

  it("returns the error message instead of throwing when the update fails", async () => {
    const { client } = fakeSupabase({ message: "permission denied" });
    const out = await archivePriorActiveBlocks(client, "user-1", "new-block");
    expect(out.error).toBe("permission denied");
  });
});
