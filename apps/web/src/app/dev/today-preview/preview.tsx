"use client";

import { AppShell } from "@/components/shell/AppShell";
import { CommandPaletteProvider } from "@/components/cmd-k/CommandPaletteProvider";
import { TodayDashboard, type TodayWorkout } from "@/components/today/TodayDashboard";
import type { PlanSessionInput } from "@/components/plan/PlanRedesign";
import { QuickWorkoutCard } from "@/components/today/QuickWorkoutCard";
import { TrainingMonth, ScheduleViewToggle } from "@/components/program/TrainingMonth";
import { ProgramSwitcher } from "@/components/program/ProgramSwitcher";
import { PageHeader } from "@/components/ui/PageHeader";

const today = "2026-09-25";
const workouts: TodayWorkout[] = [
  {
    id: "lower", date: today, title: "Lower B", program: "Upper / lower", programId: "strength",
    kind: "strength", week: 3, weeks: 8, done: false, href: "/app/sessions/start/lower", minutes: 52,
    action: "Start workout", state: "not_started",
    options: { kind: "primary", id: "lower", date: today, startedOn: "2026-09-07", weeks: 8, swapDates: [] },
    items: [
      { kind: "main", movementId: "squat", movementName: "Back squat", sets: 4, reps: 5, targetWeightKg: 90 },
      { kind: "back_off", movementId: "rdl", movementName: "Romanian deadlift", sets: 3, reps: 8, targetWeightKg: 60 },
      { kind: "accessory", movementId: "calf", movementName: "Standing calf raise", sets: 3, reps: 12 },
    ],
  },
  {
    id: "upper", date: "2026-09-26", title: "Upper A", program: "Upper / lower", programId: "strength",
    kind: "strength", week: 3, weeks: 8, done: false, href: "/app/sessions/start/upper", minutes: 45,
    action: "Start workout", state: "not_started",
    items: [{ kind: "main", movementId: "bench", movementName: "Bench press", sets: 4, reps: 6, targetWeightKg: 60 }],
  },
  {
    id: "run", date: "2026-09-26", title: "Easy run", program: "Running base", programId: "running",
    kind: "running", week: 2, weeks: 6, done: false, href: "/app/sessions/start/run", minutes: 30,
    action: "Start workout", state: "not_started",
    items: [{ kind: "cardio_z2", movementId: "run", movementName: "Easy run", durationMin: 30 }],
  },
  {
    id: "swim", date: "2026-09-27", title: "Endurance swim", program: "Swimming", programId: "swimming",
    kind: "swimming", done: false, href: "/app/swim/swim?from=today", minutes: 35,
    action: "View swim", state: "scheduled", swimSteps: [],
  },
];
const sessions: PlanSessionInput[] = workouts.filter((workout) => workout.kind !== "swimming").map((workout) => ({
  id: workout.id, weekIndex: 2, dayIndex: workout.date === today ? 4 : 5, date: workout.date,
  title: workout.title, isCardio: workout.kind === "running", isStrength: workout.kind === "strength",
  done: false, skipped: false, slot: workout.id === "run" ? "pm" : workout.id === "upper" ? "am" : "single",
  items: workout.items!, estDurationMin: workout.minutes, notes: null,
}));

function unavailable(): never { throw new Error("Actions are unavailable in this fixture."); }
const actions = {
  moveAction: unavailable, skipAction: unavailable, unskipAction: unavailable,
  updateNotesAction: async () => ({ error: "Actions are unavailable in this fixture." }),
};

export function TodayPreview({ month }: { month: boolean }) {
  const preview = { sessions, today, currentWeekIndex: 2, weeks: 8, logHrefBase: "/app/sessions/start",
    ...actions, startSessionAction: unavailable };
  return <CommandPaletteProvider indices={{ pages: [], movements: [], blocks: [], sessions: [], events: [] }}>
    <AppShell signOutAction={unavailable} displayName="Preview" email="preview@example.com" hapticsEnabled={false}>
      {month ? <div style={{ display: "grid", gap: 24 }}>
        <PageHeader title="Schedule" back={{ href: "/app/programs", label: "Programs" }} />
        <ProgramSwitcher programs={[
          { id: "strength", name: "Upper / lower", kind: "strength", href: "/app/plan?block=strength" },
          { id: "running", name: "Running base", kind: "running", href: "/app/plan?block=running" },
          { id: "swimming", name: "Swimming", kind: "swimming", href: "/app/swim?plan=swimming" },
        ]} />
        <ScheduleViewToggle month />
        <TrainingMonth today={today} workouts={workouts} preview={preview} />
      </div>
        : <TodayDashboard today={today} workouts={workouts.filter((workout) => workout.date === today)}
          weekWorkouts={workouts} hasProgram multiplePrograms prompt={null}
          quickWorkout={<QuickWorkoutCard variant="planned" recent={[]} startStrength={unavailable}
            repeatRecent={unavailable} generateStrength={unavailable} generateHyrox={unavailable} hyroxStationDefaults={[]} />}
          weekPreview={preview} />}
    </AppShell>
  </CommandPaletteProvider>;
}
