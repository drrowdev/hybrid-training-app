"use client";

import styles from "./WizardProgress.module.css";

export function WizardProgress({
  labels, current, first, furthest, onSelect,
}: {
  labels: readonly string[];
  current: number;
  first: number;
  furthest: number;
  onSelect(step: number): void;
}) {
  return (
    <nav aria-label="Plan setup steps" className={styles.progress}>
      {labels.map((label, index) => {
        const available = index >= first && index <= furthest && index !== current;
        const className = `${styles.step}${index === current ? ` ${styles.current}` : index < current ? ` ${styles.done}` : ""}`;
        return available ? (
          <button key={label} type="button" className={className} onClick={() => onSelect(index)}>
            <span aria-hidden="true" className={styles.bar} />
            {label}
          </button>
        ) : (
          <span key={label} className={className} aria-current={index === current ? "step" : undefined}>
            <span aria-hidden="true" className={styles.bar} />
            {label}
          </span>
        );
      })}
    </nav>
  );
}
