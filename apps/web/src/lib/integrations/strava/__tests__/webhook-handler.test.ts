/**
 * Strava webhook tests — pure handler with stubbed Supabase + sync.
 *
 * Test env is Node-only; we hand-craft a minimal Supabase mock that
 * tracks .insert / .update / .select / .delete + .eq chain calls.
 */
import { describe, it, expect, vi } from "vitest";
import {
  handleStravaWebhookEvent,
  type StravaWebhookEvent,
  type SyncSingleFn,
} from "../webhook-handler";

type Row = Record<string, unknown>;

function stubSupabase(opts: {
  eventLogInsert?: { error: { code?: string; message: string } | null };
  connectionRow?: { user_id: string } | null;
  connectionError?: { message: string } | null;
  deleteError?: { message: string } | null;
  deauthError?: { message: string } | null;
} = {}) {
  const calls = {
    inserts: [] as { table: string; row: Row }[],
    updates: [] as { table: string; row: Row; filters: Row }[],
    deletes: [] as { table: string; filters: Row }[],
  };

  const builder = (table: string) => {
    const filters: Row = {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chain: any = {
      insert(row: Row) {
        calls.inserts.push({ table, row });
        if (table === "strava_event_log") {
          return Promise.resolve(opts.eventLogInsert ?? { error: null });
        }
        return Promise.resolve({ error: null });
      },
      update(row: Row) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const u: any = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return u;
          },
          then(resolve: (v: unknown) => void) {
            calls.updates.push({ table, row, filters: { ...filters } });
            if (table === "strava_connections")
              return resolve({ error: opts.deauthError ?? null });
            return resolve({ error: null });
          },
        };
        return u;
      },
      delete() {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const d: any = {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return d;
          },
          then(resolve: (v: unknown) => void) {
            calls.deletes.push({ table, filters: { ...filters } });
            return resolve({ error: opts.deleteError ?? null });
          },
        };
        return d;
      },
      select() {
        return {
          eq(col: string, val: unknown) {
            filters[col] = val;
            return this;
          },
          maybeSingle() {
            if (table === "strava_connections") {
              return Promise.resolve({
                data: opts.connectionRow ?? null,
                error: opts.connectionError ?? null,
              });
            }
            return Promise.resolve({ data: null, error: null });
          },
        };
      },
    };
    return chain;
  };

  return {
    supabase: { from: (table: string) => builder(table) } as unknown as Parameters<typeof handleStravaWebhookEvent>[1]["supabase"],
    calls,
  };
}

const baseEvent: StravaWebhookEvent = {
  aspect_type: "create",
  event_time: 1_700_000_000,
  object_id: 999,
  object_type: "activity",
  owner_id: 42,
  subscription_id: 7,
};

describe("handleStravaWebhookEvent", () => {
  it("rejects events from the wrong subscription", async () => {
    const { supabase } = stubSupabase();
    const syncSingle = vi.fn() as unknown as SyncSingleFn;
    const out = await handleStravaWebhookEvent(
      { ...baseEvent, subscription_id: 999 },
      { supabase, env: { subscriptionId: 7 }, syncSingle },
    );
    expect(out.kind).toBe("ignored");
    expect(syncSingle).not.toHaveBeenCalled();
  });

  it("treats a unique-violation on the event log as a duplicate (and stops)", async () => {
    const { supabase, calls } = stubSupabase({
      eventLogInsert: { error: { code: "23505", message: "duplicate key" } },
    });
    const syncSingle = vi.fn() as unknown as SyncSingleFn;
    const out = await handleStravaWebhookEvent(baseEvent, {
      supabase,
      env: { subscriptionId: 7 },
      syncSingle,
    });
    expect(out.kind).toBe("duplicate");
    expect(syncSingle).not.toHaveBeenCalled();
    expect(calls.inserts).toHaveLength(1);
  });

  it("syncs activity create events for the matching connection", async () => {
    const { supabase, calls } = stubSupabase({
      connectionRow: { user_id: "user-1" },
    });
    const syncSingle: SyncSingleFn = vi
      .fn()
      .mockResolvedValue({ status: "imported", sessionId: "s1" });
    const out = await handleStravaWebhookEvent(baseEvent, {
      supabase,
      env: { subscriptionId: 7 },
      syncSingle,
    });
    expect(out).toEqual({ kind: "ok", note: "sync imported" });
    expect(syncSingle).toHaveBeenCalledWith(supabase, "user-1", 999);
    // marked done on the event log
    expect(
      calls.updates.find(
        (u) => u.table === "strava_event_log" && u.row.processed_ok === true,
      ),
    ).toBeTruthy();
  });

  it("silently ignores activity events for unknown athletes", async () => {
    const { supabase } = stubSupabase({ connectionRow: null });
    const syncSingle: SyncSingleFn = vi.fn();
    const out = await handleStravaWebhookEvent(baseEvent, {
      supabase,
      env: { subscriptionId: 7 },
      syncSingle,
    });
    expect(out.kind).toBe("ignored");
    expect(syncSingle).not.toHaveBeenCalled();
  });

  it("deletes the session row on activity delete events", async () => {
    const { supabase, calls } = stubSupabase({
      connectionRow: { user_id: "user-1" },
    });
    const syncSingle: SyncSingleFn = vi.fn();
    const out = await handleStravaWebhookEvent(
      { ...baseEvent, aspect_type: "delete" },
      { supabase, env: { subscriptionId: 7 }, syncSingle },
    );
    expect(out).toEqual({ kind: "ok", note: "activity deleted" });
    expect(syncSingle).not.toHaveBeenCalled();
    expect(
      calls.deletes.find(
        (d) =>
          d.table === "sessions" &&
          d.filters.user_id === "user-1" &&
          d.filters.strava_activity_id === 999,
      ),
    ).toBeTruthy();
  });

  it("clears the connection on athlete deauthorization", async () => {
    const { supabase, calls } = stubSupabase();
    const syncSingle: SyncSingleFn = vi.fn();
    const out = await handleStravaWebhookEvent(
      {
        ...baseEvent,
        object_type: "athlete",
        aspect_type: "update",
        updates: { authorized: "false" },
      },
      { supabase, env: { subscriptionId: 7 }, syncSingle },
    );
    expect(out.kind).toBe("ok");
    expect(syncSingle).not.toHaveBeenCalled();
    const u = calls.updates.find((x) => x.table === "strava_connections");
    expect(u?.row).toMatchObject({
      access_token: "",
      refresh_token: "",
    });
    expect(u?.filters).toMatchObject({ athlete_id: 42 });
  });
});
