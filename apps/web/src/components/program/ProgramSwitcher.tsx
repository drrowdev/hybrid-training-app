import Link from "next/link";
import styles from "./ProgramBuilder.module.css";
import { ProgramTabs } from "./ProgramTabs";
import { formatProgramDate } from "@/lib/programs/presentation";

export type ProgramChoice = {
  id: string; name: string; href: string; startedOn?: string;
  kind?: "strength" | "running" | "swimming" | "hybrid" | null;
  status?: "active" | "paused" | "finished" | "archived";
};

export function ProgramSwitcher({ programs, selectedId }: {
  programs: readonly ProgramChoice[];
  selectedId?: string;
}) {
  const selected = programs.find((program) => program.id === selectedId);
  const sameKind = selected ? programs.filter((program) => program.kind === selected.kind) : [];
  return <div className={styles.switcher}>
    <ProgramTabs label="Programs">
      <Link href="/app/programs" className={styles.tab}>All programs</Link>
      {(["strength", "running", "swimming", "hybrid"] as const).map((kind) => {
        const program = selected?.kind === kind ? selected :
          programs.find((program) => program.kind === kind && (!program.status || program.status === "active")) ??
          programs.find((program) => program.kind === kind);
        return <Link key={kind} className={styles.tab}
          href={program?.href ?? `/app/programs?activity=${kind}`}
          aria-current={selected?.kind === kind ? "page" : undefined}>
          {{ strength: "Strength", running: "Running", swimming: "Swimming", hybrid: "Hybrid" }[kind]}
        </Link>;
      })}
    </ProgramTabs>
    {sameKind.length > 1 && <details className={styles.programHistory}>
      <summary>Choose program</summary>
      <nav aria-label="Program history">
        {sameKind.map((program) => <Link key={program.id} href={program.href}
          aria-current={program.id === selectedId ? "page" : undefined}>
          {program.name}{program.startedOn && ` · ${formatProgramDate(program.startedOn)}`}
          {program.status && ` · ${{ active: "Active", paused: "Paused", finished: "Finished", archived: "Archived" }[program.status]}`}
        </Link>)}
      </nav>
    </details>}
  </div>;
}
