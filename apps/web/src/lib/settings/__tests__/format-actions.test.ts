/**
 * Server-action: `updateDateTimeFormat`.
 *
 * Covers the timezone-fallback half of the bug fix:
 *   1. When `profiles.timezone` is NULL and the form provides a
 *      recognisable IANA `detectedTimezone`, the update writes
 *      `timezone` alongside the format columns.
 *   2. When `profiles.timezone` is already set, the update preserves
 *      it (no overwrite) even when `detectedTimezone` is present.
 *   3. A bogus `detectedTimezone` (no slash, ill-formed) is ignored.
 *
 * The supabase client is mocked with a chainable builder so the test
 * can introspect the exact update payload that hits `.update()`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type UpdateCall = { payload: Record<string, unknown>; userId: string | null };
type State = {
  profileTimezone: string | null | undefined;
  updateCalls: UpdateCall[];
  selectQueries: string[];
};
const state: State = {
  profileTimezone: null,
  updateCalls: [],
  selectQueries: [],
};

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (path: string) => {
    throw new Error(`redirect to ${path}`);
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      getUser: async () => ({ data: { user: { id: "user-1" } } }),
    },
    from: (table: string) => {
      if (table !== "profiles") throw new Error(`unexpected table ${table}`);
      return {
        select: (cols: string) => {
          state.selectQueries.push(cols);
          return {
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { timezone: state.profileTimezone },
                  error: null,
                }),
            }),
          };
        },
        update: (payload: Record<string, unknown>) => ({
          eq: (_col: string, val: string) => {
            state.updateCalls.push({ payload, userId: val });
            return Promise.resolve({ error: null });
          },
        }),
      };
    },
  }),
}));

// Import AFTER vi.mock so the mocked supabase is used.
import { updateDateTimeFormat } from "../format-actions";

function makeForm(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

beforeEach(() => {
  state.profileTimezone = null;
  state.updateCalls = [];
  state.selectQueries = [];
});

describe("updateDateTimeFormat — timezone backfill", () => {
  it("backfills profiles.timezone when null and a valid IANA detectedTimezone is provided", async () => {
    state.profileTimezone = null;
    await updateDateTimeFormat(
      makeForm({
        timeFormat: "auto",
        dateFormat: "auto",
        detectedTimezone: "Europe/Helsinki",
      }),
    );
    expect(state.updateCalls).toHaveLength(1);
    const call = state.updateCalls[0]!;
    expect(call.payload).toMatchObject({
      time_format: null,
      date_format: null,
      timezone: "Europe/Helsinki",
    });
  });

  it("does not overwrite an existing timezone even when detectedTimezone is provided", async () => {
    state.profileTimezone = "America/New_York";
    await updateDateTimeFormat(
      makeForm({
        timeFormat: "12h",
        dateFormat: "mdy_short",
        detectedTimezone: "Europe/Helsinki",
      }),
    );
    const call = state.updateCalls[0]!;
    expect(call.payload).toMatchObject({
      time_format: "12h",
      date_format: "mdy_short",
    });
    expect("timezone" in call.payload).toBe(false);
  });

  it("treats an empty-string timezone column the same as NULL and backfills", async () => {
    state.profileTimezone = "";
    await updateDateTimeFormat(
      makeForm({
        timeFormat: "auto",
        dateFormat: "auto",
        detectedTimezone: "Asia/Tokyo",
      }),
    );
    const call = state.updateCalls[0]!;
    expect(call.payload).toMatchObject({ timezone: "Asia/Tokyo" });
  });

  it("ignores an ill-formed detectedTimezone value (no slash)", async () => {
    state.profileTimezone = null;
    await updateDateTimeFormat(
      makeForm({
        timeFormat: "auto",
        dateFormat: "auto",
        detectedTimezone: "UTC",
      }),
    );
    const call = state.updateCalls[0]!;
    expect("timezone" in call.payload).toBe(false);
  });

  it("ignores a missing detectedTimezone value", async () => {
    state.profileTimezone = null;
    await updateDateTimeFormat(
      makeForm({
        timeFormat: "24h",
        dateFormat: "iso",
      }),
    );
    const call = state.updateCalls[0]!;
    expect("timezone" in call.payload).toBe(false);
    expect(call.payload).toMatchObject({ time_format: "24h", date_format: "iso" });
  });
});
