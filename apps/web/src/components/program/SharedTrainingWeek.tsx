import { createClient } from "@/lib/supabase/server";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { getActiveBlock } from "@/lib/planner/queries";
import { ThisWeekRail, type ThisWeekRailProps } from "@/components/plan/ThisWeekRail";
import { TrainingWeek } from "./TrainingWeek";

export async function SharedTrainingWeek({ today, primaryWeek }: {
  today: string;
  primaryWeek?: ThisWeekRailProps;
}) {
  const client = await createClient();
  const [snapshot, active] = await Promise.all([loadAvailableTrainingSchedule(client), getActiveBlock()]);
  if (!snapshot && !primaryWeek) return null;
  const week = <>
    {snapshot && <TrainingWeek entries={snapshot.entries} today={today}
      authoredBlockId={active?.programId === "authored" ? active.id : undefined}
      primaryPreviewIds={primaryWeek?.sessions.map((session) => session.id)} />}
    {primaryWeek && <ThisWeekRail {...primaryWeek} showRail={!snapshot} />}
  </>;
  return primaryWeek ? <div data-testid="today-week-strip">{week}</div> : week;
}
