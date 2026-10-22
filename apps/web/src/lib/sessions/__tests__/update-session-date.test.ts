import { describe, it, expect, vi, beforeEach } from "vitest";

const USER_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "00000000-0000-4000-8000-000000000010";
const updates: Array<Record<string, unknown>> = [];
let found = true;

vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: () => {
      const chain: Record<string, unknown> = {};
      chain.update = (patch: Record<string, unknown>) => { updates.push(patch); return chain; };
      for (const name of ["eq", "is", "select"]) chain[name] = () => chain;
      chain.maybeSingle = async () => ({ data: found ? { id: SESSION_ID } : null, error: null });
      return chain;
    },
  }),
  getAuthUser: async () => ({ data: { user: { id: USER_ID } }, error: null }),
}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("@/lib/planner/queries", () => ({ getUserTimezone: async () => "UTC", dayDate: () => "" }));
vi.mock("../post-completion-recompute", () => ({
  recomputeAfterCompletedSessionMutation: async () => ({ recomputed: false }),
}));

const ymd = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);
const form = (performedOn: string) => {
  const fd = new FormData();
  fd.set("sessionId", SESSION_ID);
  fd.set("performedOn", performedOn);
  return fd;
};

describe("updateSessionDate", () => {
  beforeEach(() => { updates.length = 0; found = true; });

  it("moves performed_at to the chosen day", async () => {
    const { updateSessionDate } = await import("../actions");
    expect(await updateSessionDate(form(ymd(1)))).toEqual({ ok: true });
    expect(updates[0]).toEqual({ performed_at: `${ymd(1)}T00:00:00.000Z` });
  });

  it("rejects a future date, one beyond the window and a malformed one", async () => {
    const { updateSessionDate } = await import("../actions");
    expect(await updateSessionDate(form(ymd(-2)))).toMatchObject({ error: expect.any(String) });
    expect(await updateSessionDate(form(ymd(20)))).toMatchObject({ error: expect.any(String) });
    expect(await updateSessionDate(form("2026-02-31"))).toMatchObject({ error: expect.any(String) });
    expect(updates).toHaveLength(0);
  });

  it("reports a workout that is not the user's", async () => {
    found = false;
    const { updateSessionDate } = await import("../actions");
    expect(await updateSessionDate(form(ymd(1)))).toEqual({ error: "Workout not found." });
  });
});
