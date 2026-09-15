import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { revalidatePath } from "next/cache";
import { AuthSessionMissingError } from "@supabase/supabase-js";
import { createClient, getAuthUser } from "@/lib/supabase/server";
import { swimImportOutcomesAvailable } from "../import-outcomes";
import { saveSwimImportOutcome } from "../import-outcome-actions";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(), getAuthUser: vi.fn() }));
vi.mock("../import-outcomes", () => ({ swimImportOutcomesAvailable: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
const requestId = "11111111-1111-4111-8111-111111111111";
const workoutId = "22222222-2222-4222-8222-222222222222";
const matchId = "33333333-3333-4333-8333-333333333333";
const input = { requestId, workoutId, matchId, outcome: "completed", expectedOutcomeId: null, workoutRevision: 3 };
const remove = { ...input, matchId: null, outcome: null, workoutRevision: null, expectedOutcomeId: matchId };
const rpc = vi.fn();

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "true");
  vi.mocked(getAuthUser).mockResolvedValue({ data: { user: {
    id: "44444444-4444-4444-8444-444444444444", app_metadata: {}, user_metadata: {},
    aud: "authenticated", created_at: "2026-09-14T00:00:00Z",
  } }, error: null });
  vi.mocked(createClient, { partial: true }).mockResolvedValue({ rpc });
  vi.mocked(swimImportOutcomesAvailable).mockResolvedValue(true);
  rpc.mockResolvedValue({ data: requestId, error: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("DC-SW4/SW5/SW8 explicit imported outcomes", () => {
  it.each(["completed", "stopped_early"])("saves %s without an owner, measurements or training writes", async (outcome) => {
    expect(await saveSwimImportOutcome({ ...input, outcome })).toEqual({ ok: true, value: requestId });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("swim_confirm_import_outcome", {
      p_request_id: requestId, p_workout_id: workoutId, p_match_id: matchId, p_outcome: outcome,
      p_expected_outcome_id: null, p_expected_workout_revision: 3,
    });
    expect(vi.mocked(revalidatePath).mock.calls).toEqual([
      ["/app/swim", "layout"], ["/app/plan"], ["/app/plan/history"], ["/app/sessions"], ["/app"],
    ]);
  });
  it("requires authentication for both confirmation and removal", async () => {
    vi.mocked(getAuthUser).mockResolvedValue({ data: { user: null }, error: new AuthSessionMissingError() });
    expect((await saveSwimImportOutcome(input)).ok).toBe(false);
    expect((await saveSwimImportOutcome(remove)).ok).toBe(false);
    expect(createClient).not.toHaveBeenCalled();
  });
  it.each([
    { ...input, outcome: null }, { ...input, matchId: null }, { ...input, workoutRevision: 1.5 },
    { ...input, workoutRevision: null }, { ...input, userId: workoutId },
    { ...input, result: { distance: 100 } }, { ...input, outcome: "matched" },
    { ...input, expectedOutcomeId: "bad" }, { ...input, requestId: "" },
  ])("rejects invalid or expanded input before authentication", async (value) => {
    expect((await saveSwimImportOutcome(value)).ok).toBe(false);
    expect(getAuthUser).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("keeps removal available with confirmations disabled", async () => {
    vi.stubEnv("SWIM_IMPORT_OUTCOMES_ENABLED", "false");
    expect((await saveSwimImportOutcome(input)).ok).toBe(false);
    expect((await saveSwimImportOutcome(remove)).ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
  it("does not mutate before outcome storage is installed", async () => {
    vi.mocked(swimImportOutcomesAvailable).mockResolvedValue(false);
    expect((await saveSwimImportOutcome(input)).ok).toBe(false);
    expect((await saveSwimImportOutcome(remove)).ok).toBe(false);
    expect(rpc).not.toHaveBeenCalled();
  });
  it.each(["40001", "42501", "23503", "22023"])("reports %s without exposing database details", async (code) => {
    rpc.mockResolvedValue({ data: null, error: { code, message: "SYNTHETIC_PRIVATE" } });
    const result = await saveSwimImportOutcome(input);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("SYNTHETIC_PRIVATE");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it.each([null, workoutId, true, {}])("does not accept an unrelated receipt", async (data) => {
    rpc.mockResolvedValue({ data, error: null });
    expect((await saveSwimImportOutcome(input)).ok).toBe(false);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("distinguishes a saved outcome from a refresh failure", async () => {
    vi.mocked(revalidatePath).mockImplementation(() => { throw new Error("Synthetic refresh failure"); });
    expect(await saveSwimImportOutcome(input)).toMatchObject({ ok: true, value: requestId, warning: expect.any(String) });
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
