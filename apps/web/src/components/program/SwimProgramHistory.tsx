import Link from "next/link";
import type { ProgramOverviewItem } from "./ProgramsOverview";
import { ProgramHistorySummary } from "./ProgramHistory";
import styles from "./ProgramBuilder.module.css";

export function SwimProgramHistory({ programs }: { programs: readonly ProgramOverviewItem[] }) {
  const history = programs.filter((program) => program.kind === "swimming" && program.status && program.status !== "active");
  if (!history.length) return null;
  return <section className={styles.swimHistory} aria-label="Swimming">
    <h2>Swimming</h2>
    <ul className={styles.historyList}>{history.map((program) => <li key={program.id}>
      <Link href={program.href} className={styles.historyRow}>
        <ProgramHistorySummary name={program.name} startedOn={program.startedOn} endedOn={program.endsOn}
          status={program.status === "paused" ? "Paused" : program.status === "finished" ? "Finished" : "Archived"} />
      </Link>
    </li>)}</ul>
  </section>;
}
