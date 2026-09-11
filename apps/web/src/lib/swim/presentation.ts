import { formatPoolCourse, formatSwimDistance, swimRepeatGroups, swimItemGuidance, type SwimWorkout, type SwimStroke, type SwimEquipment } from "@hta/domain";
import { swimPlanWeekLengths, type SwimPlan } from "@hta/engine";
import type { SwimPlanPreview, SwimWorkoutView } from "./view-types";
import { formatSwimTime } from "./time";

export const SWIM_STROKE_LABEL: Record<SwimStroke, string> = {
  freestyle: "Freestyle", backstroke: "Backstroke", breaststroke: "Breaststroke",
  butterfly: "Butterfly", individual_medley: "Individual medley", choice: "Your choice", kick: "Kick",
};
export const SWIM_EQUIPMENT_LABEL: Record<SwimEquipment, string> = {
  kickboard: "Kickboard", pull_buoy: "Pull buoy", fins: "Fins", paddles: "Paddles", snorkel: "Snorkel",
};

export function workoutPresentation(workout: SwimWorkout): Pick<SwimWorkoutView, "title" | "course" | "total" | "budgetMinutes" | "stroke" | "strokes" | "steps" | "equipment" | "pool" | "calibrationLabel"> {
  const effort = { easy: "Easy", steady: "Steady", brisk: "Brisk", threshold: "Threshold", sprint: "Sprint" };
  const steps: SwimWorkoutView["steps"] = swimRepeatGroups(workout).map((group) => {
    const item = group.item;
    const guidance = swimItemGuidance(workout, item);
    return {
      id: group.id,
      repeatIds: group.repeatIds,
      section: `${group.section}${group.rounds > 1 ? ` · Round ${group.round}/${group.rounds}` : ""}`,
      title: `${item.repeats > 1 ? `${item.repeats} × ` : ""}${formatSwimDistance(item.lengths, workout.snapshot.course)}`,
      detail: [
        SWIM_STROKE_LABEL[item.stroke], ...item.equipment.map((piece) => SWIM_EQUIPMENT_LABEL[piece]),
        guidance.drillLabel,
        item.note, item.optional ? "Optional" : null,
      ].filter(Boolean).join(" · "),
      effort: effort[item.effort],
      guidance: `${guidance.instruction} ${guidance.effort} ${guidance.focus}`,
      rest: item.sendoffMs !== undefined ? `Leave every ${formatSwimTime(item.sendoffMs)}`
        : item.restSeconds ? `Rest ${item.restSeconds} sec` : "No rest",
      ...(workout.snapshot.calibration && item.targetMsPerRepeat !== undefined ? { pace: `Target ${formatSwimTime(Math.round(item.targetMsPerRepeat))}` } : {}),
    };
  });
  return {
    title: ({ technique_base: "Technique & base", endurance: "Endurance swim", event_specific: "Event preparation" })[workout.focus],
    course: formatPoolCourse(workout.snapshot.course),
    total: formatSwimDistance(workout.totalLengths, workout.snapshot.course),
    budgetMinutes: workout.budget.minutes,
    ...(workout.snapshot.calibration ? { calibrationLabel: workout.snapshot.calibration.unit === "yd" ? "200 / 400 yard estimate" : "200 / 400 field estimate" } : {}),
    stroke: workout.snapshot.strokes[0] ?? "freestyle",
    strokes: [...workout.snapshot.strokes],
    equipment: [...workout.snapshot.equipment],
    pool: workout.snapshot.course,
    steps,
  };
}

export function planPreviewPresentation(plan: SwimPlan): SwimPlanPreview {
  const weeks = plan.weeks.map((week) => ({
    week: week.weekIndex + 1,
    startDate: week.startDateISO,
    provisional: week.provisional,
    total: formatSwimDistance(swimPlanWeekLengths(week), plan.setup.course),
    workouts: week.slots.map((slot) => {
      if (slot.kind !== "workout") throw new Error("Cannot preview an unresolved swim plan.");
      const { title, total, budgetMinutes, calibrationLabel, steps } = workoutPresentation(slot.issued);
      return { slotId: slot.slotId, date: slot.dateISO, title, total, budgetMinutes, calibrationLabel, steps };
    }),
  }));
  return {
    course: formatPoolCourse(plan.setup.course),
    workoutCount: weeks.reduce((count, week) => count + week.workouts.length, 0),
    weeks,
  };
}
