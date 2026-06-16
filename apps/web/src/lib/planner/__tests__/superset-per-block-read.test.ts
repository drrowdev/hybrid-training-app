/**
 * Migration 0111 — per-block superset resolution at the planner READ seam
 * (`getPlannedDays`). The pairing mechanics live in antagonist-pairs /
 * superset-view tests; this pins the precedence the read path resolves:
 *
 *   resolved = block.superset_accessories ?? profilePref ?? false   (`??`, not `||`)
 *
 *   - per-block TRUE  -> pairing (even when the profile pref is off).
 *   - per-block NULL  -> falls back to the profile pref.
 *   - per-block FALSE -> overrides a profile `true` (no pairing).
 *   - all resolved off -> byte-identical, no pairing, no profile/muscle query.
 *
 * Days may span multiple blocks, so resolution is PER DAY: a superset-on day is
 * paired while an off day in the same load stays untouched.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prescription } from "@hta/db";
import { SUPERSET_GROUP_KEY } from "../antagonist-pairs";

const auth = { userId: "user-1" as string | null };

vi.mock("../modifications", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../modifications")>()),
  getActiveModificationRows: vi.fn(async () => []),
}));

interface MockOpts {
  plannedRows: unknown[];
  profilePref: boolean | null;
}

const tableCalls: string[] = [];

let current: MockOpts;

function makeSupabase() {
  return {
    from(table: string) {
      tableCalls.push(table);
      const result =
        table === "planned_sessions"
          ? { data: current.plannedRows, error: null }
          : table === "profiles"
            ? { data: { superset_accessories: current.profilePref }, error: null }
            : table === "movements"
              ? {
                  data: [
                    { id: "curl", primary_muscles: ["biceps"] },
                    { id: "pushdown", primary_muscles: ["triceps"] },
                  ],
                  error: null,
                }
              : { data: null, error: null };
      const builder = {
        select() {
          return this;
        },
        eq() {
          return this;
        },
        in() {
          return this;
        },
        is() {
          return this;
        },
        order() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve(result);
        },
        then(resolve: (v: unknown) => void) {
          resolve(result);
        },
      };
      return builder;
    },
  };
}

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => makeSupabase(),
  getAuthUser: async () => ({
    data: { user: auth.userId ? { id: auth.userId } : null },
    error: null,
  }),
}));

import { getPlannedDays } from "../queries";

function accItems() {
  return [
    { movementId: "curl", kind: "accessory", sets: 3 },
    { movementId: "pushdown", kind: "accessory", sets: 3 },
  ];
}

function row(
  id: string,
  dayIndex: number,
  blockSuperset: boolean | null,
): unknown {
  return {
    id,
    block_id: "block-1",
    week_index: 0,
    day_index: dayIndex,
    slot: "single",
    planned_at: null,
    title: "Accessories",
    role: "accessory",
    prescription: { items: accItems() } as Prescription,
    completed_session_id: null,
    skipped_at: null,
    notes: null,
    training_blocks: { superset_accessories: blockSuperset },
  };
}

function paired(p: Prescription): boolean {
  return (p.items ?? []).some(
    (it) =>
      (it.meta as Record<string, unknown> | undefined)?.[SUPERSET_GROUP_KEY] !=
      null,
  );
}

beforeEach(() => {
  auth.userId = "user-1";
  tableCalls.length = 0;
});

describe("getPlannedDays — per-block superset resolution (migration 0111)", () => {
  it("pairs when the per-block value is TRUE even if the profile pref is off", async () => {
    current = { plannedRows: [row("d1", 0, true)], profilePref: false };
    const days = await getPlannedDays("block-1", "2026-01-05");
    expect(paired(days[0]!.prescription)).toBe(true);
  });

  it("falls back to the profile pref when the per-block value is NULL", async () => {
    current = { plannedRows: [row("d1", 0, null)], profilePref: true };
    const days = await getPlannedDays("block-1", "2026-01-05");
    expect(paired(days[0]!.prescription)).toBe(true);
    // The profile pref WAS consulted because the block value is null.
    expect(tableCalls).toContain("profiles");
  });

  it("lets an explicit per-block FALSE override a profile TRUE (?? not ||)", async () => {
    current = { plannedRows: [row("d1", 0, false)], profilePref: true };
    const days = await getPlannedDays("block-1", "2026-01-05");
    expect(paired(days[0]!.prescription)).toBe(false);
    // An explicit per-block value short-circuits the profile read entirely.
    expect(tableCalls).not.toContain("profiles");
  });

  it("is byte-identical (no pairing, no profile/muscle query) when all days resolve off", async () => {
    current = { plannedRows: [row("d1", 0, null)], profilePref: false };
    const days = await getPlannedDays("block-1", "2026-01-05");
    expect(paired(days[0]!.prescription)).toBe(false);
    // Resolved all-off: never touches the muscle catalog.
    expect(tableCalls).not.toContain("movements");
  });

  it("resolves PER DAY — on days pair, off days in the same load stay untouched", async () => {
    current = {
      plannedRows: [row("d1", 0, true), row("d2", 1, false)],
      profilePref: true,
    };
    const days = await getPlannedDays("block-1", "2026-01-05");
    expect(paired(days[0]!.prescription)).toBe(true);
    expect(paired(days[1]!.prescription)).toBe(false);
  });
});
