"use client";

import { AppShell } from "@/components/shell/AppShell";
import { CommandPaletteProvider } from "@/components/cmd-k/CommandPaletteProvider";
import { TodayDashboard, type TodayWorkout, type TodayWeekWorkout } from "@/components/today/TodayDashboard";
import type { PlanSessionInput } from "@/components/plan/PlanRedesign";

const today = "2026-09-26";
const conditioning: TodayWorkout = {
  id: "conditioning", date: today, title: "Conditioning", program: "Rehab strength", programId: "program",
  kind: "strength", week: 5, weeks: 6, done: false, href: "#session=conditioning",
  minutes: 30, action: "Start workout", state: "not_started",
  items: [{ kind: "cardio_z2", movementId: "bike", movementName: "Bike", durationMin: 30 }],
};
const finished: TodayWorkout = {
  ...conditioning, id: "strength", sessionId: "logged", title: "Day 2 · B", done: true,
  href: "/app/sessions/logged", scheduledDate: "2026-09-25", state: "completed",
  summary: "36 min · 2,110 kg total", items: undefined,
};
const session: PlanSessionInput = {
  id: conditioning.id, weekIndex: 4, dayIndex: 5, date: today, title: conditioning.title,
  isCardio: true, isStrength: false, done: false, skipped: false, slot: "single",
  items: conditioning.items!, estDurationMin: 30, notes: null,
};
const unavailable = async () => ({ error: "This is a preview." });
function noNavigation(): never { throw new Error("This is a preview."); }

/** Synthetic reproduction of the reported state; never reads or writes a database. */
export function WorkoutHistoryPreview({ before }: { before: boolean }) {
  const logged = before ? { ...finished, program: "Quick workout", programId: null, week: undefined, weeks: undefined } : finished;
  const trace: TodayWeekWorkout = {
    ...finished, id: "strength:scheduled", date: "2026-09-25", done: false, completedOn: today,
  };
  return <CommandPaletteProvider indices={{ pages: [], movements: [], blocks: [], sessions: [], events: [] }}>
    <AppShell signOutAction={noNavigation} displayName="Preview" email="preview@example.com" hapticsEnabled={false}>
      <TodayDashboard today={today} workouts={[conditioning, logged]}
        weekWorkouts={[conditioning, finished, ...(before ? [] : [trace])]} hasProgram multiplePrograms={false}
        prompt={null} quickWorkout={null}
        weekPreview={{
          sessions: [session], today, currentWeekIndex: 4, weeks: 6, logHrefBase: "/app/sessions/start",
          moveAction: unavailable, skipAction: unavailable, unskipAction: unavailable,
          updateNotesAction: unavailable, startSessionAction: noNavigation, markCardioDoneAction: unavailable,
          previewMoveAction: async () => ({ error: before
            ? "An error occurred in the Server Components render. The specific message is omitted in production builds to avoid leaking sensitive details. A digest property is included on this error instance."
            : "That day already has a finished workout. Pick another day." }),
        }} />
    </AppShell>
  </CommandPaletteProvider>;
}
