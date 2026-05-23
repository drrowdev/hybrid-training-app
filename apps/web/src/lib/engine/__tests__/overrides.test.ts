/**
 * engine/overrides — unit tests for the override audit log helper.
 *
 * Uses a small inline PostgREST-like stub (same shape as the one in
 * lib/stats/__tests__/engine.test.ts). The stub captures `insert`s so
 * we can assert the audit-log row was produced with the expected
 * shape.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getRecentOverrides,
  isoWeekdayFromYmd,
  normaliseReason,
  recordOverrideEvent,
  summariseOverridesByWeekday,
  OVERRIDE_REASON_MAX,
} from "../overrides";

type Row = Record<string, unknown>;

function makeStub(initial: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = v.slice();
  const inserts: Array<{ table: string; row: Row }> = [];

  function from(table: string) {
    let rows = (tables[table] ?? []).slice();
    let pendingInsert: Row | null = null;

    const builder: Record<string, unknown> = {};
    const apply = (pred: (r: Row) => boolean) => {
      rows = rows.filter(pred);
      return builder;
    };
    builder.select = () => builder;
    builder.insert = (row: Row | Row[]) => {
      const list = Array.isArray(row) ? row : [row];
      for (const r of list) {
        const full = { id: `${table}-${inserts.length + 1}`, ...r };
        inserts.push({ table, row: r });
        tables[table] = tables[table] ?? [];
        tables[table].push(full);
        pendingInsert = full;
        rows.push(full);
      }
      return builder;
    };
    builder.eq = (col: string, val: unknown) => apply((r) => r[col] === val);
    builder.in = (col: string, vals: unknown[]) => apply((r) => vals.includes(r[col]));
    builder.gte = (col: string, val: unknown) =>
      apply((r) => r[col] != null && String(r[col]) >= String(val));
    builder.lte = (col: string, val: unknown) =>
      apply((r) => r[col] != null && String(r[col]) <= String(val));
    builder.order = (col: string, opts?: { ascending?: boolean }) => {
      const asc = opts?.ascending !== false;
      rows = rows.slice().sort((a, b) => {
        const av = String(a[col] ?? "");
        const bv = String(b[col] ?? "");
        return asc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av < bv ? 1 : av > bv ? -1 : 0);
      });
      return builder;
    };
    builder.limit = (n: number) => {
      rows = rows.slice(0, n);
      return builder;
    };
    builder.maybeSingle = () =>
      Promise.resolve({ data: pendingInsert ?? rows[0] ?? null, error: null });
    builder.single = () =>
      Promise.resolve({ data: pendingInsert ?? rows[0] ?? null, error: null });
    builder.then = (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF);

    return builder;
  }
  return { client: { from } as unknown as SupabaseClient, inserts, tables };
}

describe("normaliseReason", () => {
  it("collapses whitespace-only and empty strings to null", () => {
    expect(normaliseReason("")).toBeNull();
    expect(normaliseReason("   ")).toBeNull();
    expect(normaliseReason(undefined)).toBeNull();
    expect(normaliseReason(null)).toBeNull();
    expect(normaliseReason(123)).toBeNull();
  });
  it("trims and preserves user text", () => {
    expect(normaliseReason("  tired  ")).toBe("tired");
  });
  it("truncates to OVERRIDE_REASON_MAX", () => {
    const long = "a".repeat(OVERRIDE_REASON_MAX + 100);
    expect(normaliseReason(long)).toHaveLength(OVERRIDE_REASON_MAX);
  });
});

describe("recordOverrideEvent", () => {
  it("writes a row with all provided fields", async () => {
    const { client, inserts } = makeStub();
    const id = await recordOverrideEvent(client, {
      userId: "u1",
      eventType: "skip",
      plannedSessionId: "ps1",
      blockId: "b1",
      reason: "  tired  ",
      context: { archetype: "strength_anchor", weekday: 7 },
    });
    expect(id).not.toBeNull();
    expect(inserts).toHaveLength(1);
    const r = inserts[0]!.row;
    expect(r.user_id).toBe("u1");
    expect(r.event_type).toBe("skip");
    expect(r.planned_session_id).toBe("ps1");
    expect(r.block_id).toBe("b1");
    expect(r.reason).toBe("tired");
    expect(r.context).toEqual({ archetype: "strength_anchor", weekday: 7 });
  });
  it("normalises empty reason to NULL", async () => {
    const { client, inserts } = makeStub();
    await recordOverrideEvent(client, {
      userId: "u1",
      eventType: "manual_end",
      blockId: "b1",
      reason: "   ",
    });
    expect(inserts[0]!.row.reason).toBeNull();
  });
});

describe("getRecentOverrides", () => {
  it("returns rows ordered newest-first, mapped to camelCase", async () => {
    const { client } = makeStub({
      engine_override_events: [
        {
          id: "e1",
          user_id: "u1",
          occurred_at: "2026-01-01T10:00:00Z",
          event_type: "skip",
          planned_session_id: "ps1",
          block_id: "b1",
          original_movement_slug: null,
          new_movement_slug: null,
          reason: "tired",
          context: { archetype: "strength_anchor" },
        },
        {
          id: "e2",
          user_id: "u1",
          occurred_at: "2026-01-03T10:00:00Z",
          event_type: "swap",
          planned_session_id: "ps2",
          block_id: "b1",
          original_movement_slug: "back-squat",
          new_movement_slug: "front-squat",
          reason: null,
          context: { weekday: 3 },
        },
        {
          id: "other-user",
          user_id: "u2",
          occurred_at: "2026-01-05T10:00:00Z",
          event_type: "skip",
          reason: null,
          context: null,
        },
      ],
    });
    const out = await getRecentOverrides(client, "u1", 10);
    expect(out).toHaveLength(2);
    expect(out[0]!.id).toBe("e2");
    expect(out[0]!.eventType).toBe("swap");
    expect(out[0]!.originalMovementSlug).toBe("back-squat");
    expect(out[1]!.reason).toBe("tired");
  });

  it("honours the limit", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => ({
      id: `e${i}`,
      user_id: "u1",
      occurred_at: new Date(2026, 0, i + 1).toISOString(),
      event_type: "skip",
      reason: null,
      context: null,
    }));
    const { client } = makeStub({ engine_override_events: rows });
    const out = await getRecentOverrides(client, "u1", 5);
    expect(out).toHaveLength(5);
  });
});

describe("summariseOverridesByWeekday", () => {
  it("buckets skips and swaps by ISO weekday from context", async () => {
    const { client } = makeStub({
      engine_override_events: [
        // 3 Sunday skips, 1 Monday skip, 1 Wednesday swap
        { user_id: "u1", event_type: "skip", occurred_at: "2026-01-01T10:00:00Z", context: { weekday: 7 } },
        { user_id: "u1", event_type: "skip", occurred_at: "2026-01-08T10:00:00Z", context: { weekday: 7 } },
        { user_id: "u1", event_type: "skip", occurred_at: "2026-01-15T10:00:00Z", context: { weekday: 7 } },
        { user_id: "u1", event_type: "skip", occurred_at: "2026-01-05T10:00:00Z", context: { weekday: 1 } },
        { user_id: "u1", event_type: "swap", occurred_at: "2026-01-07T10:00:00Z", context: { weekday: 3 } },
      ],
    });
    const out = await summariseOverridesByWeekday(client, "u1", {
      fromIso: "2026-01-01T00:00:00Z",
      toIso: "2026-02-01T00:00:00Z",
    });
    expect(out).toHaveLength(7);
    const sun = out.find((r) => r.weekday === 7)!;
    expect(sun.skipCount).toBe(3);
    expect(sun.totalCount).toBe(3);
    const mon = out.find((r) => r.weekday === 1)!;
    expect(mon.skipCount).toBe(1);
    const wed = out.find((r) => r.weekday === 3)!;
    expect(wed.swapCount).toBe(1);
    expect(wed.skipCount).toBe(0);
  });

  it("falls back to occurred_at when context.weekday is missing", async () => {
    const { client } = makeStub({
      engine_override_events: [
        // 2026-03-01 is a Sunday (ISO 7)
        { user_id: "u1", event_type: "skip", occurred_at: "2026-03-01T10:00:00Z", context: null },
      ],
    });
    const out = await summariseOverridesByWeekday(client, "u1", {
      fromIso: "2026-01-01T00:00:00Z",
      toIso: "2026-12-31T23:59:59Z",
    });
    const sun = out.find((r) => r.weekday === 7)!;
    expect(sun.skipCount).toBe(1);
  });
});

describe("isoWeekdayFromYmd", () => {
  it("Mon=1..Sun=7", () => {
    // 2026-01-05 was a Monday
    expect(isoWeekdayFromYmd("2026-01-05")).toBe(1);
    // 2026-01-11 was a Sunday
    expect(isoWeekdayFromYmd("2026-01-11")).toBe(7);
  });
});
