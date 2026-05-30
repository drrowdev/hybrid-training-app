/**
 * Server-action tests for the taper / recovery lifecycle.
 *
 * Covers happy-path Apply (insert), idempotency (second Apply for same
 * (event, kind, window) updates rather than dupes), Decline writes an
 * audit row with no engine effect, RLS rejection (other user's event),
 * Undo flips the most recent applied row to reverted, setEventResult
 * persists the status enum, and ultra LOW-confidence flag round-trips
 * through the recovery payload.
 *
 * The supabase client is fully stubbed via a query-builder mock so we
 * can spy on inserts / updates without hitting the network. RLS is
 * simulated by having the events table return null when user_id !=
 * "user-1", matching the real-DB policy behaviour.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));

type Insert = Record<string, unknown>;
type Update = Record<string, unknown>;

const state = {
  authUserId: "user-1" as string | null,
  events: new Map<
    string,
    {
      id: string;
      user_id: string;
      name: string;
      event_date: string;
      priority: "A" | "B" | "C";
      modality: string | null;
      target_performance: Record<string, unknown> | null;
      result: Record<string, unknown> | null;
    }
  >(),
  modifications: [] as Array<{
    id: string;
    user_id: string;
    event_id: string;
    kind: string;
    start_date: string;
    end_date: string;
    ramp_end_date: string | null;
    payload: Record<string, unknown>;
    status: "applied" | "declined" | "reverted";
    applied_at: string;
  }>,
  inserts: [] as Insert[],
  updates: [] as Update[],
  profileTier: "intermediate" as string,
};

let nextId = 1;
function genId() {
  return `mod-${nextId++}`;
}

function makeBuilder(table: string): unknown {
  if (table === "priority_events") {
    let filterUserId: string | null = null;
    let filterId: string | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: string) => {
        if (col === "user_id") filterUserId = val;
        if (col === "id") filterId = val;
        return builder;
      },
      maybeSingle: () => {
        if (!filterId) return Promise.resolve({ data: null, error: null });
        const evt = state.events.get(filterId);
        if (!evt) return Promise.resolve({ data: null, error: null });
        if (filterUserId && evt.user_id !== filterUserId)
          return Promise.resolve({ data: null, error: null });
        return Promise.resolve({ data: evt, error: null });
      },
      update: (payload: Update) => {
        let updateFilterId: string | null = null;
        let updateFilterUserId: string | null = null;
        const u: Record<string, unknown> = {
          eq: (col: string, val: string) => {
            if (col === "id") updateFilterId = val;
            if (col === "user_id") updateFilterUserId = val;
            // Apply on each eq so the final eq triggers the write.
            if (updateFilterId) {
              const evt = state.events.get(updateFilterId);
              if (evt && (!updateFilterUserId || evt.user_id === updateFilterUserId)) {
                state.events.set(updateFilterId, { ...evt, ...payload });
              }
            }
            state.updates.push({ table, payload });
            // Return self so chained `.eq()` continues; the action
            // doesn't await intermediate eq calls — only the last
            // call's return is the resolved Promise.
            const ret: Record<string, unknown> = u;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (ret as any).then = (cb: (x: { error: null }) => unknown) =>
              Promise.resolve(cb({ error: null }));
            return ret;
          },
        };
        return u;
      },
    };
    return builder;
  }
  if (table === "profiles") {
    return {
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data: { training_experience: state.profileTier },
              error: null,
            }),
        }),
      }),
    };
  }
  if (table === "prescription_modifications") {
    let filters: Record<string, string> = {};
    let order: { col: string; asc: boolean } | null = null;
    let limit: number | null = null;
    const builder: Record<string, unknown> = {
      select: () => builder,
      eq: (col: string, val: string) => {
        filters[col] = val;
        return builder;
      },
      neq: () => builder,
      lte: () => builder,
      gte: () => builder,
      in: () => builder,
      order: (col: string, opts: { ascending: boolean }) => {
        order = { col, asc: opts.ascending };
        return builder;
      },
      limit: (n: number) => {
        limit = n;
        return builder;
      },
      maybeSingle: () => {
        const matches = state.modifications.filter((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        );
        return Promise.resolve({ data: matches[0] ?? null, error: null });
      },
      // Used by undoMostRecentApplied path which expects array-like .order().limit()
      then: (cb: (x: { data: unknown; error: null }) => unknown) => {
        const matches = state.modifications.filter((r) =>
          Object.entries(filters).every(([k, v]) => (r as Record<string, unknown>)[k] === v),
        );
        if (order && order.col === "applied_at") {
          matches.sort((a, b) =>
            order!.asc
              ? a.applied_at.localeCompare(b.applied_at)
              : b.applied_at.localeCompare(a.applied_at),
          );
        }
        const out = limit != null ? matches.slice(0, limit) : matches;
        return Promise.resolve(cb({ data: out, error: null }));
      },
      insert: (payload: Insert) => {
        const row = {
          id: genId(),
          applied_at: new Date().toISOString(),
          ...(payload as object),
        } as (typeof state.modifications)[number];
        state.modifications.push(row);
        state.inserts.push(payload);
        return Promise.resolve({ error: null });
      },
      update: (payload: Update) => {
        return {
          eq: (col: string, val: string) => {
            const idx = state.modifications.findIndex(
              (r) => (r as Record<string, unknown>)[col] === val,
            );
            if (idx >= 0) {
              state.modifications[idx] = {
                ...state.modifications[idx]!,
                ...(payload as object),
              };
            }
            state.updates.push({ table, payload, where: { col, val } });
            return Promise.resolve({ error: null });
          },
        };
      },
    };
    return builder;
  }
  throw new Error(`unmocked table ${table}`);
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => makeBuilder(table),
  }),
  getAuthUser: async () => ({
    data: { user: state.authUserId ? { id: state.authUserId } : null },
  }),
}));

import {
  applyTaperPlan,
  declineTaperPlan,
  undoTaperPlan,
  applyRecoveryPlan,
  declineRecoveryPlan,
  undoRecoveryPlan,
  setEventResult,
} from "../taper-recovery-actions";

function fd(obj: Record<string, string>): FormData {
  const f = new FormData();
  for (const [k, v] of Object.entries(obj)) f.set(k, v);
  return f;
}

function ymdOffset(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

beforeEach(() => {
  state.authUserId = "user-1";
  state.events.clear();
  state.modifications = [];
  state.inserts = [];
  state.updates = [];
  state.profileTier = "intermediate";
  nextId = 1;
});

describe("applyTaperPlan", () => {
  it("happy path inserts an applied taper row with snapshot window", async () => {
    const eventDate = ymdOffset(7);
    state.events.set("00000000-0000-0000-0000-000000000001", {
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "user-1",
      name: "Test Half",
      event_date: eventDate,
      priority: "A",
      modality: "run",
      target_performance: null,
      result: null,
    });
    const r = await applyTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    expect(r).toEqual({ ok: true });
    expect(state.modifications).toHaveLength(1);
    const row = state.modifications[0]!;
    expect(row.kind).toBe("taper");
    expect(row.status).toBe("applied");
    const payload = row.payload as { window: { date: string; volumeScale: number }[] };
    expect(payload.window.length).toBeGreaterThan(0);
    expect(payload.window.every((w) => w.volumeScale >= 0)).toBe(true);
  });

  it("idempotency: second Apply for same (event, kind, window) updates not dupes", async () => {
    const eventDate = ymdOffset(7);
    state.events.set("00000000-0000-0000-0000-000000000001", {
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "user-1",
      name: "Test",
      event_date: eventDate,
      priority: "A",
      modality: "run",
      target_performance: null,
      result: null,
    });
    await applyTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    await applyTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    expect(state.modifications.filter((r) => r.kind === "taper" && r.status === "applied")).toHaveLength(1);
  });

  it("RLS rejection: applying for another user's event returns ok:false", async () => {
    state.events.set("00000000-0000-0000-0000-000000000002", {
      id: "00000000-0000-0000-0000-000000000002",
      user_id: "other-user",
      name: "Other",
      event_date: ymdOffset(7),
      priority: "A",
      modality: "run",
      target_performance: null,
      result: null,
    });
    const r = await applyTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000002" }));
    expect(r.ok).toBe(false);
    expect(state.modifications).toHaveLength(0);
  });

  it("rejects unauthenticated", async () => {
    state.authUserId = null;
    const r = await applyTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    expect(r.ok).toBe(false);
  });

  it("rejects C-priority", async () => {
    state.events.set("55555555-5555-5555-5555-555555555555", {
      id: "55555555-5555-5555-5555-555555555555",
      user_id: "user-1",
      name: "C",
      event_date: ymdOffset(7),
      priority: "C",
      modality: "run",
      target_performance: null,
      result: null,
    });
    const r = await applyTaperPlan(fd({ eventId: "55555555-5555-5555-5555-555555555555" }));
    expect(r.ok).toBe(false);
  });
});

describe("declineTaperPlan", () => {
  it("inserts an audit row with status=declined; engine reads ignore it", async () => {
    state.events.set("00000000-0000-0000-0000-000000000001", {
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "user-1",
      name: "Test",
      event_date: ymdOffset(7),
      priority: "A",
      modality: "run",
      target_performance: null,
      result: null,
    });
    const r = await declineTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    expect(r).toEqual({ ok: true });
    expect(state.modifications).toHaveLength(1);
    expect(state.modifications[0]!.status).toBe("declined");
  });
});

describe("undoTaperPlan", () => {
  it("flips most recent applied row to reverted", async () => {
    state.events.set("00000000-0000-0000-0000-000000000001", {
      id: "00000000-0000-0000-0000-000000000001",
      user_id: "user-1",
      name: "Test",
      event_date: ymdOffset(7),
      priority: "A",
      modality: "run",
      target_performance: null,
      result: null,
    });
    await applyTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    const r = await undoTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    expect(r).toEqual({ ok: true });
    expect(state.modifications[0]!.status).toBe("reverted");
  });

  it("ok:false when nothing to undo", async () => {
    const r = await undoTaperPlan(fd({ eventId: "00000000-0000-0000-0000-000000000001" }));
    expect(r.ok).toBe(false);
  });
});

describe("applyRecoveryPlan", () => {
  it("inserts recovery row; sourceWindow round-trips ultra LOW-confidence flag", async () => {
    state.events.set("11111111-1111-1111-1111-111111111111", {
      id: "11111111-1111-1111-1111-111111111111",
      user_id: "user-1",
      name: "100K",
      event_date: ymdOffset(-1),
      priority: "A",
      modality: "run",
      target_performance: { targetDistanceKm: 100 },
      result: { status: "raced" },
    });
    const r = await applyRecoveryPlan(fd({ eventId: "11111111-1111-1111-1111-111111111111" }));
    expect(r).toEqual({ ok: true });
    const row = state.modifications.find((m) => m.kind === "recovery")!;
    const payload = row.payload as {
      sourceWindow: { confidence?: string; days: number };
    };
    expect(payload.sourceWindow.confidence).toBe("LOW");
    expect(payload.sourceWindow.days).toBeGreaterThan(7);
  });

  it("idempotency: second Apply for same window updates same row", async () => {
    state.events.set("22222222-2222-2222-2222-222222222222", {
      id: "22222222-2222-2222-2222-222222222222",
      user_id: "user-1",
      name: "Marathon",
      event_date: ymdOffset(-1),
      priority: "A",
      modality: "run",
      target_performance: { targetDistanceKm: 42.195 },
      result: { status: "raced" },
    });
    await applyRecoveryPlan(fd({ eventId: "22222222-2222-2222-2222-222222222222" }));
    await applyRecoveryPlan(fd({ eventId: "22222222-2222-2222-2222-222222222222" }));
    expect(state.modifications.filter((r) => r.kind === "recovery" && r.status === "applied")).toHaveLength(1);
  });
});

describe("declineRecoveryPlan + undoRecoveryPlan", () => {
  beforeEach(() => {
    state.events.set("33333333-3333-3333-3333-333333333333", {
      id: "33333333-3333-3333-3333-333333333333",
      user_id: "user-1",
      name: "5K",
      event_date: ymdOffset(-1),
      priority: "A",
      modality: "run",
      target_performance: { targetDistanceKm: 5 },
      result: { status: "raced" },
    });
  });

  it("decline writes audit row", async () => {
    const r = await declineRecoveryPlan(fd({ eventId: "33333333-3333-3333-3333-333333333333" }));
    expect(r).toEqual({ ok: true });
    expect(state.modifications.find((m) => m.kind === "recovery" && m.status === "declined")).toBeDefined();
  });

  it("undo recovery flips applied → reverted", async () => {
    await applyRecoveryPlan(fd({ eventId: "33333333-3333-3333-3333-333333333333" }));
    const r = await undoRecoveryPlan(fd({ eventId: "33333333-3333-3333-3333-333333333333" }));
    expect(r).toEqual({ ok: true });
    const row = state.modifications.find((m) => m.kind === "recovery")!;
    expect(row.status).toBe("reverted");
  });
});

describe("setEventResult", () => {
  beforeEach(() => {
    state.events.set("44444444-4444-4444-4444-444444444444", {
      id: "44444444-4444-4444-4444-444444444444",
      user_id: "user-1",
      name: "Race",
      event_date: ymdOffset(-1),
      priority: "A",
      modality: "run",
      target_performance: null,
      result: null,
    });
  });

  it("writes status=raced", async () => {
    const r = await setEventResult(fd({ eventId: "44444444-4444-4444-4444-444444444444", status: "raced" }));
    expect(r).toEqual({ ok: true });
    const evt = state.events.get("44444444-4444-4444-4444-444444444444")!;
    expect((evt.result as { status: string }).status).toBe("raced");
  });

  it("writes status=partial", async () => {
    const r = await setEventResult(fd({ eventId: "44444444-4444-4444-4444-444444444444", status: "partial" }));
    expect(r).toEqual({ ok: true });
    expect((state.events.get("44444444-4444-4444-4444-444444444444")!.result as { status: string }).status).toBe("partial");
  });

  it("writes status=skipped", async () => {
    const r = await setEventResult(fd({ eventId: "44444444-4444-4444-4444-444444444444", status: "skipped" }));
    expect(r).toEqual({ ok: true });
    expect((state.events.get("44444444-4444-4444-4444-444444444444")!.result as { status: string }).status).toBe("skipped");
  });

  it("rejects invalid status", async () => {
    const r = await setEventResult(fd({ eventId: "44444444-4444-4444-4444-444444444444", status: "won" }));
    expect(r.ok).toBe(false);
  });

  it("rejects unauthenticated", async () => {
    state.authUserId = null;
    const r = await setEventResult(fd({ eventId: "44444444-4444-4444-4444-444444444444", status: "raced" }));
    expect(r.ok).toBe(false);
  });
});
