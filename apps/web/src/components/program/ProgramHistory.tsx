import type { ReactNode } from "react";
import { BackLink } from "@/components/ui/BackLink";
import { formatProgramDate } from "@/lib/programs/presentation";
import styles from "./ProgramBuilder.module.css";

export function ProgramHistory({ children }: { children: ReactNode }) {
  return <div className={`${styles.builder} ${styles.overview}`}>
    <BackLink href="/app/programs" label="Programs" />
    <header className={styles.overviewHeader}><h1>Program history</h1></header>
    {children}
  </div>;
}

export function ProgramHistorySummary({ name, startedOn, endedOn, status, actions }: {
  name: string; startedOn: string; endedOn?: string | null; status: ReactNode; actions?: ReactNode;
}) {
  return <>
    <span className={styles.programMeta}>
      <strong>{name}</strong>
      <span className={styles.programSummary}>{formatProgramDate(startedOn)}{endedOn ? ` · ${formatProgramDate(endedOn.slice(0, 10))}` : ""}</span>
    </span>
    <span className={styles.historyStatus}>{status}</span>
    {actions}
  </>;
}
