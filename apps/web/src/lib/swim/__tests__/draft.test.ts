import { describe, expect, it, vi } from "vitest";
import { initialSwimDraft, persistSwimDraft, readSwimDraft, swimDraftKey, swimSplitDraftRows, swimSplitDraftText } from "../draft";
import { workoutPresentation } from "../presentation";
import { swimFixture } from "./fixtures";
import type { SwimWorkoutView } from "../view-types";

describe("ADR0079 poolside progress survives reload", () => {
  it("preserves tapped rounds, exact actual entry and the uncertain completion receipt", () => {
    const draft = { checked: ["main:2"], lengths: "17", time: "18:23.456", rpe: "6", notes: "Easy", reason: "", splits: "", queuedId: "receipt" };
    expect(readSwimDraft(JSON.stringify(draft))).toEqual(draft);
  });
  it("isolates users and workouts", () => {
    expect(swimDraftKey("one", "swim")).not.toBe(swimDraftKey("two", "swim"));
    expect(swimDraftKey("one", "swim")).not.toBe(swimDraftKey("one", "other"));
  });
  it("retains a confirmed receipt for a later offline cached-page reload", () => {
    const draft = { checked: [], lengths: "12", time: "12:30", rpe: "", notes: "", reason: "", splits: "", acceptedId: "confirmed-receipt" };
    expect(readSwimDraft(JSON.stringify(draft))?.acceptedId).toBe("confirmed-receipt");
  });
  it.each(["queuedId", "acceptedId"] as const)("keeps %s and unfinished actuals until a server result arrives", (receipt) => {
    const key = swimDraftKey("user", "workout");
    const draft = { checked: ["main:2"], lengths: "17", time: "18:23.456", rpe: "6", notes: "Easy", reason: "", splits: "", [receipt]: "receipt" };
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    persistSwimDraft(storage, key, draft, false);
    expect(storage.setItem).toHaveBeenCalledWith(key, JSON.stringify(draft));
    expect(storage.removeItem).not.toHaveBeenCalled();
    persistSwimDraft(storage, key, draft, true);
    expect(storage.removeItem).toHaveBeenCalledWith(key);
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });
  it("never rewrites completed actuals or subsequent result edits to local storage", () => {
    const key = swimDraftKey("user", "workout");
    const draft = { checked: [], lengths: "12", time: "12:30", rpe: "4", notes: "Private notes", reason: "", splits: "", acceptedId: "receipt" };
    const storage = { setItem: vi.fn(), removeItem: vi.fn() };
    persistSwimDraft(storage, key, draft, true);
    persistSwimDraft(storage, key, { ...draft, notes: "Edited notes", lengths: "14", rpe: "5" }, true);
    expect(storage.removeItem).toHaveBeenCalledTimes(2);
    expect(storage.removeItem).toHaveBeenCalledWith(key);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
  it.each([null, "{", "[]", '{"checked":[123]}'])("ignores malformed local drafts", (value) => {
    expect(readSwimDraft(value)).toBeNull();
  });
  it("round-trips incomplete split rows without dropping typed values", () => {
    const rows = [{ lengths: "4", time: "2:10.123" }, { lengths: "", time: "1:" }];
    expect(swimSplitDraftRows(swimSplitDraftText(rows))).toEqual(rows);
    expect(swimSplitDraftRows("4, 2:10\n")).toEqual([{ lengths: "4", time: "2:10" }]);
    expect(swimSplitDraftRows(swimSplitDraftText([{ lengths: "", time: "" }]))).toEqual([{ lengths: "", time: "" }]);
  });
  it("does not silently discard malformed legacy split content", () => {
    expect(swimSplitDraftRows("4, 2:10, extra")).toEqual([{ lengths: "4", time: "2:10, extra" }]);
  });
  it("initializes and resets result edits from the actual course, equipment and fractional effort", () => {
    const workout: SwimWorkoutView = {
      ...workoutPresentation(swimFixture().workouts[0]!.definition.issued),
      id: "workout", revision: 3, sessionId: "session", status: "completed", planStatus: "active",
      date: "2026-09-07", provisional: false, deleted: false,
      result: {
        lengths: 12, timeMs: 123_456, rpe: 7.5, notes: "Saved",
        reason: "Changed pool", stroke: "backstroke", equipment: ["fins"],
        pool: { numerator: 100, denominator: 3, unit: "m" },
      },
    };
    expect(initialSwimDraft(workout)).toMatchObject({
      lengths: "12", time: "2:03.456", rpe: "7.5", notes: "Saved",
      reason: "Changed pool", equipment: ["fins"], poolLength: "100/3", poolUnit: "m",
    });
    const edited = { ...initialSwimDraft(workout), notes: "Unsaved", poolLength: "50" };
    expect(edited).not.toEqual(initialSwimDraft(workout));
    expect(initialSwimDraft(workout).notes).toBe("Saved");
  });
});
