import { beforeEach, describe, expect, it, vi } from "vitest";
const { rpc, revalidatePath } = vi.hoisted(() => ({ rpc: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ rpc }),
  getAuthUser: async () => ({ data: { user: { id: "11111111-2222-4222-8222-222222222222" } } }),
}));
import { deleteBlock, restoreBlock } from "../actions";
const id = "11111111-1111-4111-8111-111111111111";

describe("DC-K4/DC-SW7 independent program trash and undo", () => {
  beforeEach(() => {
    rpc.mockReset().mockImplementation(async (name: string) => name === "training_schedule_snapshot"
      ? { data: { revision: "a".repeat(32), entries: [] }, error: null }
      : { data: { id }, error: null });
    revalidatePath.mockClear();
  });
  it("requests soft deletion without turning it into program end", async () => {
    const form = new FormData(); form.set("id", id);
    expect(await deleteBlock(form)).toEqual({ ok: true, blockId: id });
    expect(rpc).toHaveBeenLastCalledWith("training_schedule_commit", expect.objectContaining({
      p_operation: "primary-delete", p_args: { id }, p_expected_revision: "a".repeat(32),
    }));
    expect(revalidatePath).toHaveBeenCalledWith("/app/settings/trash");
  });
  it("restores through the same atomic boundary without implicit overlap consent", async () => {
    expect(await restoreBlock(id)).toEqual({ ok: true });
    expect(rpc).toHaveBeenLastCalledWith("training_schedule_commit", expect.objectContaining({
      p_operation: "primary-restore", p_args: { id }, p_accept_overlap: false,
    }));
  });
  it("rejects a malformed delete identity without storage calls", async () => {
    const form = new FormData(); form.set("id", "not-a-uuid");
    expect(await deleteBlock(form)).toMatchObject({ ok: false });
    expect(rpc).not.toHaveBeenCalled();
  });
  it("returns a rejected restore without revalidating a success", async () => {
    rpc.mockResolvedValueOnce({ data: { revision: "a".repeat(32), entries: [] }, error: null })
      .mockResolvedValueOnce({ data: null, error: { message: "Review overlapping workouts." } });
    expect(await restoreBlock(id)).toEqual({ ok: false, error: "Review overlapping workouts." });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
