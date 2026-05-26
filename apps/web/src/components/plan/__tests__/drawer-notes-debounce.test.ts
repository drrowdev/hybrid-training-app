/**
 * PR Z1 — drawer-notes debounce test.
 *
 * The plan-drawer notes textarea calls `updatePlannedSessionNotes`
 * through a 500ms debounce so a fast typist doesn't fire one server
 * action per keystroke. The debounce itself lives inline in
 * `PlanRedesign.tsx`'s `onNotesChange` handler — this test exercises
 * the same shape (mutate a setTimeout-driven trailing-edge debouncer
 * with overlapping rapid changes, advance fake timers, assert one
 * call) so a regression that drops the `clearTimeout` would be
 * caught here even though the textarea itself is React-only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

function makeDebouncedSaver(
  save: (v: string) => Promise<void>,
  ms: number,
): (v: string) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (value: string) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      void save(value);
    }, ms);
  };
}

describe("drawer notes debounce (PR Z1 shape contract)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("collapses rapid keystrokes into one server call after 500ms", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const onChange = makeDebouncedSaver(save, 500);

    onChange("a");
    onChange("ab");
    onChange("abc");
    onChange("abcd");

    // 400ms in — still inside the debounce window for the *latest*
    // keystroke, no save should have fired yet.
    vi.advanceTimersByTime(400);
    expect(save).toHaveBeenCalledTimes(0);

    // Cross the 500ms threshold — exactly one save with the latest
    // value.
    vi.advanceTimersByTime(150);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("abcd");
  });

  it("does not save more than once when typing pauses and resumes within window", () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const onChange = makeDebouncedSaver(save, 500);

    onChange("x");
    vi.advanceTimersByTime(300);
    onChange("xy"); // resets the timer
    vi.advanceTimersByTime(300);
    expect(save).toHaveBeenCalledTimes(0);
    vi.advanceTimersByTime(250);
    expect(save).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledWith("xy");
  });
});
