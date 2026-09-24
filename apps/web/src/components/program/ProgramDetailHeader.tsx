import type { ReactNode } from "react";
import styles from "./ProgramDetailHeader.module.css";

export function ProgramDetailHeader({ title, eyebrow, subtitle, completed, total, actions, children }: {
  title: string; eyebrow: ReactNode; subtitle: ReactNode;
  completed: number; total: number; actions?: ReactNode; children?: ReactNode;
}) {
  return <header className={styles.header} data-testid="page-header">
    <div className={styles.row}>
      <div className={styles.title}>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1>{title}</h1>
        <div className={styles.subtitle}>{subtitle}</div>
      </div>
      {actions}
    </div>
    {total > 0 && <div className={styles.progressRow}>
      <div className={styles.progress} role="progressbar" aria-valuemin={0} aria-valuemax={100}
        aria-valuenow={total ? Math.round(completed / total * 100) : 0} aria-label={`${completed} of ${total} done`}>
        <span style={{ width: `${total ? completed / total * 100 : 0}%` }} />
      </div>
      <span><b>{completed}</b> of {total} done</span>
    </div>}
    {children}
  </header>;
}
