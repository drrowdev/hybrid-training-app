import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import type { PrescriptionItem } from "@hta/db";
import type { SwimWorkoutView } from "@/lib/swim/view-types";
import { addDaysToYmd, mondayOfYmd } from "@/lib/dates";
import { WorkoutOptions, type WorkoutOptionsInput } from "./WorkoutOptions";
import { SwimExercises, WorkoutExercises } from "./WorkoutExercises";
import styles from "./Today.module.css";

export type TodayWorkout = {
  id: string;
  sessionId?: string | null;
  date: string;
  title: string;
  program: string;
  programId: string | null;
  kind: "strength" | "running" | "swimming" | "hybrid" | null;
  week?: number;
  weeks?: number;
  done: boolean;
  href: string;
  minutes: number | null;
  summary?: string;
  action: "Start workout" | "Continue workout" | "Restore workout" | "View swim";
  state: string;
  note?: string;
  items?: PrescriptionItem[];
  swimSteps?: SwimWorkoutView["steps"];
  options?: WorkoutOptionsInput;
};
export type TodayWeekWorkout = Pick<TodayWorkout, "id" | "date" | "title" | "program" | "programId" | "kind" | "done" | "href">;

const colors = {
  strength: "var(--cp-accent)", running: "var(--cp-warning)",
  swimming: "var(--cp-cardio)", hybrid: "var(--cp-program-hybrid)",
};
function color(workout: Pick<TodayWorkout, "kind">): CSSProperties {
  return { "--workout-color": colors[workout.kind ?? "strength"] } as CSSProperties;
}
export function WarningIcon() {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <path d="M12 3 2 21h20L12 3Z" /><path d="M12 9v5m0 3v1" />
  </svg>;
}
function ProgramLabel({ workout }: { workout: TodayWorkout }) {
  return <div className={styles.program}>{workout.program}
    {workout.week != null && workout.weeks != null && <span> · Week {workout.week} of {workout.weeks}</span>}
  </div>;
}
function WorkoutCard({ workout, expanded, multiple, pinned }: {
  workout: TodayWorkout; expanded: boolean; multiple: boolean; pinned: boolean;
}) {
  const contents = <>
    <div><ProgramLabel workout={workout} /><h2 className={styles.title}>{workout.title}</h2>
      <div className={styles.meta}>{workout.done ? workout.summary : workout.minutes != null ? `~${workout.minutes} min` : null}</div>
    </div>
    <div className={styles.right}>{(multiple || workout.done) && <span className={`${styles.status} ${workout.done ? styles.done : ""}`}>
      {workout.done ? <><span aria-hidden="true">✓ </span>Done</> : "To do"}
    </span>}
      {workout.done ? <span aria-hidden="true">›</span> : workout.options && <WorkoutOptions title={workout.title} input={workout.options} />}
    </div>
  </>;
  if (workout.done) return <Link href={workout.href} className={`${styles.card} ${styles.compact}`} style={color(workout)}
    data-testid={`today-card-${workout.id}`} data-state="done" aria-label={`View logged ${workout.title}`}>
    <div className={styles.head}>{contents}</div>
  </Link>;
  return <section className={styles.card} style={color(workout)} data-testid={`today-card-${workout.id}`}
    data-state={workout.state} aria-label={workout.title}>
    {expanded ? <div className={styles.head}>{contents}</div> : <div className={styles.head}>
      <Link href={workout.href} className={styles.compact}><ProgramLabel workout={workout} />
        <h2 className={styles.title}>{workout.title}</h2>
        {workout.minutes != null && <div className={styles.meta}>~{workout.minutes} min</div>}
      </Link>
      <div className={styles.right}><span className={styles.status}>To do</span>
        {workout.options && <WorkoutOptions title={workout.title} input={workout.options} />}
      </div>
    </div>}
    {workout.note && <p className={styles.note} role="note"><WarningIcon /><span>{workout.note}</span></p>}
    {expanded && <>
      {workout.items && <WorkoutExercises items={workout.items} />}
      {workout.swimSteps && <SwimExercises steps={workout.swimSteps} />}
      <div className={`${styles.actions} ${pinned ? styles.pinned : ""}`}>
        <Link href={workout.href} className="cp-btn primary" data-testid="today-cta" data-session-state={workout.state}>{workout.action}</Link>
      </div>
    </>}
  </section>;
}

