/**
 * applyProgramProgression — the completion-time hook that advances a platform
 * instance and persists program-owned recommendations. Exercised with a fake
 * Supabase against the real 5/3/1 engine: a 7th-week TM-test logged with too few
 * reps must yield a surfaced `tm-reset` recommendation row.
 */
import { describe, it, expect } from "vitest";
import { wendler531Engine } from "@hta/wendler";
import { applyProgramProgression } from "../progression";

const ctx = { oneRepMaxes: { squat: 165, bench: 118, deadlift: 212, press: 71 }, roundingKg: 2.5 };

function wendlerInstance() {
  return wendler531Engine.setup(
    { values: { templateId: "5spro-fsl", leaderCycles: 2, anchorCycles: 1, tmPercent: 0.85 } },
    ctx,
  );
}

// Resolve the 7th-week TM-test ref for the squat (the test verdict path).
function squatTestRef(): string {
  const inst = wendlerInstance();
  const test = wendler531Engine
    .timeline(inst)
    .find((s) => s.kind === "test" && s.tags?.includes("lift:squat"));
  if (!test) throw new Error("no squat TM-test ref");
  return test.ref;
}

type Canned = Record<string, { single?: unknown; list?: unknown[] }>;

interface Recorded {
  inserts: { table: string; rows: unknown }[];
  updates: { table: string; values: unknown }[];
}

/** Minimal thenable query-builder fake covering the calls the hook makes. */
function fakeSupabase(canned: Canned, rec: Recorded) {
  function builder(table: string) {
    let mode: "select" | "insert" | "update" = "select";
    const b: Record<string, unknown> = {};
    const chain = () => b as never;
    b.select = () => chain();
    b.eq = () => chain();
    b.order = () => chain();
    b.limit = () => chain();
    b.insert = (rows: unknown) => {
      mode = "insert";
      rec.inserts.push({ table, rows });
      return chain();
    };
    b.upsert = (rows: unknown) => {
      mode = "insert";
      rec.inserts.push({ table, rows });
      return chain();
    };
    b.update = (values: unknown) => {
      mode = "update";
      rec.updates.push({ table, values });
      return chain();
    };
    b.maybeSingle = async () => ({ data: canned[table]?.single ?? null, error: null });
    // Thenable: `await from().select().eq()...` resolves to a list (or write result).
    b.then = (resolve: (v: unknown) => void) => {
      if (mode === "select") resolve({ data: canned[table]?.list ?? [], error: null });
      else resolve({ error: null });
    };
    return b;
  }
  return { from: (t: string) => builder(t) } as never;
}

describe("applyProgramProgression — 5/3/1 7th-week TM test", () => {
  it("surfaces a tm-reset recommendation when reps at TM are too low", async () => {
    const ref = squatTestRef();
    const rec: Recorded = { inserts: [], updates: [] };
    const supabase = fakeSupabase(
      {
        program_instances: { single: { id: "pi1", program_id: "wendler-531", instance: wendlerInstance() } },
        planned_sessions: { single: { prescription: { items: [{ kind: "main", isAmrap: true }], programRef: ref } } },
        set_logs: {
          list: [
            {
              weight_kg: 140,
              reps: 2, // < 3 → evaluateTmTest → "lower" → tm-reset
              rpe: 9,
              set_kind: "main",
              notes: null,
              prescription_item_index: 0,
              movement: { slug: "back-squat-high-bar" },
            },
          ],
        },
        training_maxes: {
          list: [{ one_rm_kg: 165, movement: { id: "mv-squat", slug: "back-squat-high-bar", display_name: "Squat" } }],
        },
        program_recommendations: { list: [] },
      },
      rec,
    );

    await applyProgramProgression({
      supabase,
      userId: "u1",
      sessionId: "s1",
      blockId: "b1",
      performedAt: "2026-06-11T00:00:00Z",
    });

    // Instance was persisted back.
    expect(rec.updates.some((u) => u.table === "program_instances")).toBe(true);
    // A tm-reset recommendation row was inserted.
    const recInsert = rec.inserts.find((i) => i.table === "program_recommendations");
    expect(recInsert, "a recommendation should be inserted").toBeTruthy();
    const rows = recInsert!.rows as { kind: string; block_id: string; user_id: string }[];
    expect(rows.some((r) => r.kind === "tm-reset")).toBe(true);
    expect(rows.every((r) => r.user_id === "u1" && r.block_id === "b1")).toBe(true);
  });

  it("is a no-op when the block has no program instance (archetype block)", async () => {
    const rec: Recorded = { inserts: [], updates: [] };
    const supabase = fakeSupabase({ program_instances: { single: null } }, rec);
    await applyProgramProgression({ supabase, userId: "u1", sessionId: "s1", blockId: "b1" });
    expect(rec.inserts).toHaveLength(0);
    expect(rec.updates).toHaveLength(0);
  });

  it("does not surface a plain tm-bump (covered by the generic AMRAP banner)", async () => {
    // A normal training session ref (not 7th-week) with a big AMRAP → engine
    // emits tm-bump, which we intentionally do NOT surface here.
    const inst = wendlerInstance();
    const normal = wendler531Engine
      .timeline(inst)
      .find((s) => s.kind === "training" && s.tags?.includes("lift:squat") && s.tags?.includes("week:3"));
    const ref = normal!.ref;
    const rec: Recorded = { inserts: [], updates: [] };
    const supabase = fakeSupabase(
      {
        program_instances: { single: { id: "pi1", program_id: "wendler-531", instance: inst } },
        planned_sessions: { single: { prescription: { items: [{ kind: "main", isAmrap: true }], programRef: ref } } },
        set_logs: {
          list: [
            {
              weight_kg: 180,
              reps: 12,
              rpe: 9,
              set_kind: "main",
              notes: "amrap",
              prescription_item_index: 0,
              movement: { slug: "back-squat-high-bar" },
            },
          ],
        },
        training_maxes: {
          list: [{ one_rm_kg: 165, movement: { id: "mv-squat", slug: "back-squat-high-bar", display_name: "Squat" } }],
        },
        program_recommendations: { list: [] },
      },
      rec,
    );

    await applyProgramProgression({ supabase, userId: "u1", sessionId: "s1", blockId: "b1" });
    const recInsert = rec.inserts.find((i) => i.table === "program_recommendations");
    expect(recInsert, "tm-bump should not be surfaced as a program recommendation").toBeFalsy();
  });
});
