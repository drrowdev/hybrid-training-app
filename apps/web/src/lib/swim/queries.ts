import { createHash } from "node:crypto";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  formatPoolCourse, formatSwimDistance, poolCourseKey, summarizeSwimWeek,
  swimBenchmarkTrend, parseSwimActualResult, settledFromStoredActual, type SwimSettledResult,
} from "@hta/domain";
import {
  applySwimProposal, proposeSwimAdjustment, type SwimDose, type SwimPlan,
} from "@hta/engine";
import { todayYmd, mondayOfYmd, ymdInTimezone, addDaysToYmd } from "@/lib/dates";
import { getSwimWorkout, listSwimPlans, listSwimWorkouts, type SwimPlanRow, type SwimWorkoutRow } from "./storage";
import { swimPlanDefinition, swimWorkoutDefinition, type SwimHistoryRow, type SwimWeekCandidate } from "./model";
import { workoutPresentation, SWIM_STROKE_LABEL } from "./presentation";
import { formatSwimTime } from "./time";
import type { SwimHubView, SwimWorkoutView } from "./view-types";

export function swimInputId(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);
}

export async function swimToday(client: SupabaseClient, userId: string) {
  const { data, error } = await client.from("profiles").select("timezone").eq("id", userId).maybeSingle();
  if (error) throw new Error("Could not read your swim dates.", { cause: error });
  const timezone = data?.timezone ?? "UTC";
  return { today: todayYmd(timezone), timezone };
}

export async function loadSwimHistory(client: SupabaseClient, workouts: SwimWorkoutRow[]): Promise<SwimHistoryRow[]> {
  const sessionIds = workouts.flatMap((row) => row.session_id ? [row.session_id] : []);
  if (!sessionIds.length) return workouts.map((workout) => ({
    workout, result: null, notes: null, performedAt: null, completedAt: null, deleted: false,
    sourceGone: workout.status === "completed" || workout.status === "started",
  }));
  const [{ data: sessions, error: sessionError }, { data: logs, error: logError }] = await Promise.all([
    client.from("sessions").select("id,performed_at,completed_at,deleted_at,notes").in("id", sessionIds),
    client.from("cardio_logs").select("*").in("session_id", sessionIds),
  ]);
  if (sessionError || logError) throw new Error("Could not read your swim history.", { cause: sessionError ?? logError });
  return workouts.map((workout) => {
    const session = sessions?.find((row) => row.id === workout.session_id);
    const log = logs?.find((row) => row.session_id === workout.session_id && row.swim_result !== null && row.swim_result !== undefined);
    const parsed = log ? parseSwimActualResult(log.swim_result) : null;
    if (parsed && !parsed.ok) throw new Error(`Invalid swimming history: ${parsed.error.message}`);
    const sourceGone = !session && (workout.status === "completed" || workout.status === "started");
    if (workout.status === "completed" && session && !parsed) throw new Error("The saved swim result is unavailable.");
    return {
      workout, result: parsed?.ok ? parsed.value : null,
      notes: session ? session.notes ?? null : log?.notes ?? null,
      performedAt: session?.performed_at ?? null, completedAt: session?.completed_at ?? null,
      deleted: !!session?.deleted_at, sourceGone,
    };
  });
}

