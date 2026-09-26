import { createClient, getAuthUser } from "@/lib/supabase/server";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { archetypeDisplayName, getActiveBlocks, getActivePlannedDays } from "@/lib/planner/queries";
import { ThisWeekRail, type ThisWeekRailProps } from "@/components/plan/ThisWeekRail";
import { TrainingWeek } from "./TrainingWeek";
import { loadStandaloneSwimStates } from "@/lib/swim/standalone-state";
import { loadScheduleSessionLinks } from "@/lib/schedule/session-links";
import { hasTemplateWorkoutTitles } from "@/lib/programs/presentation";
import { loadTodaySwims, loadTodayWeek, plannedTodayWorkout, plannedWeekSession } from "@/lib/today/workouts";
import { TrainingMonth } from "./TrainingMonth";
import { movePlannedSession, skipPlannedSession, unskipPlannedSession, startSessionFromPlan } from "@/lib/planner/actions";
import { updatePlannedSessionNotes, markExternalCardioComplete } from "@/lib/sessions/actions";

export async function SharedTrainingMonth({ today }: { today: string }) {
  const client = await createClient();
  const { data: { user } } = await getAuthUser();
  if (!user) throw new Error("Sign in to view the schedule.");
  const [blocks, planned, swims] = await Promise.all([
    getActiveBlocks(), getActivePlannedDays(), loadTodaySwims(client, user.id, today),
  ]);
  const workouts = await loadTodayWeek(client, blocks, [
    ...planned.filter((session) => !session.skippedAt && session.role !== "rest")
      .map((session) => plannedTodayWorkout(session, blocks, planned)),
    ...swims.workouts,
  ]);
  return <TrainingMonth today={today} workouts={workouts} preview={{
    sessions: planned.filter((session) => session.role !== "rest").map((session) => plannedWeekSession(session, blocks)),
    today, currentWeekIndex: -1, weeks: Math.max(1, ...blocks.map((block) => block.weeks)),
    logHrefBase: "/app/sessions/start", moveAction: movePlannedSession, skipAction: skipPlannedSession,
    unskipAction: unskipPlannedSession, updateNotesAction: updatePlannedSessionNotes,
    startSessionAction: startSessionFromPlan, markCardioDoneAction: markExternalCardioComplete,
  }} />;
}

export async function SharedTrainingWeek({ today, primaryWeek }: {
  today: string;
  primaryWeek?: ThisWeekRailProps;
}) {
  const client = await createClient();
  const [snapshot, active] = await Promise.all([loadAvailableTrainingSchedule(client), getActiveBlocks()]);
  if (!snapshot && !primaryWeek) return null;
  const sessionLinks = await loadScheduleSessionLinks(client, snapshot?.entries ?? []);
  const swimIds = snapshot?.entries.filter((entry) => entry.source === "swim").map((entry) => entry.id) ?? [];
  const { data: { user } } = swimIds.length ? await getAuthUser() : { data: { user: null } };
  if (swimIds.length && !user) throw new Error("Sign in to view the swim schedule.");
  const swimStatuses = user ? Object.fromEntries([...(await loadStandaloneSwimStates(client, user.id, swimIds))]
    .map(([id, state]) => [id, state.status])) : {};
  const week = <>
    {snapshot && <TrainingWeek entries={snapshot.entries} today={today}
      sessionLinks={sessionLinks} templateBlockIds={active.filter(hasTemplateWorkoutTitles).map((block) => block.id)}
      authoredBlockIds={active.filter((block) => block.programId === "authored").map((block) => block.id)}
      programLabels={Object.fromEntries(active.map((block) => [block.id, archetypeDisplayName(block.archetype, block.notes)]))}
      swimStatuses={swimStatuses}
      primaryPreviewIds={primaryWeek?.sessions.map((session) => session.id)} />}
    {primaryWeek && <ThisWeekRail {...primaryWeek} showRail={!snapshot} />}
  </>;
  return primaryWeek ? <div data-testid="today-week-strip">{week}</div> : week;
}
