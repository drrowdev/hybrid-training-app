import { describe, expect, it } from "vitest";
import { selectTodayPrompt, type TodayPromptKind } from "./today-prompt";

describe("Today prompt priority (DC-K4, DC-V1)", () => {
  const kinds: TodayPromptKind[] = [
    "race-recovery", "race-check-in", "taper", "active-limitation",
    "training-max", "season", "next-program", "program-recommendation",
    "bodyweight-only",
  ];
  it("returns no prompt when nothing is eligible", () => {
    expect(selectTodayPrompt({})).toBeNull();
  });
  it.each(kinds)("keeps %s eligible without deleting lower-priority prompts", (kind) => {
    const available = Object.fromEntries(kinds.map((candidate) => [candidate, true]));
    for (const preceding of kinds.slice(0, kinds.indexOf(kind))) available[preceding] = false;
    const before = { ...available };
    expect(selectTodayPrompt(available)).toEqual({
      kind, placement: kinds.indexOf(kind) < 4 ? "before-workouts" : "after-workouts",
    });
    expect(available).toEqual(before);
  });
});
