import type { SupabaseClient } from "@supabase/supabase-js";
import { formatSwimDistance, swimCourseWorkoutTitle } from "@hta/domain";
import { getSwimNavigation } from "@/lib/swim/navigation";
import { listSwimPlans, listSwimWorkouts } from "@/lib/swim/storage";
import { loadSwimHistory, workoutTrainingState } from "@/lib/swim/queries";
import { loadStandaloneSwimStates } from "@/lib/swim/standalone-state";
import { swimPlanDefinition, swimWorkoutDateRange, swimWorkoutDefinition } from "@/lib/swim/model";
import { workoutPresentation } from "@/lib/swim/presentation";
import { swimRecordingHref, swimWorkoutHref } from "@/lib/swim/return-context";
import { formatSwimTime } from "@/lib/swim/time";
import { importColumns, importSchema } from "@/lib/swim/import-storage";
import { formatImportedSwimDistance } from "@/lib/swim/import-presentation";
import { archetypeDisplayName, type ActiveBlock, type PlannedDay } from "@/lib/planner/queries";
import { hasTemplateWorkoutTitles, programWorkoutTitle } from "@/lib/programs/presentation";
import { plannedSessionCta } from "./planned-session-cta";
import { estimateSessionDurationBreakdown } from "@/lib/sessions/estimate-duration";
import { summariseSessionSets } from "@/lib/sessions/queries";
import { displayWeight, weightUnitLabel } from "@/lib/stats/units";
import type { TodayWorkout, TodayWeekWorkout } from "@/components/today/TodayDashboard";
import { loadAvailableTrainingSchedule } from "@/lib/schedule/storage";
import { loadScheduleSessionLinks } from "@/lib/schedule/session-links";
import type { PlanSessionInput } from "@/components/plan/PlanRedesign";

export function plannedWeekSession(planned: PlannedDay, blocks: ActiveBlock[]): PlanSessionInput {
  const workout = plannedTodayWorkout(planned, blocks, []);
  const items = planned.prescription.items;
  const isRehab = planned.role === "rehab";
  return {
    id: planned.id, weekIndex: planned.weekIndex, dayIndex: planned.dayIndex, date: planned.date,
    title: workout.title, slot: planned.slot, items, estDurationMin: workout.minutes,
    isCardio: items.length > 0 && items.every((item) => (item.kind ?? "").startsWith("cardio_")),
    isStrength: !isRehab && items.some((item) => !(item.kind ?? "").startsWith("cardio_")),
    isRehab, done: workout.done, inProgress: !!planned.completedSessionId && !planned.completedAt,
    skipped: !!planned.skippedAt, notes: planned.notes, completedSessionId: planned.completedSessionId,
  };
}

export async function loadTodayWeek(client: SupabaseClient, blocks: ActiveBlock[], fallback: TodayWorkout[]): Promise<TodayWeekWorkout[]> {
  const snapshot = await loadAvailableTrainingSchedule(client);
  if (!snapshot) return fallback;
  const links = await loadScheduleSessionLinks(client, snapshot.entries);
  return snapshot.entries.filter((entry) => entry.state !== "rest" && entry.state !== "paused").flatMap((entry): TodayWeekWorkout[] => {
    const existing = fallback.find((workout) => workout.id === entry.id);
    if (entry.source === "swim") return existing ? [{ ...existing }] : [];
    const block = blocks.find((candidate) => candidate.id === entry.programId);
    return [{
      id: entry.id, date: entry.date,
      title: programWorkoutTitle(entry.title, block ? hasTemplateWorkoutTitles(block) : false),
      program: existing?.program ?? (block ? archetypeDisplayName(block.archetype, block.notes) : "Quick workout"),
      programId: entry.programId, kind: block?.programKind ?? null, done: entry.state === "completed",
      href: entry.source === "session" ? `/app/sessions/${entry.id}` : links[entry.id]
        ? `/app/sessions/${links[entry.id]}` : existing?.href ?? `/app/sessions/start/${entry.id}`,
    }];
  });
}

export function plannedTodayWorkout(planned: PlannedDay, blocks: ActiveBlock[], allDays: PlannedDay[]): TodayWorkout {
  const block = blocks.find((candidate) => candidate.id === planned.blockId);
  const cta = plannedSessionCta({
    plannedId: planned.id, completedAt: planned.completedAt,
    completedSessionId: planned.completedSessionId, deletedCompletedSessionId: planned.deletedCompletedSessionId,
  });
  return {
    id: planned.id, sessionId: planned.completedSessionId, date: planned.date,
    title: programWorkoutTitle(planned.title, block ? hasTemplateWorkoutTitles(block) : false),
    program: block ? archetypeDisplayName(block.archetype, block.notes) : "Training program",
    programId: planned.blockId, kind: block?.programKind ?? null,
    week: planned.weekIndex + 1, weeks: block?.weeks,
    done: !!planned.completedAt, href: cta.href, state: cta.state,
    minutes: estimateSessionDurationBreakdown(planned.prescription.items).displayMinutes,
    action: cta.state === "deleted_completed" ? "Restore workout" : cta.state === "in_progress" ? "Continue workout" : "Start workout",
    items: planned.prescription.items,
    options: block && cta.state === "not_started" ? {
      kind: "primary", id: planned.id, startedOn: block.startedOn, weeks: block.weeks, date: planned.date,
      swapDates: allDays.filter((candidate) => candidate.blockId === planned.blockId && candidate.slot === planned.slot &&
        candidate.id !== planned.id && candidate.date >= planned.date && !candidate.completedSessionId &&
        !candidate.skippedAt && candidate.role !== "rest").map((candidate) => ({ date: candidate.date, title: candidate.title })),
    } : undefined,
  };
}

