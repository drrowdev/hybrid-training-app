import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, revalidatePath } = vi.hoisted(() => ({ rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
  getAuthUser: async () => ({ data: { user: { id: "11111111-2222-4222-8222-222222222222" } } }),
}));
import { endBlock } from "../actions";
const id = "11111111-1111-4111-8111-111111111111";

describe("DC-K4/DC-SW7 ending only the selected primary program", () => {
  beforeEach(() => {
    rpc.mockReset().mockImplementation(async (name: string) => name === "training_schedule_snapshot"
      ? { data: { revision: "a".repeat(32), entries: [] }, error: null }
      : { data: { id }, error: null });
    revalidatePath.mockClear();
  });
  it("sends the identity and audit reason to the shared atomic boundary", async () => {
    const form = new FormData(); form.set("id", id); form.set("reason", "Switching to a deload block");
    await endBlock(form);
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc).toHaveBeenLastCalledWith("training_schedule_commit", expect.objectContaining({
      p_operation: "primary-end", p_args: { id, reason: "Switching to a deload block" },
      p_expected_revision: "a".repeat(32), p_accept_overlap: false,
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/app");
  });
  it("surfaces stale transactions without claiming success", async () => {
    rpc.mockResolvedValueOnce({ data: { revision: "a".repeat(32), entries: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Your schedule changed." } });
    const form = new FormData(); form.set("id", id);
    await expect(endBlock(form)).rejects.toThrow("Your schedule changed.");
    expect(revalidatePath).not.toHaveBeenCalled();
  });
  it("rejects malformed ids before any database call", async () => {
    const form = new FormData(); form.set("id", "not-a-uuid");
    await expect(endBlock(form)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
});
