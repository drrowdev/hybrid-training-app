/**
 * Unit test for `runSwapMove` — the helper extracted from
 * `SessionDrawer.handleSwap` so the drawer can surface a failed swap
 * to the user instead of swallowing it and closing.
 *
 * The actual SessionDrawer interactive behaviour lives in the
 * Playwright spec (the unit-test vitest environment is "node" — no
 * jsdom, no react-testing-library). This test pins the contract that
 * the helper:
 *
 *   - returns { ok: true } on success
 *   - returns { ok: false, error } on throw, so the drawer can stay
 *     open and render the message
 *   - logs the error to console.error for debugging
 *   - never re-throws (so the drawer's submit handler never crashes)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { runSwapMove } from "../PlanRedesign";

describe("runSwapMove", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("returns { ok: true } when the action resolves", async () => {
    const moveAction = vi.fn().mockResolvedValue(undefined);
    const fd = new FormData();
    fd.set("id", "abc");
    const result = await runSwapMove(moveAction, fd);
    expect(result).toEqual({ ok: true });
    expect(moveAction).toHaveBeenCalledWith(fd);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("returns { ok: false, error } when the action throws — drawer stays open", async () => {
    const moveAction = vi
      .fn()
      .mockRejectedValue(new Error("Failed to move planned session: 23505"));
    const result = await runSwapMove(moveAction, new FormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Failed to move planned session: 23505");
    }
    // Logged for debugging.
    expect(errorSpy).toHaveBeenCalled();
  });

  it("uses a friendly fallback message for non-Error throws", async () => {
    const moveAction = vi.fn().mockRejectedValue("string thrown");
    const result = await runSwapMove(moveAction, new FormData());
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/try again/i);
    }
  });

  it("never re-throws (the form's onSubmit must not crash)", async () => {
    const moveAction = vi.fn().mockRejectedValue(new Error("boom"));
    // If runSwapMove re-threw, this `await` would reject and fail the test.
    await expect(runSwapMove(moveAction, new FormData())).resolves.toMatchObject({
      ok: false,
    });
  });
});
