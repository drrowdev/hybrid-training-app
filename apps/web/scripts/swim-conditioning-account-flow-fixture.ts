import { z } from "zod";

export function conditioningFixtureSchedule(today: string) {
  z.string().date().parse(today);
  const todayDay = (new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7;
  // Two weekly swims need a later, still-future rest day for the same-week edit.
  // Late-week fixtures use one swim; no course spills beyond the primary block.
  const swimDays = todayDay <= 3 ? [todayDay, todayDay + 2] : [todayDay];
  const remaining = Array.from({ length: 7 }, (_, day) => day).filter((day) => !swimDays.includes(day));
  const strengthDays = remaining.slice(0, 3);
  const restDays = remaining.slice(3);
  const editFrom = swimDays.at(-1)!;
  const editTo = swimDays.length === 2 ? restDays.find((day) => day > todayDay) : restDays[0];
  if (editTo === undefined) throw new Error("fixture_schedule");
  return { today, todayDay, swimDays, strengthDays, editFrom, editTo, workoutCount: swimDays.length * 6 };
}
