import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  cleanupRun,
  createSmokeClient,
  createSmokeSession,
  createSmokeUser,
  deleteSession,
  getMovementIdBySlug,
  getSmokeEnv,
  SKIP_MESSAGE,
} from "./setup";

/**
 * Smoke tests for the session-movements RPCs introduced by PR #148
 * and hot-fixed by PR #150.
 *
 *   - add_session_movement(p_session_id, p_movement_id, p_user_id)
 *   - remove_session_movement(p_session_id, p_movement_id)
 *
 * These exercise the real SQL body — they would have caught the
 * "column reference session_id is ambiguous" bug that prod hit.
 */

const env = getSmokeEnv();

// Use a couple of distinct, real catalog slugs so the "different
// movements in parallel" test has 5 real ids to play with.
const PRIMARY_SLUG = "bench-press-flat";
const PARALLEL_SLUGS = [
  "bench-press-flat",
  "bench-press-incline",
  "bench-press-paused",
  "ohp-standing",
  "rdl-bb",
] as const;

describe.skipIf(!env)("session-movements RPC smoke", () => {
  let admin: SupabaseClient;
  let userId: string;
  let primaryMovementId: string;
  let parallelMovementIds: string[];

  // Sessions created per-test go in here so afterEach can drop them
  // regardless of which assertion failed.
  const createdSessions: string[] = [];

  beforeAll(async () => {
    admin = createSmokeClient(env!);
    const u = await createSmokeUser(admin);
    userId = u.userId;
    primaryMovementId = await getMovementIdBySlug(admin, PRIMARY_SLUG);
    parallelMovementIds = await Promise.all(
      PARALLEL_SLUGS.map((s) => getMovementIdBySlug(admin, s)),
    );
  });

  afterEach(async () => {
    // Drain — cascade kills attached session_movements / set_logs.
    const ids = createdSessions.splice(0, createdSessions.length);
    await Promise.all(
      ids.map(async (id) => {
        try {
          await deleteSession(admin, id);
        } catch {
          /* best-effort, see cleanupRun */
        }
      }),
    );
  });

  afterAll(async () => {
    await cleanupRun(admin, userId ?? null);
  });

  async function freshSession(label: string): Promise<string> {
    const id = await createSmokeSession(admin, userId, label);
    createdSessions.push(id);
    return id;
  }

  test("add_session_movement: happy path returns the inserted row", async () => {
    const sessionId = await freshSession("add-happy");

    const { data, error } = await admin.rpc("add_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
      p_user_id: userId,
    });

    expect(error).toBeNull();
    expect(Array.isArray(data)).toBe(true);
    expect(data).toHaveLength(1);
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row.out_session_id).toBe(sessionId);
    expect(row.out_movement_id).toBe(primaryMovementId);
    expect(typeof row.out_sort_order).toBe("number");
    expect(row.out_sort_order as number).toBeGreaterThan(0);
  });

  test("add_session_movement: idempotent — second call returns the same row", async () => {
    const sessionId = await freshSession("add-idempotent");

    const first = await admin.rpc("add_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
      p_user_id: userId,
    });
    expect(first.error).toBeNull();

    const second = await admin.rpc("add_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
      p_user_id: userId,
    });
    expect(second.error).toBeNull();

    const firstRow = (first.data as Array<Record<string, unknown>>)[0];
    const secondRow = (second.data as Array<Record<string, unknown>>)[0];
    expect(secondRow.out_session_id).toBe(firstRow.out_session_id);
    expect(secondRow.out_movement_id).toBe(firstRow.out_movement_id);
    // Idempotent: sort_order of the row that actually persisted is
    // returned unchanged on the second call.
    expect(secondRow.out_sort_order).toBe(firstRow.out_sort_order);

    // And there's exactly one row on the table for this pair.
    const { data: rows, error: selErr } = await admin
      .from("session_movements")
      .select("session_id, movement_id, sort_order")
      .eq("session_id", sessionId)
      .eq("movement_id", primaryMovementId);
    expect(selErr).toBeNull();
    expect(rows).toHaveLength(1);
  });

  test("add_session_movement: 5 concurrent adds of the same (session, movement) all succeed", async () => {
    const sessionId = await freshSession("add-concurrent-same");

    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        admin.rpc("add_session_movement", {
          p_session_id: sessionId,
          p_movement_id: primaryMovementId,
          p_user_id: userId,
        }),
      ),
    );

    for (const r of results) {
      expect(r.error).toBeNull();
      expect((r.data as Array<unknown>).length).toBe(1);
    }

    // The PK still holds — exactly one row, no duplicates.
    const { data: rows, error: selErr } = await admin
      .from("session_movements")
      .select("session_id")
      .eq("session_id", sessionId)
      .eq("movement_id", primaryMovementId);
    expect(selErr).toBeNull();
    expect(rows).toHaveLength(1);
  });

  test("add_session_movement: 5 concurrent adds of DIFFERENT movements get distinct sort_orders (PR #148 race fix)", async () => {
    const sessionId = await freshSession("add-concurrent-different");

    const results = await Promise.all(
      parallelMovementIds.map((movementId) =>
        admin.rpc("add_session_movement", {
          p_session_id: sessionId,
          p_movement_id: movementId,
          p_user_id: userId,
        }),
      ),
    );

    for (const r of results) {
      expect(r.error).toBeNull();
    }

    const { data: rows, error: selErr } = await admin
      .from("session_movements")
      .select("movement_id, sort_order")
      .eq("session_id", sessionId);
    expect(selErr).toBeNull();
    expect(rows).toHaveLength(parallelMovementIds.length);

    const sortOrders = (rows as Array<{ sort_order: number }>).map(
      (r) => r.sort_order,
    );
    const distinct = new Set(sortOrders);
    expect(distinct.size).toBe(sortOrders.length);
  });

  test("remove_session_movement: removes an added movement and reports reason=removed", async () => {
    const sessionId = await freshSession("remove-happy");

    const addRes = await admin.rpc("add_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
      p_user_id: userId,
    });
    expect(addRes.error).toBeNull();

    const { data, error } = await admin.rpc("remove_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
    });
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row.deleted).toBe(true);
    expect(row.reason).toBe("removed");

    const { data: rows } = await admin
      .from("session_movements")
      .select("session_id")
      .eq("session_id", sessionId)
      .eq("movement_id", primaryMovementId);
    expect(rows).toHaveLength(0);
  });

  test("remove_session_movement: not-present is treated as success with reason=not_present", async () => {
    const sessionId = await freshSession("remove-not-present");

    const { data, error } = await admin.rpc("remove_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
    });
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row.deleted).toBe(true);
    expect(row.reason).toBe("not_present");
  });

  test("remove_session_movement: blocked by set_logs returns deleted=false reason=has_set_logs", async () => {
    const sessionId = await freshSession("remove-blocked");

    const addRes = await admin.rpc("add_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
      p_user_id: userId,
    });
    expect(addRes.error).toBeNull();

    // Insert a set_logs row referencing the same (session, movement)
    // pair. set_logs.set_logs_has_some_work needs at least one of
    // reps / duration_sec / distance_m to be non-null.
    const { error: slErr } = await admin.from("set_logs").insert({
      session_id: sessionId,
      movement_id: primaryMovementId,
      set_index: 0,
      reps: 5,
      weight_kg: 60,
    });
    expect(slErr).toBeNull();

    const { data, error } = await admin.rpc("remove_session_movement", {
      p_session_id: sessionId,
      p_movement_id: primaryMovementId,
    });
    expect(error).toBeNull();
    const row = (data as Array<Record<string, unknown>>)[0];
    expect(row.deleted).toBe(false);
    expect(row.reason).toBe("has_set_logs");

    // Row is still there — the atomic guard fired.
    const { data: rows } = await admin
      .from("session_movements")
      .select("session_id")
      .eq("session_id", sessionId)
      .eq("movement_id", primaryMovementId);
    expect(rows).toHaveLength(1);
  });
});

// If env isn't set, surface a single visible "skipped" test so CI logs
// show why the suite did nothing instead of silently passing 0 tests.
describe.skipIf(env)("session-movements RPC smoke (skipped)", () => {
  test("env not configured", () => {
    // eslint-disable-next-line no-console
    console.warn(SKIP_MESSAGE);
    expect(true).toBe(true);
  });
});
