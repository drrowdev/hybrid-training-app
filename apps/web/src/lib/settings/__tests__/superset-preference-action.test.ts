/**
 * Unit tests for `updateProfile` — the antagonist-superset preference path
 * (ADR 0026).
 *
 * Locks the present-sentinel + "on" checkbox convention -> `superset_accessories`
 * column mapping, and that an absent checkbox leaves the column untouched (so a
 * single-field auto-save never clobbers unrelated columns).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

type UpdateCall = Record<string, unknown>;

const state: { updates: UpdateCall[] } = { updates: [] };

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      const builder = {
        _action: null as "update" | "read" | null,
        select() {
          this._action = "read";
          return this;
        },
        update(payload: UpdateCall) {
          this._action = "update";
          state.updates.push(payload);
          return this;
        },
        eq() {
          return this;
        },
        maybeSingle() {
          return Promise.resolve({ data: null, error: null });
        },
        then(resolve: (v: { data: null; error: null }) => void) {
          resolve({ data: null, error: null });
        },
      };
      return builder;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: "user-1" } }, error: null }),
}));

import { updateProfile } from "@/lib/settings/actions";

beforeEach(() => {
  state.updates = [];
});

describe("updateProfile — superset_accessories", () => {
  it("writes superset_accessories=true when the checkbox is present and on", async () => {
    const fd = new FormData();
    fd.set("supersetAccessoriesPresent", "1");
    fd.set("supersetAccessories", "on");
    await updateProfile(fd);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0]).toEqual({ superset_accessories: true });
  });

  it("writes superset_accessories=false when present but unchecked", async () => {
    const fd = new FormData();
    fd.set("supersetAccessoriesPresent", "1");
    await updateProfile(fd);
    expect(state.updates[0]).toEqual({ superset_accessories: false });
  });

  it("leaves the column untouched when the present marker is absent", async () => {
    const fd = new FormData();
    fd.set("hapticsEnabledPresent", "1");
    fd.set("hapticsEnabled", "on");
    await updateProfile(fd);
    expect(state.updates[0]).not.toHaveProperty("superset_accessories");
    expect(state.updates[0]).toEqual({ haptics_enabled: true });
  });
});
