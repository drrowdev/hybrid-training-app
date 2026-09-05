import { describe, expect, it, vi } from "vitest";
import { persistSwimDraft, readSwimDraft, swimDraftKey } from "../draft";

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
});
