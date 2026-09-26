"use client";

import Link from "next/link";
import { MonthAlternate } from "@/components/plan/PlanRedesign";
import { ThisWeekRail, type ThisWeekRailProps } from "@/components/plan/ThisWeekRail";
import type { TodayWeekWorkout } from "@/components/today/TodayDashboard";
import styles from "./TrainingMonth.module.css";

export function ScheduleViewToggle({ month }: { month: boolean }) {
  return <nav className={styles.toggle} aria-label="Schedule view">
    <Link href="/app/plan" aria-current={!month ? "page" : undefined}>Week</Link>
    <Link href="/app/plan?view=month" aria-current={month ? "page" : undefined}>Month</Link>
  </nav>;
}

export function TrainingMonth({ today, workouts, preview }: {
  today: string; workouts: TodayWeekWorkout[]; preview: ThisWeekRailProps;
}) {
  const previews = new Set(preview.sessions.map((session) => session.id));
  const byId = new Map(workouts.map((workout) => [workout.id, workout]));
  return <div className={styles.month}>
    <MonthAlternate today={today} sessions={workouts.map((workout) => ({
      id: workout.id, date: workout.date, title: workout.title, done: workout.done,
      skipped: false, isCardio: workout.kind === "running" || workout.kind === "swimming",
    }))} onOpen={(id) => { window.location.hash = `#session=${id}`; }}
      renderWorkout={(session) => {
        const workout = byId.get(session.id)!;
        const href = previews.has(workout.id) ? `#session=${workout.id}` : workout.href;
        const day = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(workout.date));
        return <a key={workout.id} href={href} className={styles.workout} data-kind={workout.kind ?? "strength"}
          aria-label={`Open ${workout.title}, ${day}${workout.done ? ", completed" : ""}`}
          title={`${workout.title} · ${workout.program}`}>
          <span>{workout.title}</span>{workout.done && <span aria-hidden="true">✓</span>}
        </a>;
      }} />
    <ThisWeekRail {...preview} showRail={false} />
  </div>;
}
