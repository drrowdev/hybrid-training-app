/**
 * DataRail — composes the right-rail cards on the Today page.
 *
 * Order: Week dots → Training maxes → Goals (stub). On narrow screens
 * the parent grid collapses the rail below the main column, so this
 * component itself stays layout-agnostic.
 */

import type { TmRow } from "@/lib/training-maxes/queries";
import { WeekDotsCard, type WeekDayCell } from "./WeekDotsCard";
import { TrainingMaxesCard } from "./TrainingMaxesCard";
import { GoalsCard } from "./GoalsCard";

export function DataRail({
  weekDays,
  doneCount,
  tmRows,
}: {
  weekDays: WeekDayCell[];
  doneCount: number;
  tmRows: TmRow[];
}) {
  return (
    <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
      <WeekDotsCard days={weekDays} doneCount={doneCount} />
      <TrainingMaxesCard rows={tmRows} />
      <GoalsCard />
    </aside>
  );
}
