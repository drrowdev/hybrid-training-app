/**
 * Server-action: `setBwNodeManual`.
 *
 * Covers:
 *   1. Reaches an upgrade with prereq satisfied — upsert + audit row.
 *   2. Rejects a downgrade without `allowDowngrade`.
 *   3. Accepts a downgrade with `allowDowngrade=true` and records audit.
 *   4. Rejects unmet prereqs unless `allowSkipPrereqs` is set.
 *   5. Seeds a brand-new family (no prior row) without writing an audit
 *      event (schema requires NOT NULL on `from_node_id`).
 *   6. Rejects a node from the wrong family.
 *
 * The Supabase client is mocked with a chainable builder so the test
 * inspects each table's writes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type CatalogRow = {
  id: string;
  family: string;
  prerequisites: string[];
  difficulty_anchor: number;
};

const CATALOG: CatalogRow[] = [
  { id: "00000000-0000-0000-0000-00000000000a", family: "push_h", prerequisites: [], difficulty_anchor: 10 },
  { id: "00000000-0000-0000-0000-00000000000b", family: "push_h", prerequisites: ["00000000-0000-0000-0000-00000000000a"], difficulty_anchor: 20 },
  { id: "00000000-0000-0000-0000-00000000000c", family: "push_h", prerequisites: ["00000000-0000-0000-0000-00000000000b"], difficulty_anchor: 30 },
  // Orphan in another family — used to assert the family-mismatch guard.
  { id: "00000000-0000-0000-0000-00000000000d", family: "pull_v", prerequisites: [], difficulty_anchor: 10 },
];

type State = {
  currentNodeId: string | null;
  upserts: unknown[];
  events: unknown[];
};
const state: State = { currentNodeId: null, upserts: [], events: [] };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table === "movement_nodes") {
        return {
          select: () => ({
            eq: (_col: string, family: string) =>
              Promise.resolve({
                data: CATALOG.filter((c) => c.family === family),
                error: null,
              }),
          }),
        };
      }
      if (table === "bw_progress") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: () =>
                  Promise.resolve({
                    data:
                      state.currentNodeId != null
                        ? { current_node_id: state.currentNodeId }
                        : null,
                    error: null,
                  }),
              }),
            }),
          }),
          upsert: (row: unknown) => {
            state.upserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      if (table === "bw_progression_events") {
        return {
          insert: (row: unknown) => {
            state.events.push(row);
            return Promise.resolve({ error: null });
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  }),
}));

import { setBwNodeManual } from "../bw-progress-manual";

beforeEach(() => {
  state.currentNodeId = null;
  state.upserts = [];
  state.events = [];
});

describe("setBwNodeManual", () => {
  it("upgrade with satisfied prereq → upsert + audit row", async () => {
    state.currentNodeId = "00000000-0000-0000-0000-00000000000a";
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000b",
    });
    expect(r.ok).toBe(true);
    expect(state.upserts).toHaveLength(1);
    expect(state.upserts[0]).toMatchObject({
      user_id: "user-1",
      family: "push_h",
      current_node_id: "00000000-0000-0000-0000-00000000000b",
      accumulated_tut_seconds: 0,
      weeks_at_node: 0,
    });
    expect(state.events).toHaveLength(1);
    expect(state.events[0]).toMatchObject({
      family: "push_h",
      from_node_id: "00000000-0000-0000-0000-00000000000a",
      to_node_id: "00000000-0000-0000-0000-00000000000b",
      reason: "manual_set",
    });
  });

  it("rejects a downgrade without allowDowngrade", async () => {
    state.currentNodeId = "00000000-0000-0000-0000-00000000000b";
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000a",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("downgrade");
    expect(state.upserts).toHaveLength(0);
    expect(state.events).toHaveLength(0);
  });

  it("accepts a downgrade with allowDowngrade=true", async () => {
    state.currentNodeId = "00000000-0000-0000-0000-00000000000b";
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000a",
      allowDowngrade: true,
    });
    expect(r.ok).toBe(true);
    expect(state.upserts).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });

  it("rejects unmet prereqs (skip a tier)", async () => {
    state.currentNodeId = "00000000-0000-0000-0000-00000000000a";
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000c",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.toLowerCase()).toContain("prereq");
    expect(state.upserts).toHaveLength(0);
  });

  it("allowSkipPrereqs lets the user seed an advanced node", async () => {
    state.currentNodeId = "00000000-0000-0000-0000-00000000000a";
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000c",
      allowSkipPrereqs: true,
    });
    expect(r.ok).toBe(true);
    expect(state.upserts).toHaveLength(1);
  });

  it("seeds a brand-new family with no prior row and no audit event", async () => {
    state.currentNodeId = null;
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000a",
    });
    expect(r.ok).toBe(true);
    expect(state.upserts).toHaveLength(1);
    // No from_node_id available → no event row written.
    expect(state.events).toHaveLength(0);
  });

  it("rejects a node id that does not belong to the requested family", async () => {
    const r = await setBwNodeManual({
      family: "push_h",
      nodeId: "00000000-0000-0000-0000-00000000000d", // belongs to pull_v
    });
    expect(r.ok).toBe(false);
    expect(state.upserts).toHaveLength(0);
  });
});
