/**
 * Tests for the tissue-stack-deficit gating.
 *
 * The plan-page banner must NOT fire on day-1-of-a-fresh-block: the
 * copy says "X/Y planned this week" but on day 0 nothing has been
 * logged so the warning is misleading. The query returns `[]` until
 * both (a) the block has been running for ≥ 7 days and (b) at least
 * one completed session lives in the last 7 days.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentWeekTissueStackGaps } from "../tissue-stack-queries";

type Row = Record<string, unknown>;
type Tables = Record<string, Row[]>;
type Counts = Record<string, number>;

function makeStub(tables: Tables, counts: Counts = {}): SupabaseClient {
  function from(table: string) {
    let rows = (tables[table] ?? []).slice();
    let headCount: { active: boolean; key: string } | null = null;
    const builder: Record<string, unknown> = {};
    const apply = (pred: (r: Row) => boolean) => {
      rows = rows.filter(pred);
      return builder;
    };
    builder.select = (
      _cols: string,
      opts?: { count?: "exact"; head?: boolean },
    ) => {
      if (opts?.head && opts.count === "exact") {
        headCount = { active: true, key: table };
      }
      return builder;
    };
    builder.eq = (col: string, val: unknown) => apply((r) => r[col] === val);
    builder.in = (col: string, vals: unknown[]) =>
      apply((r) => vals.includes(r[col]));
    builder.is = (col: string, val: null) =>
      apply((r) => (r[col] ?? null) === val);
    builder.not = (col: string, op: string, val: unknown) => {
      if (op === "is" && val === null) return apply((r) => r[col] != null);
      return builder;
    };
    builder.gte = (col: string, val: unknown) =>
      apply(
        (r) => r[col] != null && String(r[col]) >= String(val),
      );
    builder.maybeSingle = () =>
      Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.then = (
      onF: (v: { data: unknown; count?: number; error: null }) => unknown,
    ) => {
      if (headCount?.active) {
        const k = headCount.key;
        const c = counts[k] ?? rows.length;
        return Promise.resolve({ data: null, count: c, error: null }).then(onF);
      }
      return Promise.resolve({ data: rows, error: null }).then(onF);
    };
    return builder;
  }
  return { from } as unknown as SupabaseClient;
}

const USER_ID = "user-1";
const NOW = new Date("2026-05-15T12:00:00Z").getTime();

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("getCurrentWeekTissueStackGaps — banner gating", () => {
  it("returns [] when there is no active block", async () => {
    const supabase = makeStub({ training_blocks: [] });
    const out = await getCurrentWeekTissueStackGaps(supabase, USER_ID);
    expect(out).toEqual([]);
  });

  it("returns [] on day 1 of a fresh block, even if the week's plan is empty", async () => {
    // Block started today — daysSinceStart = 0, well under the 7-day floor.
    const startedOn = new Date(NOW).toISOString().slice(0, 10);
    const supabase = makeStub({
      training_blocks: [
        {
          id: "blk-1",
          user_id: USER_ID,
          status: "active",
          deleted_at: null,
          started_on: startedOn,
          weeks: 6,
        },
      ],
      // Nothing else matters — the function must short-circuit before
      // looking at planned_sessions / movements.
      sessions: [],
      planned_sessions: [],
      movements: [],
    });
    const out = await getCurrentWeekTissueStackGaps(supabase, USER_ID);
    expect(out).toEqual([]);
  });

  it("returns [] when the block is old enough but no sessions have been completed in the last 7 days", async () => {
    // Block started 30 days ago — past the 7-day floor.
    const startedOn = new Date(NOW - 30 * 86_400_000).toISOString().slice(0, 10);
    const supabase = makeStub({
      training_blocks: [
        {
          id: "blk-1",
          user_id: USER_ID,
          status: "active",
          deleted_at: null,
          started_on: startedOn,
          weeks: 6,
        },
      ],
      // Zero completed sessions in the last 7 days.
      sessions: [],
      planned_sessions: [],
      movements: [],
    });
    const out = await getCurrentWeekTissueStackGaps(supabase, USER_ID);
    expect(out).toEqual([]);
  });

  it("surfaces gaps once the block is past day 7 AND at least one completed session lives in the last 7 days", async () => {
    const startedOn = new Date(NOW - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);
    const completedAt = new Date(NOW - 2 * 86_400_000).toISOString();
    const supabase = makeStub(
      {
        training_blocks: [
          {
            id: "blk-1",
            user_id: USER_ID,
            status: "active",
            deleted_at: null,
            started_on: startedOn,
            weeks: 6,
          },
        ],
        sessions: [
          {
            id: "s-1",
            user_id: USER_ID,
            completed_at: completedAt,
            deleted_at: null,
          },
        ],
        // Week-4 plan has a single movement with NO bulletproof roles
        // — every DC-O4 floor item is missing, so gaps should fire.
        planned_sessions: [
          {
            block_id: "blk-1",
            week_index: 4,
            prescription: { items: [{ movementId: "mv-empty" }] },
          },
        ],
        movements: [{ id: "mv-empty", bulletproof_roles: [] }],
      },
      { sessions: 1 },
    );
    const out = await getCurrentWeekTissueStackGaps(supabase, USER_ID);
    // We don't pin the exact gap list — that's the planner's contract.
    // The gate-behaviour assertion is "≥ 1 gap surfaced once the
    // floor + the recent-session gate both pass".
    expect(out.length).toBeGreaterThan(0);
    // Every gap row carries a human label, not an internal role code.
    for (const g of out) {
      expect(g.label).toBeTruthy();
      expect(g.label).not.toMatch(/^DC-/);
    }
  });
});