export function settledSwimResult(row: SwimHistoryRow, plan: SwimPlanRow): SwimSettledResult {
  const workout = row.workout.definition.issued;
  const lifecycle = plan.state.lifecycle ?? [];
  const completedAt = row.completedAt ? Date.parse(row.completedAt) : null;
  // Completion-time status survives later resume/archive transitions.
  const completedStatus = completedAt === null ? null : lifecycle
    .filter((entry) => Date.parse(entry.recordedAt) <= completedAt).at(-1)?.to ?? lifecycle[0]?.from ?? "active";
  const stoppedAt = [...lifecycle].reverse().find((entry) => entry.to !== "active")?.recordedAt;
  const unstartedPaused = !row.workout.session_id && (plan.status === "paused" && plan.state.pauseSnapshot
    ? plan.state.pauseSnapshot.workoutIds.includes(row.workout.id)
    : plan.status !== "active" && !!stoppedAt && row.workout.scheduled_date >= stoppedAt.slice(0, 10));
  return settledFromStoredActual(row.completedAt ? row.result : null, {
    workoutId: row.workout.id, dateISO: row.workout.scheduled_date,
    plannedCourse: workout.snapshot.course,
    plannedLengths: workout.totalLengths,
    lifecycle: {
      trashed: row.deleted || row.sourceGone,
      planPaused: completedStatus === "paused" || unstartedPaused,
      archivedLate: completedStatus === "archived" || completedStatus === "finished",
    },
  });
}

export function persistedSwimPlan(plan: SwimPlanRow, workouts: SwimWorkoutRow[]): SwimPlan {
  const definition = swimPlanDefinition(plan);
  const lastDose = [...plan.state.decisions].reverse().find((entry) =>
    entry.kind === "progression" && entry.decision !== "rejected" && entry.inputSnapshot.appliedDose,
  )?.inputSnapshot.appliedDose as SwimDose | undefined;
  const weeks = new Map<number, SwimWorkoutRow[]>();
  for (const row of workouts) {
    const index = swimWorkoutDefinition(row).weekIndex;
    weeks.set(index, [...(weeks.get(index) ?? []), row]);
  }
  return {
    setup: plan.definition.setup, calibration: plan.state.acceptedCalibration,
    dose: lastDose ?? definition.initialDose, eventPrep: null,
    versions: { model: workouts[0]?.definition.issued.snapshot.versions.model ?? "swim-model-1", generator: definition.generatorVersion, assessment: plan.state.acceptedCalibration?.version ?? null },
    weeks: [...weeks].sort(([a], [b]) => a - b).map(([weekIndex, rows]) => ({
      weekIndex, startDateISO: rows[0]!.scheduled_date, provisional: rows.some((row) => swimWorkoutDefinition(row).provisional),
      slots: rows.map((row) => ({
        kind: "workout", slotId: swimWorkoutDefinition(row).slotId, dateISO: row.scheduled_date,
        source: "swim_date",
        intent: swimWorkoutDefinition(row).intent, original: row.definition.original, issued: row.definition.issued,
      })),
    })),
  };
}

