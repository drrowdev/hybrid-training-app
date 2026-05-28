/**
 * Unit tests for `updateLimitations` — the set-and-forget toggle action.
 *
 * Verifies the diff-against-existing-sentinel-rows behaviour:
 *   - Adding a region not currently held inserts a sentinel row.
 *   - Removing a region resolves the matching sentinel.
 *   - Toggling tendinopathy on/off mirrors the same pattern.
 *   - Rich rows (kind set to a free-text injury) are NEVER modified.
 *
 * The supabase client is mocked with a stateful in-memory table so
 * the test can assert the exact inserts/updates that hit the wire.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = {
  id: string;
  user_id: string;
  region: string | null;
  kind: string | null;
  severity: string;
  resolved_at: string | null;
};

type State = {
  rows: Row[];
  inserts: Array<Partial<Row>>;
  resolvedIds: string[];
  nextId: number;
};

const state: State = {
  rows: [],
  inserts: [],
  resolvedIds: [],
  nextId: 1,
};

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "limitations") throw new Error(`unexpected table ${table}`);
      type Builder = {
        _eqs: Array<[string, unknown]>;
        _ins: Array<[string, unknown[]]>;
        _is: [string, unknown] | null;
        _action: "read" | "insert" | "update" | null;
        _payload: unknown;
        select: (cols?: string) => Builder;
        eq: (col: string, val: unknown) => Builder;
        in: (col: string, vals: unknown[]) => Builder;
        is: (col: string, val: unknown) => Builder;
        insert: (payload: Partial<Row> | Partial<Row>[]) => Promise<{ data: null; error: null }>;
        update: (payload: Partial<Row>) => Builder;
        then: (resolve: (v: { data: unknown; error: null }) => void) => void;
      };
      const matches = (r: Row, b: Builder): boolean => {
        if (b._is && (r as unknown as Record<string, unknown>)[b._is[0]] !== b._is[1]) return false;
        for (const [c, v] of b._eqs)
          if ((r as unknown as Record<string, unknown>)[c] !== v) return false;
        for (const [c, vs] of b._ins)
          if (!vs.includes((r as unknown as Record<string, unknown>)[c])) return false;
        return true;
      };
      const builder: Builder = {
        _eqs: [],
        _ins: [],
        _is: null,
        _action: null,
        _payload: null,
        select() {
          this._action = "read";
          return this;
        },
        eq(col, val) {
          this._eqs.push([col, val]);
          return this;
        },
        in(col, vals) {
          this._ins.push([col, vals]);
          return this;
        },
        is(col, val) {
          this._is = [col, val];
          return this;
        },
        insert(payload) {
          const list = Array.isArray(payload) ? payload : [payload];
          for (const p of list) {
            state.inserts.push(p);
            state.rows.push({
              id: `gen-${state.nextId++}`,
              user_id: String(p.user_id ?? ""),
              region: p.region ?? null,
              kind: p.kind ?? null,
              severity: p.severity ?? "moderate",
              resolved_at: null,
            });
          }
          return Promise.resolve({ data: null, error: null });
        },
        update(payload) {
          this._action = "update";
          this._payload = payload;
          return this;
        },
        then(resolve) {
          if (this._action === "update") {
            const payload = this._payload as Partial<Row>;
            for (const r of state.rows) {
              if (!matches(r, this)) continue;
              Object.assign(r, payload);
              if (payload.resolved_at) state.resolvedIds.push(r.id);
            }
            resolve({ data: null, error: null });
            return;
          }
          // read
          const rows = state.rows.filter((r) => matches(r, this));
          resolve({ data: rows, error: null });
        },
      };
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
}));

// Import after mocks.
import {
  updateLimitations,
  KIND_REGION_TOGGLE,
  KIND_TENDINOPATHY,
} from "@/lib/settings/limitations-actions";

beforeEach(() => {
  state.rows = [];
  state.inserts = [];
  state.resolvedIds = [];
  state.nextId = 1;
});

describe("updateLimitations", () => {
  it("inserts sentinel rows for newly checked regions", async () => {
    const r = await updateLimitations({
      blockedRegions: ["knee", "shoulder_scapular"],
      tendinopathyActive: false,
    });
    expect(r).toEqual({ ok: true });
    expect(state.inserts).toHaveLength(2);
    expect(state.inserts.every((i) => i.kind === KIND_REGION_TOGGLE)).toBe(true);
    expect(state.inserts.map((i) => i.region).sort()).toEqual([
      "knee",
      "shoulder_scapular",
    ]);
  });

  it("inserts a tendinopathy sentinel when the flag flips on", async () => {
    const r = await updateLimitations({
      blockedRegions: [],
      tendinopathyActive: true,
    });
    expect(r).toEqual({ ok: true });
    expect(state.inserts).toHaveLength(1);
    expect(state.inserts[0]).toMatchObject({
      kind: KIND_TENDINOPATHY,
      region: null,
    });
  });

  it("is idempotent — re-applying the same state writes nothing", async () => {
    state.rows.push(
      {
        id: "r1",
        user_id: "user-1",
        region: "knee",
        kind: KIND_REGION_TOGGLE,
        severity: "moderate",
        resolved_at: null,
      },
      {
        id: "r2",
        user_id: "user-1",
        region: null,
        kind: KIND_TENDINOPATHY,
        severity: "moderate",
        resolved_at: null,
      },
    );
    const r = await updateLimitations({
      blockedRegions: ["knee"],
      tendinopathyActive: true,
    });
    expect(r).toEqual({ ok: true });
    expect(state.inserts).toHaveLength(0);
    expect(state.resolvedIds).toHaveLength(0);
  });

  it("resolves sentinel rows when a region is unchecked", async () => {
    state.rows.push({
      id: "r1",
      user_id: "user-1",
      region: "knee",
      kind: KIND_REGION_TOGGLE,
      severity: "moderate",
      resolved_at: null,
    });
    const r = await updateLimitations({
      blockedRegions: [],
      tendinopathyActive: false,
    });
    expect(r).toEqual({ ok: true });
    expect(state.inserts).toHaveLength(0);
    expect(state.resolvedIds).toEqual(["r1"]);
  });

  it("never touches rich rows (kind != sentinel)", async () => {
    state.rows.push({
      id: "rich-1",
      user_id: "user-1",
      region: "knee",
      kind: "Patellar tendinitis", // rich /app/recovery/injuries row
      severity: "moderate",
      resolved_at: null,
    });
    const r = await updateLimitations({
      blockedRegions: [],
      tendinopathyActive: false,
    });
    expect(r).toEqual({ ok: true });
    expect(state.resolvedIds).toEqual([]);
    expect(state.rows.find((r) => r.id === "rich-1")?.resolved_at).toBeNull();
  });

  it("rejects unknown regions", async () => {
    const r = await updateLimitations({
      // @ts-expect-error — deliberately bad input
      blockedRegions: ["pecs"],
      tendinopathyActive: false,
    });
    expect(r.ok).toBe(false);
  });
});
