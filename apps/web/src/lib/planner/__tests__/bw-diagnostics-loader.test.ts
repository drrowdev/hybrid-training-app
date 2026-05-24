/**
 * Integration-flavoured tests for the diagnostics loader.
 *
 * Uses a hand-rolled fake supabase client (no new npm deps) that
 * implements just enough of the query builder surface used by
 * `loadAndRunBwDiagnostics`. Keeps the test focused on the
 * shaping logic (rows → engine input) and the seeded scenarios
 * called out in the Phase 6 brief.
 */
import { describe, expect, it } from "vitest";
import { loadAndRunBwDiagnostics } from "../bw-diagnostics-loader";

type Row = Record<string, unknown>;

interface FakeQuery {
  select: (cols?: string) => FakeQuery;
  eq: (col: string, val: unknown) => FakeQuery;
  gte: (col: string, val: unknown) => FakeQuery;
  in: (col: string, vals: unknown[]) => FakeQuery;
  not: (...args: unknown[]) => FakeQuery;
  is: (col: string, val: unknown) => FakeQuery;
  neq: (col: string, val: unknown) => FakeQuery;
  order: (col: string, opts?: unknown) => FakeQuery;
  limit: (n: number) => FakeQuery;
  then: <T>(fn: (v: { data: Row[]; error: null }) => T) => Promise<T>;
}

function fakeSupabase(tables: Record<string, Row[]>) {
  const builder = (rows: Row[]): FakeQuery => {
    const q: FakeQuery = {
      select: () => q,
      eq: () => q,
      gte: () => q,
      in: () => q,
      not: () => q,
      is: () => q,
      neq: () => q,
      order: () => q,
      limit: () => q,
      then: <T,>(fn: (v: { data: Row[]; error: null }) => T) =>
        Promise.resolve(fn({ data: rows, error: null })),
    };
    return q;
  };
  return {
    from: (table: string) => builder(tables[table] ?? []),
  } as unknown as Parameters<typeof loadAndRunBwDiagnostics>[0]["supabase"];
}

const NOW = new Date("2026-06-15T12:00:00Z");

describe("loadAndRunBwDiagnostics (integration-flavoured)", () => {
  it("returns only the hinge_gap signal for a brand-new user (no bw_progress, no sessions)", async () => {
    const out = await loadAndRunBwDiagnostics({
      supabase: fakeSupabase({}),
      userId: "u",
      now: NOW,
    });
    // The loader runs the engine even on an empty profile; the only
    // signal that fires without any history is the hinge gap (no
    // hinge work in 14 d). Dashboard gates on `seeded` so this never
    // reaches a brand-new user in practice.
    expect(out.map((r) => r.signal.kind)).toEqual(["hinge_gap_active"]);
  });

  it("fires aesthetics_drift_upper_strong for upper-heavy seeded user", async () => {
    const supabase = fakeSupabase({
      bw_progress: [
        { user_id: "u", family: "push_h", current_node_id: "ph", accumulated_tut_seconds: 0, weeks_at_node: 1, clean_rep_history: [], updated_at: NOW.toISOString() },
        { user_id: "u", family: "push_v", current_node_id: "pv", accumulated_tut_seconds: 0, weeks_at_node: 1, clean_rep_history: [], updated_at: NOW.toISOString() },
        { user_id: "u", family: "pull_h", current_node_id: "puh", accumulated_tut_seconds: 0, weeks_at_node: 1, clean_rep_history: [], updated_at: NOW.toISOString() },
        { user_id: "u", family: "pull_v", current_node_id: "puv", accumulated_tut_seconds: 0, weeks_at_node: 1, clean_rep_history: [], updated_at: NOW.toISOString() },
      ],
      movement_nodes: [
        { id: "ph", family: "push_h", node_key: "ph_n", display_name: "Push H", prerequisites: [], external_load_capable: false, isometric_capable: false, unilateral: false, default_tempo_seconds: 4, tut_per_rep_seconds: 4, difficulty_anchor: 60, created_at: NOW.toISOString() },
        { id: "pv", family: "push_v", node_key: "pv_n", display_name: "Push V", prerequisites: [], external_load_capable: false, isometric_capable: false, unilateral: false, default_tempo_seconds: 4, tut_per_rep_seconds: 4, difficulty_anchor: 60, created_at: NOW.toISOString() },
        { id: "puh", family: "pull_h", node_key: "puh_n", display_name: "Pull H", prerequisites: [], external_load_capable: false, isometric_capable: false, unilateral: false, default_tempo_seconds: 4, tut_per_rep_seconds: 4, difficulty_anchor: 60, created_at: NOW.toISOString() },
        { id: "puv", family: "pull_v", node_key: "puv_n", display_name: "Pull V", prerequisites: [], external_load_capable: false, isometric_capable: false, unilateral: false, default_tempo_seconds: 4, tut_per_rep_seconds: 4, difficulty_anchor: 60, created_at: NOW.toISOString() },
      ],
      bw_progression_events: [],
      planned_sessions: [],
    });
    const out = await loadAndRunBwDiagnostics({
      supabase,
      userId: "u",
      now: NOW,
    });
    expect(
      out.some((r) => r.signal.kind === "aesthetics_drift_upper_strong"),
    ).toBe(true);
  });

  it("fires stall_at_node hard for a user idling 6 weeks", async () => {
    const supabase = fakeSupabase({
      bw_progress: [
        {
          user_id: "u",
          family: "push_h",
          current_node_id: "ph",
          accumulated_tut_seconds: 0,
          weeks_at_node: 6,
          clean_rep_history: [],
          updated_at: NOW.toISOString(),
        },
      ],
      movement_nodes: [
        {
          id: "ph",
          family: "push_h",
          node_key: "ph_n",
          display_name: "Push H",
          prerequisites: [],
          external_load_capable: false,
          isometric_capable: false,
          unilateral: false,
          default_tempo_seconds: 4,
          tut_per_rep_seconds: 4,
          difficulty_anchor: 30,
          created_at: NOW.toISOString(),
        },
      ],
      bw_progression_events: [],
      planned_sessions: [],
    });
    const out = await loadAndRunBwDiagnostics({
      supabase,
      userId: "u",
      now: NOW,
    });
    const stall = out.find((r) => r.signal.kind === "stall_at_node");
    expect(stall).toBeDefined();
    if (stall?.signal.kind === "stall_at_node") {
      expect(stall.signal.severity).toBe("hard");
    }
  });
});
