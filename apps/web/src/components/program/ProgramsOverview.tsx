import Link from "next/link";
import { PROGRAM_KIND_LABELS, type BlockProgramKind, type TrainingCommitment } from "@hta/domain";
import { TrainingWeek } from "./TrainingWeek";
import styles from "./ProgramBuilder.module.css";

const ACTIVITIES = [
  { id: "strength" },
  { id: "running" },
  { id: "hybrid" },
] as const;

export type ProgramOverviewItem = {
  id: string;
  kind: BlockProgramKind | null;
  name: string;
  startedOn: string;
  weeks: number;
  editable: boolean;
};

export function ProgramsOverview({ programs, activity, entries, today, swimHref, hasSwimPlans }: {
  programs: readonly ProgramOverviewItem[];
  activity?: string;
  entries: TrainingCommitment[] | null;
  today: string;
  swimHref: string | null;
  hasSwimPlans: boolean;
}) {
  const focused = ACTIVITIES.find((candidate) => candidate.id === activity);
  const visible = focused ? programs.filter((program) => program.kind === focused.id) : programs;
  const visibleIds = new Set(visible.map((program) => program.id));
  const schedule = focused ? entries?.filter((entry) => entry.source === "primary" && entry.programId !== null && visibleIds.has(entry.programId)) : entries;
  return <div className={styles.builder}>
    <header className={styles.header}><h1>{focused ? PROGRAM_KIND_LABELS[focused.id] : "Programs"}</h1>
      <div className={styles.actions}><Link className={styles.button} href="/app/plan/history">Program history</Link><Link className={`${styles.button} ${styles.primary}`} href={`/app/program/build${focused ? `?activity=${focused.id}` : ""}`}>New program</Link></div></header>
    <nav className={styles.actions} aria-label="Activities">
      <Link className={styles.button} href="/app/programs" aria-current={!focused ? "page" : undefined}>All programs</Link>
      {ACTIVITIES.map((candidate) => <Link key={candidate.id} className={styles.button} href={`/app/programs?activity=${candidate.id}`} aria-current={focused?.id === candidate.id ? "page" : undefined}>{PROGRAM_KIND_LABELS[candidate.id]}</Link>)}
      {swimHref && <Link className={styles.button} href={swimHref}>Swimming</Link>}
    </nav>
    {(visible.length > 0 || (!focused && hasSwimPlans && swimHref)) && <section className={styles.cards} aria-label="Programs">
      {visible.map((program) => <section key={program.id} className={styles.card}>
        {(!program.kind || program.name.trim().toLowerCase() !== PROGRAM_KIND_LABELS[program.kind].toLowerCase()) &&
          <span className={styles.eyebrow}>{program.kind ? PROGRAM_KIND_LABELS[program.kind] : "Older program"}</span>}
        <h2>{program.name}</h2>
        <span className={styles.muted}>{program.startedOn} · {program.weeks} {program.weeks === 1 ? "week" : "weeks"}</span>
        <div className={styles.actions}><Link className={styles.button} href={`/app/plan?block=${program.id}`}>Open program</Link>
          {program.editable && <Link className={styles.button} href={`/app/program/build?edit=${program.id}`}>Edit program</Link>}</div>
      </section>)}
      {!focused && hasSwimPlans && swimHref && <Link className={styles.card} href={swimHref}><h2>Swimming</h2><span>Open swimming programs</span></Link>}
    </section>}
    {(!focused || visible.length === 0) && <section className={styles.cards}>
      {ACTIVITIES.filter((candidate) => (!focused || candidate.id === focused.id) && !programs.some((program) => program.kind === candidate.id)).map((candidate) => <Link key={candidate.id} className={styles.card} href={`/app/program/build?activity=${candidate.id}`}>
        <strong>{PROGRAM_KIND_LABELS[candidate.id]}</strong><span>Build a program</span>
      </Link>)}
      {(!focused || focused.id !== "running") && <Link className={styles.card} href="/app/program"><strong>Program templates</strong></Link>}
      {!focused && !hasSwimPlans && swimHref && <Link className={styles.card} href={swimHref}><strong>Swimming</strong><span className={styles.muted}>Set up swimming</span></Link>}
    </section>}
    {schedule && <TrainingWeek entries={schedule} today={today}
      authoredBlockIds={visible.filter((program) => program.editable).map((program) => program.id)}
      programLabels={Object.fromEntries(visible.map((program) => [program.id, program.name]))} />}
    <nav className={styles.actions} aria-label="Training tools">
      <Link className={styles.button} href="/app/stats">Stats</Link><Link className={styles.button} href="/app/sessions">History</Link>
      <Link className={styles.button} href="/app/settings/rehab-protocols">Rehab protocols</Link><Link className={styles.button} href="/app/recovery/injuries">Limitations</Link>
      {focused?.id === "strength" && <Link className={styles.button} href="/app/settings/training-maxes">Training maxes</Link>}
    </nav>
  </div>;
}