export function TodayWeek({ today, workouts, multiplePrograms }: { today: string; workouts: TodayWeekWorkout[]; multiplePrograms: boolean }) {
  const monday = mondayOfYmd(today);
  return <section className={styles.week} data-testid="today-week-strip" aria-label="This week">
    <div className={styles.weekHeader}><h2>This week</h2><Link href="/app/plan">Schedule</Link></div>
    <ol className={styles.days}>{Array.from({ length: 7 }, (_, index) => {
      const date = addDaysToYmd(monday, index);
      const entries = workouts.filter((workout) => workout.date === date);
      return <li className={styles.day} key={date} aria-current={date === today ? "date" : undefined}>
        <Link className={styles.dayLink} href={entries.length === 1 ? entries[0]!.href : "/app/plan"}>
        <div><strong>{date === today ? "Today" : new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(date))}</strong>
          <time dateTime={date}>{new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(date))}</time></div>
        <div className={styles.dayWorkouts}>{entries.length ? entries.map((workout) =>
          <span className={styles.dayWorkout} key={workout.id} style={color(workout)}>
            {multiplePrograms && <><span aria-hidden="true" className={styles.dot} /><span className={styles.sr}>{workout.kind ?? "Training"}: </span></>}
            <span>{workout.title}</span>
            {workout.done && <span className={styles.done}><span aria-hidden="true">✓</span><span className={styles.sr}>Completed</span></span>}
          </span>) : <span className={styles.rest}>Rest</span>}</div>
        </Link>
      </li>;
    })}</ol>
  </section>;
}

export function TodayDashboard({ today, workouts, weekWorkouts, hasProgram, multiplePrograms, prompt, promptPlacement, quickWorkout, next }: {
  today: string; workouts: TodayWorkout[]; weekWorkouts: TodayWeekWorkout[];
  hasProgram: boolean; multiplePrograms: boolean; prompt: ReactNode;
  promptPlacement?: "before-workouts" | "after-workouts";
  quickWorkout: ReactNode; next?: TodayWorkout;
}) {
  const ordered = [...workouts].sort((a, b) => Number(a.done) - Number(b.done));
  const first = ordered.find((workout) => !workout.done);
  const pinned = first && first.kind !== "swimming" && (first.action === "Start workout" || first.action === "Continue workout") ? first : null;
  const promptNode = prompt ? <div className={`${styles.prompt} ${promptPlacement === "before-workouts" ? styles.safety : ""}`}
    data-testid="today-prompt">{prompt}</div> : null;
  return <div className={styles.page}>
    <header><div className={styles.date} data-testid="today-eyebrow">
      {new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })
        .format(new Date(`${today}T00:00:00Z`)).replace(",", "")}
    </div><h1>Today</h1></header>
    <div className={styles.grid}><div className={styles.main}>
      {promptPlacement === "before-workouts" && promptNode}
      <div className={styles.workouts} data-testid={ordered.length && ordered.every((workout) => workout.done) ? "today-logged" : "today-workouts"}>
        {ordered.map((workout) => <WorkoutCard key={workout.id} workout={workout} expanded={workout.id === first?.id}
          multiple={ordered.length > 1} pinned={workout.id === pinned?.id} />)}
        {ordered.length === 0 && <section className={`${styles.card} ${styles.restCard}`} data-testid={hasProgram ? "today-rest" : "today-empty"}>
          <h2>{hasProgram ? "Rest day" : "No program yet"}</h2>
          {!hasProgram ? <><p>Pick a program to fill your week.</p><Link href="/app/programs" className="cp-btn primary">Choose a program</Link></>
            : next && <Link className={styles.next} href={next.href} data-testid="rest-tomorrow"><span>
              Next: {new Intl.DateTimeFormat("en-GB", { weekday: "long", timeZone: "UTC" }).format(new Date(next.date))} · {next.title}
              <small>{next.program}</small></span><span aria-hidden="true">›</span>
            </Link>}
        </section>}
      </div>
      {promptPlacement === "after-workouts" && promptNode}
      {quickWorkout}
    </div>{hasProgram && <TodayWeek today={today} workouts={weekWorkouts} multiplePrograms={multiplePrograms} />}</div>
    {pinned && <div className={styles.dock}><Link href={pinned.href} className="cp-btn primary"
      data-testid="today-mobile-cta" data-session-state={pinned.state}>{pinned.action}</Link></div>}
  </div>;
}
