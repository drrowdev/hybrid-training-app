import Link from "next/link";
import { PROGRAM_KIND_LABELS, type BlockProgramKind, type TrainingCommitment } from "@hta/domain";
import { formatProgramDate } from "@/lib/programs/presentation";
import { TrainingWeek } from "./TrainingWeek";
import { ProgramTabs } from "./ProgramTabs";
import styles from "./ProgramBuilder.module.css";

const ACTIVITIES = ["strength", "running", "swimming", "hybrid"] as const;
const LABELS = { ...PROGRAM_KIND_LABELS, swimming: "Swimming" };

export type ProgramOverviewItem = {
  id: string;
  kind: BlockProgramKind | "swimming" | null;
  name: string;
  startedOn: string;
  weeks?: number;
  endsOn?: string;
  editable: boolean;
  href: string;
  status?: "active" | "paused" | "finished" | "archived";
};

export function ProgramsOverview({ programs, activity, entries, today, swimHref, sessionLinks = {}, templateBlockIds = [] }: {
  programs: readonly ProgramOverviewItem[];
  activity?: string;
  entries: TrainingCommitment[] | null;
  today: string;
  swimHref: string | null;
  sessionLinks?: Readonly<Record<string, string>>;
  templateBlockIds?: readonly string[];
}) {
  const focused = ACTIVITIES.find((candidate) => candidate === activity);
  const visible = focused ? programs.filter((program) => program.kind === focused) : programs;
  const visibleIds = new Set(visible.map((program) => program.id));
  const schedule = focused ? entries?.filter((entry) => entry.programId !== null && visibleIds.has(entry.programId)) : entries;
  const buildHref = (kind: typeof ACTIVITIES[number]) => kind === "swimming" ? swimHref : `/app/program/build?activity=${kind}`;
  function programCard(program: ProgramOverviewItem) {
    return <section key={program.id} className={`${styles.card} ${styles.programCard}`}>
      {program.kind && <span className={styles.eyebrow}>{LABELS[program.kind]}</span>}
      <h2>{program.name}</h2>
      <span className={styles.muted}>{program.startedOn > today ? "Starts" : "Started"} {formatProgramDate(program.startedOn)}
        {program.weeks != null ? ` · ${program.weeks} ${program.weeks === 1 ? "week" : "weeks"}` : program.endsOn ? ` · Ends ${formatProgramDate(program.endsOn)}` : ""}
        {program.status && program.status !== "active" && ` · ${{ paused: "Paused", finished: "Finished", archived: "Archived" }[program.status]}`}
      </span>
      <div className={styles.cardActions}>
        <Link className={styles.button} href={program.href}>Open program</Link>
      </div>
    </section>;
  }
  const primaryIds = new Set(ACTIVITIES.flatMap((kind) => {
    const program = visible.find((candidate) => candidate.kind === kind && (!candidate.status || candidate.status === "active"));
    return program ? [program.id] : [];
  }));
  return <div className={styles.builder}>
    <header className={styles.header}><h1>Programs</h1>
      <div className={styles.headerActions}>
        <Link className={`${styles.textLink} ${styles.desktopHistory}`} href="/app/plan/history">Program history</Link>
        <Link className={`${styles.button} ${styles.primary}`} href={focused ? buildHref(focused) ?? "/app/swim" : "/app/program/build"}>New program</Link>
      </div>
    </header>
    <ProgramTabs label="Activities">
      <Link className={styles.tab} href="/app/programs" aria-current={!focused ? "page" : undefined}>All programs</Link>
      {ACTIVITIES.map((kind) => <Link key={kind} className={styles.tab} href={`/app/programs?activity=${kind}`}
        aria-current={focused === kind ? "page" : undefined}>{LABELS[kind]}</Link>)}
    </ProgramTabs>
    <Link className={`${styles.textLink} ${styles.mobileHistory}`} href="/app/plan/history">Program history</Link>
    <section className={`${styles.programGrid} ${focused ? styles.focusedGrid : ""}`} aria-label="Programs">
      {ACTIVITIES.filter((kind) => !focused || kind === focused).map((kind) => {
        const program = visible.find((candidate) => candidate.kind === kind && primaryIds.has(candidate.id));
        if (program) return programCard(program);
        const href = buildHref(kind);
        return <section key={kind} className={`${styles.card} ${styles.programCard}`}>
          <h2>{LABELS[kind]}</h2>
          <div className={styles.cardActions}>
            {href ? <Link className={styles.button} href={href}>Build a program</Link> : <span className={styles.muted}>Swimming isn&apos;t available right now.</span>}
          </div>
        </section>;
      })}
      {visible.filter((program) => !primaryIds.has(program.id)).map(programCard)}
    </section>
    {!!schedule?.length && <TrainingWeek entries={schedule} today={today} sessionLinks={sessionLinks} templateBlockIds={templateBlockIds}
      showWorkoutEditing={false}
      programLabels={Object.fromEntries(visible.map((program) => [program.id, program.name]))} />}
  </div>;
}
