export const SWIM_WEEKDAYS = [
  { value: 1, label: "Monday" }, { value: 2, label: "Tuesday" },
  { value: 3, label: "Wednesday" }, { value: 4, label: "Thursday" },
  { value: 5, label: "Friday" }, { value: 6, label: "Saturday" },
  { value: 0, label: "Sunday" },
] as const;

export interface SwimStrengthContext {
  blockId: string | null;
  sessions: readonly { id: string; date: string }[];
}

/** Calendar dates, not program weekday ordinals, are the shared boundary. */
export function swimScheduleAdvice(
  context: SwimStrengthContext, startDate: string, weeks: number, selected: readonly number[] = [],
) {
  const start = Date.parse(`${startDate}T00:00:00Z`);
  const end = start + weeks * 7 * 86_400_000;
  const sessions = context.sessions.filter((session) => {
    const date = Date.parse(`${session.date}T00:00:00Z`);
    return date >= start && date < end;
  }).sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));
  const occupied = new Set(sessions.map((session) => new Date(`${session.date}T00:00:00Z`).getUTCDay()));
  const available = SWIM_WEEKDAYS.map((day) => day.value).filter((day) => !occupied.has(day));
  let defaults: number[] = available.slice(0, 1);
  let bestGap = -1;
  for (let a = 0; a < available.length; a++) {
    for (let b = a + 1; b < available.length; b++) {
      const gap = Math.abs(available[a]! - available[b]!);
      const spacing = Math.min(gap, 7 - gap);
      if (spacing > bestGap) {
        defaults = [available[a]!, available[b]!];
        bestGap = spacing;
      }
    }
  }
  const conflicts = SWIM_WEEKDAYS.filter((day) => occupied.has(day.value) && selected.includes(day.value));
  const confirmationKey = JSON.stringify({
    version: 1, blockId: context.blockId, sessions, startDate, weeks,
    selected: [...selected].sort((a, b) => a - b),
  });
  return {
    defaults, conflicts, occupied: SWIM_WEEKDAYS.filter((day) => occupied.has(day.value)),
    insufficientFreeDays: available.length < 2, confirmationKey,
  };
}
