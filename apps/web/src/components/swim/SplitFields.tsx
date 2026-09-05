"use client";

import { MAX_POOL_LENGTHS } from "@hta/domain";
import { swimSplitDraftRows, swimSplitDraftText, type SwimSplitDraft } from "@/lib/swim/draft";
import styles from "./Swim.module.css";

export function SplitFields({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const rows = swimSplitDraftRows(value);
  function update(index: number, field: keyof SwimSplitDraft, next: string) {
    onChange(swimSplitDraftText(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [field]: next } : row)));
  }
  return (
    <fieldset className={styles.formFields}>
      <legend className={styles.muted}>Split times (optional)</legend>
      {rows.map((row, index) => (
        <div key={index} className={styles.splitRow}>
          <label className={styles.field}>Lengths
            <input aria-label={`Split ${index + 1} lengths`} type="number" min="1" max={MAX_POOL_LENGTHS} step="1" required
              value={row.lengths} onChange={(event) => update(index, "lengths", event.target.value)} />
          </label>
          <label className={styles.field}>Time
            <input aria-label={`Split ${index + 1} time`} placeholder="2:10.000" required
              value={row.time} onChange={(event) => update(index, "time", event.target.value)} />
          </label>
          <button type="button" className={styles.secondary} aria-label={`Remove split ${index + 1}`}
            onClick={() => onChange(swimSplitDraftText(rows.filter((_, rowIndex) => rowIndex !== index)))}>Remove</button>
        </div>
      ))}
      <button type="button" className={styles.secondary}
        onClick={() => onChange(swimSplitDraftText([...rows, { lengths: "", time: "" }]))}>Add split</button>
    </fieldset>
  );
}
