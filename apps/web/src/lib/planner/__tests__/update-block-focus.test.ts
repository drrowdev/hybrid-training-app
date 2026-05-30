/**
 * Tests for the updateBlockFocus server action.
 *
 * Validates the RLS-scoped, idempotent server contract used by the
 * Plan-page edit modal. The Supabase client is mocked so we exercise
 * the action's input handling, Zod validation, and update-payload
 * shape without touching the database.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

type EqFn = ReturnType<typeof vi.fn>;

const updateMock = vi.fn();
const eqMock1 = vi.fn();
const eqMock2 = vi.fn();
const fromMock = vi.fn();
const revalidatePathMock = vi.fn();
const getAuthUserMock = vi.fn();

vi.mock("next/cache", () => ({ revalidatePath: (...args: unknown[]) => revalidatePathMock(...args) }));
vi.mock("next/navigation", () => ({
  redirect: () => {
    throw new Error("redirect");
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ from: fromMock }),
  getAuthUser: async () => getAuthUserMock(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  // Reset chain: supabase.from("training_blocks").update({...}).eq("id", X).eq("user_id", Y)
  eqMock2.mockResolvedValue({ error: null });
  eqMock1.mockReturnValue({ eq: eqMock2 as EqFn });
  updateMock.mockReturnValue({ eq: eqMock1 as EqFn });
  fromMock.mockReturnValue({ update: updateMock });
  getAuthUserMock.mockResolvedValue({ data: { user: { id: "user-123" } } });
});

async function callAction(focusMuscles: string[], id = "11111111-1111-1111-1111-111111111111") {
  const { updateBlockFocus } = await import("../actions");
  const fd = new FormData();
  fd.set("id", id);
  for (const m of focusMuscles) fd.append("focusMuscles", m);
  return updateBlockFocus(fd);
}

describe("updateBlockFocus server action", () => {
  it("persists a valid focus list and returns the canonical array", async () => {
    const result = await callAction(["biceps", "triceps"]);
    expect(result).toEqual({ ok: true, focusMuscles: ["biceps", "triceps"] });
    expect(fromMock).toHaveBeenCalledWith("training_blocks");
    expect(updateMock).toHaveBeenCalledWith({
      focus_muscles: ["biceps", "triceps"],
    });
    // RLS belt-and-braces — both eqs must run (id + user_id).
    expect(eqMock1).toHaveBeenCalledWith("id", "11111111-1111-1111-1111-111111111111");
    expect(eqMock2).toHaveBeenCalledWith("user_id", "user-123");
    expect(revalidatePathMock).toHaveBeenCalledWith("/app/plan");
    expect(revalidatePathMock).toHaveBeenCalledWith("/app");
  });

  it("accepts an empty focus list (clears focus on the block)", async () => {
    const result = await callAction([]);
    expect(result).toEqual({ ok: true, focusMuscles: [] });
    expect(updateMock).toHaveBeenCalledWith({ focus_muscles: [] });
  });

  it("rejects a non-allowlist muscle (Zod guard before DB)", async () => {
    const result = await callAction(["lower_back"]);
    expect(result.ok).toBe(false);
    // Update never reached.
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects more than 2 muscles", async () => {
    const result = await callAction(["biceps", "triceps", "quads"]);
    expect(result.ok).toBe(false);
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("de-duplicates a doubled selection", async () => {
    const result = await callAction(["biceps", "biceps"]);
    expect(result).toEqual({ ok: true, focusMuscles: ["biceps"] });
    expect(updateMock).toHaveBeenCalledWith({ focus_muscles: ["biceps"] });
  });

  it("returns an error when the user is not signed in (no redirect)", async () => {
    getAuthUserMock.mockResolvedValueOnce({ data: { user: null } });
    const result = await callAction(["biceps"]);
    expect(result.ok).toBe(false);
  });

  it("propagates Supabase write errors", async () => {
    eqMock2.mockResolvedValueOnce({ error: { message: "RLS denied" } });
    const result = await callAction(["biceps"]);
    expect(result).toEqual({ ok: false, error: "RLS denied" });
  });

  it("idempotent: same input twice yields the same result + same write payload", async () => {
    const a = await callAction(["forearms"]);
    const b = await callAction(["forearms"]);
    expect(a).toEqual(b);
    expect(updateMock).toHaveBeenCalledTimes(2);
    expect(updateMock).toHaveBeenNthCalledWith(1, { focus_muscles: ["forearms"] });
    expect(updateMock).toHaveBeenNthCalledWith(2, { focus_muscles: ["forearms"] });
  });
});
