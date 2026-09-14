import type { SwimItem, SwimWorkout } from "./swimming";

export type SwimRepeatGroup = {
  id: string;
  section: string;
  round: number;
  rounds: number;
  item: SwimItem;
  repeatIds: string[];
};

export function swimRepeatGroups(workout: SwimWorkout): SwimRepeatGroup[] {
  const groups: SwimRepeatGroup[] = [];
  workout.sections.forEach((section, sectionIndex) => {
    for (let round = 0; round < section.rounds; round += 1) {
      section.items.forEach((item, itemIndex) => {
        groups.push({
          id: `${sectionIndex}:${round}:${itemIndex}`,
          section: section.label,
          round: round + 1,
          rounds: section.rounds,
          item,
          // Preserve the identities already used by saved poolside progress.
          repeatIds: Array.from({ length: item.repeats }, (_, repeat) => `${sectionIndex}:${round}:${itemIndex}:${repeat}`),
        });
      });
    }
  });
  return groups;
}

export function swimRepeatProgress(repeatIds: readonly string[], checked: readonly string[]) {
  const ids = new Set(repeatIds);
  const completedIds = new Set(checked.filter((id) => ids.has(id)));
  return {
    completed: completedIds.size,
    total: ids.size,
    nextId: repeatIds.find((id) => !completedIds.has(id)) ?? null,
    undoId: [...checked].reverse().find((id) => ids.has(id)) ?? null,
  };
}