export function deriveSwimWeekCandidate(plan: SwimPlanRow, history: SwimHistoryRow[], today: string): SwimWeekCandidate | null {
  if (plan.status !== "active") return null;
  const resume = [...plan.state.decisions].reverse().find((entry) => entry.kind === "schedule" && entry.decision === "accepted");
  const resumedIds = resume ? new Set(z.object({
    dates: z.array(z.object({ id: z.string().uuid() })),
  }).parse(resume.inputSnapshot.preview).dates.map((row) => row.id)) : null;
  // A resumed schedule starts a new review cohort; earlier actuals remain history.
  const reviewHistory = resumedIds ? history.filter((row) => resumedIds.has(row.workout.id)) : history;
  const enginePlan = persistedSwimPlan(plan, reviewHistory.map((row) => row.workout));
  const settledWeeks = enginePlan.weeks.filter((week) => {
    const rows = reviewHistory.filter((row) => swimWorkoutDefinition(row.workout).weekIndex === week.weekIndex);
    return rows.length > 0 && rows.every((row) => row.deleted || row.sourceGone || (row.workout.status !== "started" &&
      (row.workout.scheduled_date < today || !!row.completedAt || row.workout.status === "skipped")));
  });
  const source = settledWeeks.at(-1);
  if (!source) return null;
  const target = enginePlan.weeks.find((week) => week.weekIndex > source.weekIndex &&
    reviewHistory.some((row) => swimWorkoutDefinition(row.workout).weekIndex === week.weekIndex &&
      row.workout.status === "scheduled" && !row.workout.session_id && row.workout.scheduled_date > today));
  if (!target) return null;
  const sourceRows = reviewHistory.filter((row) => swimWorkoutDefinition(row.workout).weekIndex === source.weekIndex);
  const targetRows = reviewHistory.filter((row) => swimWorkoutDefinition(row.workout).weekIndex === target.weekIndex);
  const targetWorkoutIds = targetRows.map((row) => row.workout.id);
  const sourceFingerprint = swimInputId(sourceRows.map((row) => ({
    id: row.workout.id, revision: row.workout.revision, result: row.result, deleted: row.deleted, sourceGone: row.sourceGone,
    performedAt: row.performedAt, completedAt: row.completedAt,
  })));
  if (plan.state.decisions.some((entry) => entry.kind === "progression" && entry.inputSnapshot.sourceFingerprint === sourceFingerprint)) return null;
  // Re-review edited actuals against their week's dose, not an issued future increase.
  const sourceDecision = [...plan.state.decisions].reverse().find((entry) =>
    entry.kind === "progression" && entry.decision !== "rejected" &&
    entry.inputSnapshot.targetWeek === source.weekIndex &&
    entry.inputSnapshot.appliedDose);
  const sourceDose = sourceDecision?.inputSnapshot.appliedDose as SwimDose | undefined;
  const input = { setup: enginePlan.setup, dose: sourceDose ?? swimPlanDefinition(plan).initialDose, history: sourceRows.map((row) => settledSwimResult(row, plan)), asOfISO: today };
  const proposal = proposeSwimAdjustment(input);
  const exactInputs = {
    ...input, sourceWeek: source.weekIndex, targetWeek: target.weekIndex, sourceFingerprint,
    resumeDecisionId: resume?.id ?? null,
    sourceRows: sourceRows.map((row) => ({ workoutId: row.workout.id, revision: row.workout.revision, result: row.result, deleted: row.deleted, sourceGone: row.sourceGone, performedAt: row.performedAt, completedAt: row.completedAt, skip: swimWorkoutDefinition(row.workout).skip ?? null })),
    targets: targetRows.map((row) => ({ id: row.workout.id, revision: row.workout.revision, prescription: row.workout.definition.issued, date: row.workout.scheduled_date })),
    versions: proposal.versions,
  };
  const id = swimInputId(exactInputs);
  if (plan.state.decisions.some((entry) => entry.id === id)) return null;
  const generated = applySwimProposal(enginePlan, proposal.to, {
    asOfISO: today,
    startedSlotIds: reviewHistory.filter((row) => row.workout.session_id || row.workout.status !== "scheduled" || !targetWorkoutIds.includes(row.workout.id)).map((row) => swimWorkoutDefinition(row.workout).slotId),
  });
  if (!generated.ok) throw new Error(generated.error.message);
  return { id, proposal, sourceWeek: source.weekIndex, targetWeek: target.weekIndex, targetWorkoutIds, input, exactInputs, generated: generated.value };
}

export async function loadSwimWorkoutView(client: SupabaseClient, userId: string, workoutId: string): Promise<SwimWorkoutView | null> {
  const workout = await getSwimWorkout(client, workoutId);
  if (!workout || workout.user_id !== userId) return null;
  const plan = (await listSwimPlans(client)).find((row) => row.id === workout.plan_id && row.user_id === userId);
  if (!plan) return null;
  const row = (await loadSwimHistory(client, [workout]))[0]!;
  return {
    ...workoutPresentation(workout.definition.issued),
    id: workout.id, revision: workout.revision, sessionId: workout.session_id,
    status: workout.status, planStatus: plan.status, date: workout.scheduled_date,
    provisional: swimWorkoutDefinition(workout).provisional, deleted: row.deleted, sourceGone: row.sourceGone,
    ...(row.notes !== null ? { notes: row.notes } : {}),
    result: row.result && row.completedAt ? {
      lengths: row.result.lengths, timeMs: row.result.timeMs,
      ...(row.result.rpe !== null ? { rpe: row.result.rpe } : {}),
      ...(row.notes ? { notes: row.notes } : {}),
      ...(row.result.provenance.deviationReason ? { reason: row.result.provenance.deviationReason } : {}),
      splits: row.result.splits?.map((split) => `${split.lengths}, ${formatSwimTime(split.timeMs)}`).join("\n") ?? "",
      stroke: row.result.snapshot.strokes[0] ?? "freestyle", equipment: [...row.result.snapshot.equipment],
      strokes: [...row.result.snapshot.strokes],
      course: formatPoolCourse(row.result.snapshot.course),
    } : null,
  };
}

