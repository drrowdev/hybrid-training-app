/**
 * Server-action: `updateProfile` — Today recovery card toggle.
 *
 * Migration 0049 added `profiles.show_today_recovery_card`. The
 * settings page exposes it as a checkbox + hidden
 * `showTodayRecoveryCardPresent=1` marker so we can distinguish
 * "checkbox unchecked" (FormData omits the field entirely) from
 * "form did not include this control" (don't touch the column).
 *
 * These tests pin the FormData → DB-update mapping:
 *   - present=1 + checked      → show_today_recovery_card: true
 *   - present=1 + unchecked    → show_today_recovery_card: false
 *   - present marker missing   → column not in the update payload
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type UpdateCall = { payload: Record<string, unknown> };
type State = {
  updateCalls: UpdateCall[];
};
const state: State = { updateCalls: [] };

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (p: string) => {
    throw new Error(`redirect to ${p}`);
  },
}));

vi.mock("@/lib/engine/overrides", () => ({
  recordOverrideEvent: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (_table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({ data: { training_experience: null }, error: null }),
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => {
          state.updateCalls.push({ payload });
          return Promise.resolve({ error: null });
        },
      }),
    }),
  }),
}));

// Import AFTER mocks.
import { updateProfile } from "../actions";

function formWith(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.updateCalls = [];
});

describe("updateProfile — Today recovery card toggle", () => {
  it("writes show_today_recovery_card=true when present + checked", async () => {
    await updateProfile(
      formWith({
        showTodayRecoveryCardPresent: "1",
        showTodayRecoveryCard: "on",
      }),
    );
    const payload = state.updateCalls[0]?.payload ?? {};
    expect(payload.show_today_recovery_card).toBe(true);
  });

  it("writes show_today_recovery_card=false when present + unchecked", async () => {
    await updateProfile(formWith({ showTodayRecoveryCardPresent: "1" }));
    const payload = state.updateCalls[0]?.payload ?? {};
    expect(payload.show_today_recovery_card).toBe(false);
  });

  it("omits the column when the present marker is absent", async () => {
    // Some other form is being saved — must not clobber this field.
    await updateProfile(
      formWith({ hapticsEnabledPresent: "1", hapticsEnabled: "on" }),
    );
    const payload = state.updateCalls[0]?.payload ?? {};
    expect("show_today_recovery_card" in payload).toBe(false);
  });
});
