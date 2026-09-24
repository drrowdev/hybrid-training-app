"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { currentSwimWeekIndex, nextProgramCommitment, type BlockProgramKind, type TrainingCommitment } from "@hta/domain";
import { currentBlockWeekIndex } from "@/lib/dates";
import { programWorkoutTitle } from "@/lib/programs/presentation";
import { endBlock } from "@/lib/planner/actions";
import { NewProgramChooser, PROGRAM_TYPES, PROGRAM_LABELS, type ProgramType } from "./NewProgramChooser";
import { ProgramConfirmation, ProgramIcon } from "./ProgramDialog";
import styles from "./ProgramBuilder.module.css";

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

export function ProgramsOverview({ programs, entries, today, swimHref, templateBlockIds = [], initiallyOpen = false }: {
  programs: readonly ProgramOverviewItem[];
  entries: TrainingCommitment[] | null;
  today: string;
  swimHref: string | null;
  templateBlockIds?: readonly string[];
  initiallyOpen?: boolean;
}) {
  const router = useRouter();
  const [chooser, setChooser] = useState(initiallyOpen);
  const [type, setType] = useState<ProgramType | null>(null);
  const [ending, setEnding] = useState<ProgramOverviewItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const active = programs.filter((program) => !program.status || program.status === "active");
  if (!active.some((program) => program.kind === "swimming")) {
    const paused = programs.find((program) => program.kind === "swimming" && program.status === "paused");
    if (paused) active.push(paused);
  }
  const legacy = active.find((program) => program.kind === null);
  function select(kind: ProgramType | null) {
    if (kind === "swimming") {
      const swimming = active.find((program) => program.kind === "swimming");
      if (swimming || swimHref) router.push(swimming?.href ?? swimHref!);
      return;
    }
    if (kind === "running") { router.push("/app/program/build?activity=running"); return; }
    setType(kind); setChooser(true);
  }
  function summary(program: ProgramOverviewItem) {
    if (program.status === "paused") return "Paused";
    const next = nextProgramCommitment(entries ?? [], program.id, today, program.kind === "swimming" ? "swim" : "primary");
    const weekIndex = program.kind === "swimming" ? currentSwimWeekIndex : currentBlockWeekIndex;
    const week = program.weeks ? `Week ${weekIndex(program.startedOn, program.weeks, today) + 1} of ${program.weeks}` : "";
    const day = next && new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" }).format(new Date(`${next.date}T00:00:00Z`));
    return [week, next ? `Next: ${day}, ${programWorkoutTitle(next.title, templateBlockIds.includes(program.id))}` : ""].filter(Boolean).join(" · ");
  }
  return <div className={`${styles.builder} ${styles.overview}`}>
    <header className={styles.overviewHeader}><h1>Programs</h1>
      <button type="button" className={`${styles.button} ${styles.primary}`} onClick={() => { setType(null); setChooser(true); }}>
        <ProgramIcon kind="plus" />New program
      </button>
    </header>
    <section className={styles.programList} aria-label="Programs">
      {legacy && <div className={styles.legacyRow}>
        <Link href={legacy.href} className={styles.legacyLink}>
          <span className={styles.typeIcon}><ProgramIcon kind="program" /></span>
          <span className={styles.programMeta}><strong>{legacy.name}</strong><span className={styles.programSummary}>{summary(legacy)}</span></span>
        </Link>
        <button type="button" className={styles.endButton} onClick={() => { setError(null); setEnding(legacy); }}>End program</button>
      </div>}
      {PROGRAM_TYPES.map((kind) => {
        const program = active.find((candidate) => candidate.kind === kind);
        const locked = !!legacy && kind !== "swimming";
        const content = <>
          <span className={styles.typeIcon}><ProgramIcon kind={kind} /></span>
          <span className={styles.programMeta}>{program
            ? <><span className={styles.typeLabel}>{PROGRAM_LABELS[kind]}</span><strong>{program.name}</strong><span className={styles.programSummary}>{summary(program)}</span></>
            : <strong>{PROGRAM_LABELS[kind]}</strong>}
          </span>
          <span className={program || locked ? styles.rowChevron : styles.startLabel}>
            <>{program ? <ProgramIcon kind="chevron" /> : locked || (kind === "swimming" && !swimHref) ? <ProgramIcon kind="lock" /> : "Start"}</>
          </span>
        </>;
        return program ? <Link key={kind} href={program.href} className={styles.programRow} data-kind={kind}>{content}</Link>
          : <button key={kind} type="button" className={styles.programRow} data-kind={kind}
            aria-label={`Start ${PROGRAM_LABELS[kind].toLowerCase()} program`} disabled={locked || (kind === "swimming" && !swimHref)}
            onClick={() => select(kind)}>{content}</button>;
      })}
    </section>
    <nav className={styles.programList} aria-label="Program links">
      <Link className={styles.setupRow} href="/app/plan">Schedule<ProgramIcon kind="chevron" /></Link>
      <Link className={styles.setupRow} href="/app/plan/history">Program history<ProgramIcon kind="chevron" /></Link>
    </nav>
    {chooser && <NewProgramChooser programs={active} type={type} swimHref={swimHref} onSelect={select} onClose={() => setChooser(false)} />}
    {ending && <ProgramConfirmation name={ending.name} ending pending={pending} error={error} onCancel={() => setEnding(null)}
      onConfirm={() => startTransition(async () => {
        setError(null);
        try {
          const form = new FormData(); form.set("id", ending.id);
          await endBlock(form); setEnding(null); router.refresh();
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Couldn't end the program. Try again."); }
      })} />}
  </div>;
}
