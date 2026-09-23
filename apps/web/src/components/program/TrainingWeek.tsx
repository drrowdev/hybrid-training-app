import Link from "next/link";
import type { TrainingCommitment, StandaloneSwimTrainingStatus } from "@hta/domain";
import { addDaysToYmd, mondayOfYmd } from "@/lib/dates";
import { SWIM_TRAINING_LABEL } from "@/lib/swim/activity-presentation";
import { swimWorkoutHref } from "@/lib/swim/return-context";
import styles from "./ProgramBuilder.module.css";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TrainingWeek({ entries, today, heading = "This week", authoredBlockId, primaryPreviewIds = [], swimStatuses = {} }: {
  entries: TrainingCommitment[]; today: string; heading?: string; authoredBlockId?: string;
  primaryPreviewIds?: readonly string[];
  swimStatuses?: Readonly<Record<string, StandaloneSwimTrainingStatus>>;
}) {
  const monday = mondayOfYmd(today);
  const previewIds = new Set(primaryPreviewIds);
  return <section className={styles.panel} aria-label={heading}>
    <div className={styles.row}><h2>{heading}</h2><Link className={styles.button} href="/app/plan">Full schedule</Link></div>
    <div className={styles.week}>{DAYS.map((day, index) => {
      const date = addDaysToYmd(monday, index);
      const workouts = entries.filter((entry) => entry.date === date && entry.state !== "rest");
      const rest = entries.some((entry) => entry.date === date && entry.state === "rest");
      return <div key={date} className={styles.day}>
        <div><strong>{day}</strong><time className={styles.muted} dateTime={date}>{date.slice(8)}</time></div>
        <div className={styles.week}>{workouts.length === 0 ? <span className={styles.muted}>{rest ? "Planned rest" : "No workout scheduled"}</span>
          : workouts.map((entry) => {
            const preview = entry.source === "primary" && entry.state === "scheduled" && previewIds.has(entry.id);
            // Native hash navigation reaches the existing drawer's hashchange listener.
            const WorkoutLink = preview ? "a" : Link;
            const href = preview ? `#session=${entry.id}` : entry.source === "swim" ? swimWorkoutHref(entry.id, "today")
              : entry.source === "session" ? `/app/sessions/${entry.id}` : `/app/sessions/start/${entry.id}`;
            const swimStatus = entry.source === "swim" ? swimStatuses[entry.id] : undefined;
            return <div key={`${entry.source}:${entry.id}`}><WorkoutLink className={styles.row}
              style={{ textDecoration: "none", color: "var(--cp-text)", padding: "8px 0" }} href={href}>
              <strong>{entry.title}</strong><span className={styles.muted}>{swimStatus ? SWIM_TRAINING_LABEL[swimStatus] : entry.state === "started" ? "Resume" : entry.state === "completed" ? "Completed" : entry.state === "paused" ? "Paused" : preview ? "Preview" : entry.source === "swim" ? "Scheduled" : "Start workout"}</span>
            </WorkoutLink>{authoredBlockId && entry.source === "primary" && entry.programId === authoredBlockId && entry.state === "scheduled" && entry.date >= today &&
              <Link className={styles.button} aria-label={`Edit ${entry.title}`} href={`/app/program/build?edit=${authoredBlockId}&workout=${entry.id}`}>Edit workout</Link>}</div>;
          })}</div>
      </div>;
    })}</div>
  </section>;
}
