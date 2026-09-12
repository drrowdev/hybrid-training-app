import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { swimImportMatchingAvailable } from "../import-matching";
import { findSwimMatchWorkouts, saveSwimImportMatch } from "../import-match-actions";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("../import-matching", () => ({ swimImportMatchingAvailable: vi.fn() }));
vi.mock("../presentation", () => ({ workoutPresentation: () => ({ title: "Endurance swim", total: "300 m", course: "50 m" }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const user = "11111111-1111-4111-8111-111111111111";
const requestId = "22222222-2222-4222-8222-222222222222";
const importId = "33333333-3333-4333-8333-333333333333";
const workoutId = "44444444-4444-4444-8444-444444444444";
const input = { requestId, importId, workoutId, expectedMatchId: null, workoutRevision: 3 };
const rpc = vi.fn();
const eq = vi.fn();
const select = vi.fn();
let rows: unknown[];
let readError: unknown;
const query = {
  select: (value: string) => { select(value); return query; },
  eq: (column: string, value: string) => { eq(column, value); return query; },
  order: () => query, limit: () => query,
  returns: async () => ({ data: rows, error: readError }),
};
const from = vi.fn(() => query);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SWIM_IMPORT_MATCHING_ENABLED", "true");
  vi.mocked(getAuthUser).mockResolvedValue({ data: { user: { id: user } }, error: null } as never);
  vi.mocked(createClient).mockResolvedValue({ rpc, from } as never);
  vi.mocked(swimImportMatchingAvailable).mockResolvedValue(true);
  rpc.mockResolvedValue({ data: requestId, error: null });
  rows = [{
    id: workoutId, user_id: user, revision: 3, scheduled_date: "2026-09-15", slot: "am",
    definition: { issued: {}, courseSource: { title: "Synthetic workout" } },
    swim_plans: { started_on: "2026-09-14", definition: { privateCourse: { title: "Synthetic course" } } },
  }];
  readError = null;
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW4/SW5/SW8 explicit recording matches", () => {
  it("sends only the explicit selection and revision guards, never an owner or result", async () => {
    expect(await saveSwimImportMatch(input)).toEqual({ ok: true, value: requestId });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("swim_match_import", {
      p_request_id: requestId, p_import_id: importId, p_workout_id: workoutId,
      p_expected_match_id: null, p_expected_workout_revision: 3,
    });
    expect(from).not.toHaveBeenCalled();
  });
  it("requires authentication for search, match and undo", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ data: { user: null }, error: null } as never);
    expect((await findSwimMatchWorkouts("2026-09-15")).ok).toBe(false);
    expect((await saveSwimImportMatch(input)).ok).toBe(false);
    expect((await saveSwimImportMatch({ ...input, workoutId: null, workoutRevision: null })).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, userId: user }, { ...input, workoutRevision: null },
    { ...input, workoutId: null }, { ...input, expectedMatchId: "invalid" },
    { ...input, result: { complete: true } }, { ...input, requestId: "" },
  ])("rejects invalid or expanded mutation input", async (value) => {
    expect((await saveSwimImportMatch(value)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps undo available when new matching is disabled", async () => {
    vi.stubEnv("SWIM_IMPORT_MATCHING_ENABLED", "false");
    expect((await saveSwimImportMatch(input)).ok).toBe(false);
    expect((await saveSwimImportMatch({ ...input, workoutId: null, workoutRevision: null })).ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not call an uninstalled mutation", async () => {
    vi.mocked(swimImportMatchingAvailable).mockResolvedValue(false);
    expect((await saveSwimImportMatch(input)).ok).toBe(false);
    expect((await findSwimMatchWorkouts("2026-09-15")).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });
  it.each(["40001", "42501", "23503", "22023"])("surfaces %s without private database details", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "SYNTHETIC_PRIVATE" } });
    const result = await saveSwimImportMatch(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
  });
  it("does not accept an unrelated or missing receipt", async () => {
    for (const data of [null, workoutId, true]) {
      rpc.mockResolvedValue({ data, error: null });
      expect((await saveSwimImportMatch(input)).ok).toBe(false);
    }
  });
  it("searches only the user-selected date and account without selecting a match", async () => {
    const result = await findSwimMatchWorkouts("2026-09-15");
    expect(result).toEqual({ ok: true, value: [{
      id: workoutId, revision: 3, date: "2026-09-15", title: "Synthetic workout",
      distance: "300 m", pool: "50 m", plan: "Synthetic course · 2026-09-14", slot: "AM",
    }] });
    expect(eq.mock.calls).toEqual([["user_id", user], ["scheduled_date", "2026-09-15"]]);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["2026-02-30", "", "2026-09-15,foreign", "not-a-date"])("rejects invalid date %s", async (date) => {
    expect((await findSwimMatchWorkouts(date)).ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });
  it("distinguishes an empty date from unreadable or changed data", async () => {
    rows = [];
    expect(await findSwimMatchWorkouts("2026-09-15")).toEqual({ ok: true, value: [] });
    readError = { message: "SYNTHETIC_PRIVATE" };
    expect((await findSwimMatchWorkouts("2026-09-15")).ok).toBe(false);
    readError = null;
    rows = [{ user_id: workoutId, scheduled_date: "2026-09-15" }];
    expect((await findSwimMatchWorkouts("2026-09-15")).ok).toBe(false);
  });
});