const reasonLabels: Record<string, string> = {
  no_settled_work: "No completed swims to assess", completed_as_prescribed: "Planned work completed",
  effort_comfortable: "Effort was comfortable", effort_high: "Effort was high", missed_sessions: "Missed swims",
  partial_completion: "Some work was unfinished", effort_not_reported: "Effort not recorded",
  recovery_context: "Recovery week", minimum_increment_exceeds_cap: "Keep the current step", already_at_minimum: "Keep the current minimum",
};

export async function loadSwimHubView(client: SupabaseClient, userId: string, plan: SwimPlanRow): Promise<SwimHubView> {
  const workouts = (await listSwimWorkouts(client, plan.id)).filter((row) => row.user_id === userId);
  const [history, { today, timezone }] = await Promise.all([loadSwimHistory(client, workouts), swimToday(client, userId)]);
  const candidate = deriveSwimWeekCandidate(plan, history, today);
  const proposals: SwimHubView["proposals"] = plan.state.decisions.filter((entry) => entry.kind === "progression" || entry.kind === "assessment").map((entry) => {
    const engineDecision = entry.inputSnapshot.engineDecision;
    const warning = engineDecision && typeof engineDecision === "object" && "warning" in engineDecision && typeof engineDecision.warning === "string"
      ? engineDecision.warning : undefined;
    return {
      id: entry.id, kind: entry.kind === "assessment" ? "benchmark" : "week", status: entry.decision,
      title: entry.kind === "assessment" ? "Assessment" : "Week recommendation",
      detail: `${entry.recordedAt.slice(0, 10)}${entry.reason ? ` · ${entry.reason}` : ""}`, changes: [], warning,
    };
  });
  if (candidate) proposals.unshift({
    id: candidate.id, kind: "week", status: "pending",
    mainRepeats: candidate.proposal.from.mainRepeats,
    excludedCount: candidate.proposal.snapshot.excludedResults.length,
    title: `${({ progress: "Progress", hold: "Hold", reduce: "Reduce" })[candidate.proposal.decision]} · Week ${candidate.targetWeek + 1}`,
    detail: candidate.proposal.reasons.map((reason) => reasonLabels[reason]).join(" · "),
    changes: candidate.generated.weeks.find((week) => week.weekIndex === candidate.targetWeek)!.slots.flatMap((slot) => {
      const prior = workouts.find((row) => swimWorkoutDefinition(row).slotId === slot.slotId);
      return prior && slot.kind === "workout" ? [{
        title: prior.scheduled_date,
        before: formatSwimDistance(prior.definition.issued.totalLengths, prior.definition.issued.snapshot.course),
        after: formatSwimDistance(slot.issued.totalLengths, slot.issued.snapshot.course),
      }] : [];
    }),
  });
  const observedHistory = history.filter((row) => row.workout.scheduled_date <= today || row.completedAt);
  const weeks = [...new Set(observedHistory.flatMap((row) => [
    mondayOfYmd(row.workout.scheduled_date),
    ...(row.performedAt && row.completedAt ? [mondayOfYmd(ymdInTimezone(new Date(row.performedAt), timezone))] : []),
  ]))].sort();
  const analytics: SwimHubView["analytics"] = { weeks: [], bests: [], benchmarks: [] };
  for (const week of weeks) {
    const inWeek = (date: string) => date >= week && date < addDaysToYmd(week, 7);
    const planned = summarizeSwimWeek({ weekStartISO: week, results: observedHistory.filter((row) => inWeek(row.workout.scheduled_date)).map((row) => ({
      ...settledSwimResult(row, plan), course: row.workout.definition.issued.snapshot.course,
    })) });
    const actual = summarizeSwimWeek({ weekStartISO: week, results: observedHistory.filter((row) => row.performedAt && row.completedAt && inWeek(ymdInTimezone(new Date(row.performedAt), timezone))).map((row) => ({
      ...settledSwimResult(row, plan), dateISO: ymdInTimezone(new Date(row.performedAt!), timezone),
    })) });
    for (const key of new Set([...planned.byCourse.map((row) => row.courseKey), ...actual.byCourse.map((row) => row.courseKey)])) {
      const p = planned.byCourse.find((row) => row.courseKey === key);
      const a = actual.byCourse.find((row) => row.courseKey === key);
      analytics.weeks.push({
        week, course: (p ?? a)!.courseLabel, planned: p?.plannedDistanceLabel ?? "—",
        actual: a?.actualDistanceLabel ?? "—", frequency: a?.actualSessions ?? 0,
        adherence: p?.adherence != null ? `${Math.round(p.adherence * 100)}%` : "—",
      });
    }
  }
  const categories = new Map(plan.state.observations.map((observation) => [
    `${poolCourseKey(observation.course)}:${observation.stroke}:${[...observation.equipment].sort().join(",")}`, observation,
  ]));
  for (const observation of categories.values()) {
    const trend = swimBenchmarkTrend(plan.state.observations, observation);
    analytics.bests.push(...trend.personalBests.map((best) => ({
      label: `${best.distance} ${observation.course.unit} · ${trend.courseLabel} · ${SWIM_STROKE_LABEL[observation.stroke]}`,
      time: formatSwimTime(best.timeMs), date: best.observedOn,
    })));
    analytics.benchmarks.push(...trend.points.map((point) => ({
      label: `${point.distance} ${observation.course.unit} · ${trend.courseLabel} · ${SWIM_STROKE_LABEL[observation.stroke]}`,
      pace: formatSwimTime(point.timeMs), date: point.observedOn,
    })));
  }
  return {
    id: plan.id, revision: plan.revision, status: plan.status, today,
    goal: plan.definition.setup.goal === "endurance" ? "Endurance" : "Technique & base",
    course: formatPoolCourse(plan.definition.setup.course), dates: `${plan.started_on} – ${plan.ends_on}`,
    ...(plan.state.acceptedCalibration ? { assessment: {
      label: plan.state.acceptedCalibration.unit === "yd" ? "200 / 400 yard estimate" : "200 / 400 field estimate",
      pace: `${formatSwimTime(Math.round(plan.state.acceptedCalibration.msPer100))} / 100 ${plan.state.acceptedCalibration.unit}`,
    } } : {}),
    workouts: workouts.map((row) => ({
      id: row.id, date: row.scheduled_date, title: workoutPresentation(row.definition.issued).title,
      total: formatSwimDistance(row.definition.issued.totalLengths, row.definition.issued.snapshot.course),
      status: history.find((entry) => entry.workout.id === row.id)?.sourceGone ? "Result removed" : history.find((entry) => entry.workout.id === row.id)?.deleted ? "In Trash" : ({ scheduled: plan.status === "active" ? "Scheduled" : "Unscheduled", started: "In progress", completed: "Completed", skipped: "Skipped" })[row.status],
      week: swimWorkoutDefinition(row).weekIndex + 1, provisional: swimWorkoutDefinition(row).provisional,
    })), proposals, analytics,
  };
}
