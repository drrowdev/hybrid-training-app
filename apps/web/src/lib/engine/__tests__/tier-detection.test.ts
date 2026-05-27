/**
 * Tests for the anchor-adherence side of `gatherTierInputs`.
 *
 * Backs PR D — engine-actual-vs-prescribed-audit.md finding H1:
 * a planned anchor session counts as adherent only when the linked
 * `sessions` row carries at least one non-warmup `set_logs` entry
 * whose `movement_id` is in `STRENGTH_ROLE_CANDIDATES` for the
 * anchor's main-lift role. Merely linking a session row is not
 * enough — the user can't earn Squat-anchor credit by logging
 * only a tricep extension.
 */
import { describe, it, expect } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { gatherTierInputs } from "../tier-detection";

type Row = Record<string, unknown>;

type Tables = {
  profiles?: Row[];
  training_maxes?: Row[];
  planned_sessions?: Row[];
  sessions?: Row[];
  movements?: Row[];
  set_logs?: Row[];
};

function makeStub(initial: Tables = {}): SupabaseClient {
  const tables: Record<string, Row[]> = {};
  for (const [k, v] of Object.entries(initial)) tables[k] = (v as Row[]).slice();

  function from(table: string) {
    let rows = (tables[table] ?? []).slice();

    const builder: Record<string, unknown> = {};
    const apply = (pred: (r: Row) => boolean) => {
      rows = rows.filter(pred);
      return builder;
    };

    builder.select = () => builder;
    builder.eq = (col: string, val: unknown) => apply((r) => r[col] === val);
    builder.neq = (col: string, val: unknown) => apply((r) => r[col] !== val);
    builder.in = (col: string, vals: unknown[]) =>
      apply((r) => vals.includes(r[col]));
    builder.gte = (col: string, val: unknown) =>
      apply((r) => r[col] != null && String(r[col]) >= String(val));
    builder.lte = (col: string, val: unknown) =>
      apply((r) => r[col] != null && String(r[col]) <= String(val));
    builder.is = (col: string, val: unknown) => {
      if (val === null) return apply((r) => r[col] == null);
      return apply((r) => r[col] === val);
    };
    builder.not = (col: string, op: string, val: unknown) => {
      if (op === "is" && val === null) return apply((r) => r[col] != null);
      return apply((r) => r[col] !== val);
    };
    builder.order = () => builder;
    builder.limit = () => builder;
    builder.maybeSingle = () =>
      Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.single = () =>
      Promise.resolve({ data: rows[0] ?? null, error: null });
    builder.then = (onF: (v: { data: unknown; error: null }) => unknown) =>
      Promise.resolve({ data: rows, error: null }).then(onF);

    return builder;
  }

  return { from } as unknown as SupabaseClient;
}

// ── Fixture helpers ───────────────────────────────────────────────────

// Two slugs from the squat role's candidate list (high-bar, front squat).
const SQUAT_MOVEMENT_A_ID = "11111111-1111-1111-1111-111111111111";
const SQUAT_MOVEMENT_B_ID = "11111111-1111-1111-1111-111111111112";
// A bench-role candidate.
const BENCH_MOVEMENT_ID = "22222222-2222-2222-2222-222222222222";
// A non-main-lift movement (the "tricep extension" foil).
const NON_ANCHOR_MOVEMENT_ID = "33333333-3333-3333-3333-333333333333";

function movementCatalog(): Row[] {
  // Only the main-lift candidates need to come back from the
  // movements query — the stub filters via `.in("slug", …)`. The
  // tier-detection query selects "id, slug".
  return [
    { id: SQUAT_MOVEMENT_A_ID, slug: "back-squat-high-bar" },
    { id: SQUAT_MOVEMENT_B_ID, slug: "front-squat" },
    { id: BENCH_MOVEMENT_ID, slug: "bench-press-flat" },
  ];
}

const USER_ID = "user-1";
const NOW_ISO = new Date().toISOString();

function squatAnchor(opts: {
  id: string;
  completedSessionId: string | null;
  movementId?: string;
}): Row {
  return {
    id: opts.id,
    user_id: USER_ID,
    role: "squat",
    completed_session_id: opts.completedSessionId,
    skipped_at: null,
    created_at: NOW_ISO,
    prescription: {
      items: [
        {
          movementId: opts.movementId ?? SQUAT_MOVEMENT_A_ID,
          sets: 3,
          reps: 5,
        },
      ],
    },
  };
}

function setLog(opts: {
  id: string;
  sessionId: string;
  movementId: string;
  setKind?: string;
}): Row {
  return {
    id: opts.id,
    session_id: opts.sessionId,
    movement_id: opts.movementId,
    set_kind: opts.setKind ?? "main",
  };
}

