/**
 * PR Z1 — profile-action tests for cross-device-meaningful state.
 *
 * Validates that each new action:
 *   • runs under the authenticated user (mocked at the supabase layer);
 *   • UPDATEs `profiles` with the right snake_case columns;
 *   • applies the `.eq("id", user.id)` defence-in-depth filter;
 *   • rejects invalid Zod-parsed input without touching the DB.
 *
 * The mock mirrors the swap-actions pattern used elsewhere in this
 * package so the assertions stay close to how the real Supabase JS
 * client is composed at the call site.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const USER_ID = "00000000-0000-4000-8000-0000000000aa";

type UpdateCall = {
  table: string;
  update: Record<string, unknown>;
  eqs: Array<[string, unknown]>;
};

const calls: UpdateCall[] = [];

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect called — not signed in");
  },
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      const call: UpdateCall = { table, update: {}, eqs: [] };
      const eqChain = (col: string, val: unknown) => {
        call.eqs.push([col, val]);
        const next = {
          eq: eqChain,
          then: (onF: (v: { error: null }) => unknown) =>
            Promise.resolve({ error: null }).then(onF),
        };
        return next;
      };
      return {
        update: (row: Record<string, unknown>) => {
          call.update = row;
          calls.push(call);
          return { eq: eqChain };
        },
      };
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));

describe("updateWizardDayPref (PR Z1)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("UPDATEs profiles.wizard_day_pref with the parsed payload", async () => {
    const { updateWizardDayPref } = await import("../actions");
    const pref = {
      byArchetype: {
        strength_anchor: {
          "4": { days: [0, 2, 4, 6], twoADay: false },
        },
      },
    };
    const result = await updateWizardDayPref(pref);
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("profiles");
    expect(calls[0]!.update).toEqual({ wizard_day_pref: pref });
    expect(calls[0]!.eqs).toEqual([["id", USER_ID]]);
  });

  it("rejects a malformed payload without touching the DB", async () => {
    const { updateWizardDayPref } = await import("../actions");
    // `days` must be an array of 0..6 ints — 99 is out of range.
    const result = await updateWizardDayPref({
      byArchetype: {
        x: { "1": { days: [99], twoADay: false } },
      },
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("dismissBwNudge (PR Z1)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("persists the normalized ISO snooze timestamp to profiles", async () => {
    const { dismissBwNudge } = await import("../actions");
    const input = "2026-06-01T12:00:00Z";
    const result = await dismissBwNudge(input);
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("profiles");
    expect(calls[0]!.update).toEqual({
      bw_nudge_hidden_until: new Date(input).toISOString(),
    });
    expect(calls[0]!.eqs).toEqual([["id", USER_ID]]);
  });

  it("rejects garbage timestamps", async () => {
    const { dismissBwNudge } = await import("../actions");
    const result = await dismissBwNudge("not-a-date");
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });
});

describe("dismissBwBanner (PR Z1)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("stamps profiles.bw_banner_dismissed_at to now(), scoped to user", async () => {
    const { dismissBwBanner } = await import("../actions");
    const before = Date.now();
    const result = await dismissBwBanner();
    const after = Date.now();
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("profiles");
    expect(calls[0]!.eqs).toEqual([["id", USER_ID]]);
    const stamp = calls[0]!.update.bw_banner_dismissed_at as string;
    const t = Date.parse(stamp);
    expect(t).toBeGreaterThanOrEqual(before);
    expect(t).toBeLessThanOrEqual(after);
  });
});

describe("markAuditRead (PR Z1)", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("stamps profiles.audit_last_read_at to now(), scoped to user", async () => {
    const { markAuditRead } = await import("../actions");
    const result = await markAuditRead();
    expect(result).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.table).toBe("profiles");
    expect(calls[0]!.eqs).toEqual([["id", USER_ID]]);
    expect(typeof calls[0]!.update.audit_last_read_at).toBe("string");
    expect(Number.isNaN(Date.parse(calls[0]!.update.audit_last_read_at as string))).toBe(false);
  });
});
