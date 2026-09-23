import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { getActiveBlock } from "@/lib/planner/queries";
import { ThisWeekRail, type ThisWeekRailProps } from "@/components/plan/ThisWeekRail";
import { TrainingWeek } from "./TrainingWeek";
import { loadStandaloneSwimStates } from "@/lib/swim/standalone-state";

export async function SharedTrainingWeek({ today, primaryWeek }: {
  today: string;
  primaryWeek?: ThisWeekRailProps;
}) {
  const client = await createClient();
  const [snapshot, active] = await Promise.all([loadAvailableTrainingSchedule(client), getActiveBlock()]);
  if (!snapshot && !primaryWeek) return null;
  const swimIds = snapshot?.entries.filter((entry) => entry.source === "swim").map((entry) => entry.id) ?? [];
  const { data: { user } } = swimIds.length ? await getAuthUser() : { data: { user: null } };
  if (swimIds.length && !user) throw new Error("Sign in to view the swim schedule.");
  const swimStatuses = user ? Object.fromEntries([...(await loadStandaloneSwimStates(client, user.id, swimIds))]
    .map(([id, state]) => [id, state.status])) : {};
  const week = <>
    {snapshot && <TrainingWeek entries={snapshot.entries} today={today}
      authoredBlockId={active?.programId === "authored" ? active.id : undefined}
      swimStatuses={swimStatuses}
      primaryPreviewIds={primaryWeek?.sessions.map((session) => session.id)} />}
    {primaryWeek && <ThisWeekRail {...primaryWeek} showRail={!snapshot} />}
  </>;
  return primaryWeek ? <div data-testid="today-week-strip">{week}</div> : week;
}