// ── Tests ────────────────────────────────────────────────────────────

describe("gatherTierInputs — anchor adherence (audit H1)", () => {
  it("counts an anchor session when the linked session has a logged anchor set", async () => {
    const client = makeStub({
      planned_sessions: [
        squatAnchor({ id: "ps-1", completedSessionId: "s-1" }),
      ],
      movements: movementCatalog(),
      set_logs: [
        setLog({
          id: "sl-1",
          sessionId: "s-1",
          movementId: SQUAT_MOVEMENT_A_ID,
        }),
      ],
    });
    const r = await gatherTierInputs(client, USER_ID);
    expect(r.anchorAdherenceLast12w).toBe(1);
  });

  it("does NOT count an anchor session whose only anchor-lift set is a warmup", async () => {
    const client = makeStub({
      planned_sessions: [
        squatAnchor({ id: "ps-1", completedSessionId: "s-1" }),
      ],
      movements: movementCatalog(),
      set_logs: [
        setLog({
          id: "sl-1",
          sessionId: "s-1",
          movementId: SQUAT_MOVEMENT_A_ID,
          setKind: "warmup",
        }),
      ],
    });
    const r = await gatherTierInputs(client, USER_ID);
    expect(r.anchorAdherenceLast12w).toBe(0);
  });

  it("does NOT count an anchor session whose linked session has zero anchor-lift sets (only non-anchor work)", async () => {
    const client = makeStub({
      planned_sessions: [
        squatAnchor({ id: "ps-1", completedSessionId: "s-1" }),
      ],
      movements: movementCatalog(),
      set_logs: [
        // Logged a tricep extension instead of any squat variant.
        setLog({
          id: "sl-1",
          sessionId: "s-1",
          movementId: NON_ANCHOR_MOVEMENT_ID,
        }),
      ],
    });
    const r = await gatherTierInputs(client, USER_ID);
    expect(r.anchorAdherenceLast12w).toBe(0);
  });

  it("counts the session when the logged anchor work is a different variant in the same role (high-bar + front squat)", async () => {
    const client = makeStub({
      planned_sessions: [
        // Anchor prescribed high-bar, but the user logged front squat
        // — both are in the squat role's candidate list, so still
        // a real anchor effort.
        squatAnchor({
          id: "ps-1",
          completedSessionId: "s-1",
          movementId: SQUAT_MOVEMENT_A_ID,
        }),
      ],
      movements: movementCatalog(),
      set_logs: [
        setLog({
          id: "sl-1",
          sessionId: "s-1",
          movementId: SQUAT_MOVEMENT_B_ID,
        }),
      ],
    });
    const r = await gatherTierInputs(client, USER_ID);
    expect(r.anchorAdherenceLast12w).toBe(1);
  });

  it("does NOT credit a Squat anchor for sets logged in a different main-lift role (e.g. Bench)", async () => {
    const client = makeStub({
      planned_sessions: [
        squatAnchor({ id: "ps-1", completedSessionId: "s-1" }),
      ],
      movements: movementCatalog(),
      set_logs: [
        setLog({
          id: "sl-1",
          sessionId: "s-1",
          movementId: BENCH_MOVEMENT_ID,
        }),
      ],
    });
    const r = await gatherTierInputs(client, USER_ID);
    expect(r.anchorAdherenceLast12w).toBe(0);
  });

  it("returns null when there are no anchor sessions at all", async () => {
    const client = makeStub({
      planned_sessions: [],
      movements: movementCatalog(),
      set_logs: [],
    });
    const r = await gatherTierInputs(client, USER_ID);
    expect(r.anchorAdherenceLast12w).toBeNull();
  });

  it("computes a partial fraction across mixed-quality anchors", async () => {
    const client = makeStub({
      planned_sessions: [
        // Real anchor effort.
        squatAnchor({ id: "ps-1", completedSessionId: "s-1" }),
        // Linked, but only a warmup on the anchor → does not count.
        squatAnchor({ id: "ps-2", completedSessionId: "s-2" }),
        // Not yet completed → in the denominator but not the numerator.
        squatAnchor({ id: "ps-3", completedSessionId: null }),
      ],
      movements: movementCatalog(),
      set_logs: [
        setLog({
          id: "sl-1",
          sessionId: "s-1",
          movementId: SQUAT_MOVEMENT_A_ID,
        }),
        setLog({
          id: "sl-2",
          sessionId: "s-2",
          movementId: SQUAT_MOVEMENT_A_ID,
          setKind: "warmup",
        }),
      ],
    });
    const r = await gatherTierInputs(client, USER_ID);
    // 1 of 3 anchors is adherent under the tightened rule.
    expect(r.anchorAdherenceLast12w).toBeCloseTo(1 / 3, 5);
  });
});