export async function loadTodaySessionSummaries(client: SupabaseClient, ids: string[], imperial: boolean) {
  const summaries = new Map<string, string>();
  if (!ids.length) return summaries;
  const [sessions, sets] = await Promise.all([
    client.from("sessions").select("id,performed_at,completed_at,duration_min").in("id", ids).is("deleted_at", null),
    client.from("set_logs").select("session_id,set_kind,weight_kg,reps,duration_sec,distance_m,skipped").in("session_id", ids),
  ]);
  if (sessions.error || sets.error) throw new Error("Couldn't load today's workout summaries.", { cause: sessions.error ?? sets.error });
  for (const session of sessions.data ?? []) {
    const summary = summariseSessionSets((sets.data ?? []).filter((set) => set.session_id === session.id), session, 0);
    const units = imperial ? "imperial" : "metric";
    summaries.set(session.id, [
      summary.durationMin != null ? `${summary.durationMin} min` : null,
      summary.totalTonnageKg > 0 ? `${Math.round(displayWeight(summary.totalTonnageKg, units)).toLocaleString("en-GB")} ${weightUnitLabel(units)} total` : null,
    ].filter(Boolean).join(" · "));
  }
  return summaries;
}

export async function loadTodaySwims(client: SupabaseClient, userId: string, today: string): Promise<{
  hasProgram: boolean; activeCount: number; workouts: TodayWorkout[];
}> {
  const navigation = await getSwimNavigation(client, userId);
  if (!navigation.hasPlans) return { hasProgram: false, activeCount: 0, workouts: [] };
  const [plans, rows] = await Promise.all([listSwimPlans(client), listSwimWorkouts(client)]);
  const visiblePlans = plans.filter((plan) => plan.user_id === userId);
  const selected = rows.filter((row) => row.user_id === userId && visiblePlans.some((plan) => plan.id === row.plan_id));
  const [history, states] = await Promise.all([
    loadSwimHistory(client, selected), loadStandaloneSwimStates(client, userId, selected.map((row) => row.id)),
  ]);
  const workouts: TodayWorkout[] = [];
  for (const row of history) {
    const workout = row.workout;
    const plan = visiblePlans.find((candidate) => candidate.id === workout.plan_id)!;
    const state = workoutTrainingState(plan, row, states);
    if (["skipped", "paused", "archived", "unavailable"].includes(state.status) || row.deleted || row.sourceGone) continue;
    const definition = swimWorkoutDefinition(workout);
    const presentation = workoutPresentation(definition.issued);
    const done = state.status === "completed";
    const claim = states.get(workout.id)?.claim;
    const date = done && claim ? claim.recordedDate : workout.scheduled_date;
    let summary = row.result && done ? `${formatSwimDistance(row.result.lengths, row.result.snapshot.course)} · ${formatSwimTime(row.result.timeMs)}` : undefined;
    if (done && claim && date === today) {
      const recording = await client.from("swim_imports").select(importColumns).eq("user_id", userId).eq("id", claim.importId).single();
      const parsed = importSchema.safeParse(recording.data);
      if (recording.error || !parsed.success) throw new Error("Couldn't load the recorded swim.");
      summary = `${formatImportedSwimDistance(parsed.data.evidence.distanceMetres)} · ${formatSwimTime(parsed.data.evidence.recordedDurationMs)} · imported`;
    }
    workouts.push({
      id: workout.id, sessionId: workout.session_id, date,
      title: definition.courseSource ? swimCourseWorkoutTitle(definition.courseSource.title, definition.slotId) : presentation.title,
      program: plan.definition.privateCourse?.title ?? (plan.definition.setup.goal === "endurance" ? "Swim endurance" : "Swim technique"),
      programId: plan.id, kind: "swimming", week: definition.weekIndex + 1, weeks: swimPlanDefinition(plan).schedule.weeks,
      done, href: done && claim ? swimRecordingHref(claim.importId, "today", workout.id)
        : done && workout.session_id ? `/app/sessions/${workout.session_id}` : swimWorkoutHref(workout.id, "today"),
      minutes: presentation.budgetMinutes, action: "View swim", state: state.status, summary,
      note: state.status === "needs_review" ? "Review the recorded swim." : state.status === "stopped_early" ? "Swim stopped early." : undefined,
      swimSteps: presentation.steps,
      options: plan.status === "active" && state.status === "scheduled" ? {
        kind: "swim", id: workout.id, revision: workout.revision, planId: plan.id, planRevision: plan.revision,
        date: workout.scheduled_date, canMove: workout.scheduled_date > today,
        ...swimWorkoutDateRange(plan, selected.filter((candidate) => candidate.plan_id === plan.id), workout, today),
      } : undefined,
    });
  }
  return { hasProgram: visiblePlans.some((plan) => plan.status === "active" || plan.status === "paused"),
    activeCount: visiblePlans.filter((plan) => plan.status === "active").length, workouts };
}
