const TODAY_PROMPT_ORDER = [
  "race-recovery",
  "race-check-in",
  "taper",
  "active-limitation",
  "training-max",
  "season",
  "next-program",
  "program-recommendation",
  "bodyweight-only",
] as const;

export type TodayPromptKind = (typeof TODAY_PROMPT_ORDER)[number];

/** Safety advice precedes optional decisions; unselected prompts remain pending. */
export function selectTodayPrompt(
  available: Partial<Record<TodayPromptKind, boolean>>,
): { kind: TodayPromptKind; placement: "before-workouts" | "after-workouts" } | null {
  const index = TODAY_PROMPT_ORDER.findIndex((kind) => available[kind]);
  if (index < 0) return null;
  return {
    kind: TODAY_PROMPT_ORDER[index]!,
    placement: index < 4 ? "before-workouts" : "after-workouts",
  };
}
