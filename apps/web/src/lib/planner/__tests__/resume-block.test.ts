import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ rpc: vi.fn(), revalidatePath: vi.fn(), signedIn: true }));
vi.mock("next/cache", () => ({ revalidatePath: mock.revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc: mock.rpc }),
  getAuthUser: async () => ({ data: { user: mock.signedIn ? { id: "owner" } : null } }),
}));
import { resumeBlock } from "../actions";
const id = "11111111-1111-4111-8111-111111111111";
const review = { revision: "a".repeat(32), requestId: "22222222-2222-4222-8222-222222222222", acceptOverlap: true };

describe("DC-K4: resume action preserves reviewed dates and fails closed", () => {
  beforeEach(() => {
    mock.signedIn = true;
    mock.revalidatePath.mockClear();
    mock.rpc.mockReset().mockImplementation(async (name: string) => ({
      data: name === "training_schedule_snapshot" ? { revision: review.revision, entries: [] } : { id }, error: null,
    }));
  });
  it("resumes through the existing atomic boundary and refreshes every affected view", async () => {
    expect(await resumeBlock(id, review)).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenCalledWith("independent_program_schedule_commit", expect.objectContaining({
      p_operation: "primary-resume", p_args: { id }, p_expected_revision: review.revision,
      p_request_id: review.requestId, p_accept_overlap: true,
    }));
    for (const path of ["/app", "/app/plan", "/app/programs", "/app/plan/history", "/app/stats"]) {
      expect(mock.revalidatePath).toHaveBeenCalledWith(path);
    }
  });
  it("does not assume overlap consent without a review", async () => {
    expect(await resumeBlock(id)).toEqual({ ok: true });
    expect(mock.rpc).toHaveBeenLastCalledWith("independent_program_schedule_commit", expect.objectContaining({
      p_operation: "primary-resume", p_accept_overlap: false,
    }));
  });
  it.each([
    { code: "22023", message: "Unsupported schedule change." },
    { code: "PGRST202", message: "independent_program_schedule_commit not found" },
    { code: "42883", message: "independent_program_schedule_commit does not exist" },
    { code: "XX000", message: "private database details" },
  ])("returns retry copy for app-first or unexpected storage failures: $code", async (error) => {
    mock.rpc.mockResolvedValue({ data: null, error });
    expect(await resumeBlock(id, review)).toEqual({ error: "Couldn't resume. Try again in a moment." });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
  it.each([
    { code: "22023", message: "This program has no workouts left." },
    { code: "22023", message: "This program cannot be resumed." },
    { code: "23505", message: "End Strength first." },
    { code: "40001", message: "Your schedule changed. Review the dates again." },
  ])("returns only recognised actionable refusals: $message", async (error) => {
    mock.rpc.mockResolvedValue({ data: null, error });
    expect(await resumeBlock(id, review)).toEqual({ error: error.message });
    expect(mock.revalidatePath).not.toHaveBeenCalled();
  });
  it("never throws for invalid review, missing auth or a rejected client", async () => {
    expect(await resumeBlock("bad")).toHaveProperty("error");
    expect(await resumeBlock(id, { ...review, revision: "bad" })).toHaveProperty("error");
    mock.signedIn = false;
    expect(await resumeBlock(id, review)).toEqual({ error: "Not signed in." });
    expect(mock.rpc).not.toHaveBeenCalled();
    mock.signedIn = true;
    mock.rpc.mockRejectedValue(new Error("offline"));
    expect(await resumeBlock(id, review)).toEqual({ error: "Couldn't resume. Try again in a moment." });
  });
});
