"use client";

import { useRef, useState, useTransition } from "react";
import { previewSwimWeekEdit } from "@/lib/swim/actions";
import type { SwimHubView, SwimWeekEditPreview } from "@/lib/swim/view-types";
import { PlanPreview } from "./PlanPreview";
import styles from "./Swim.module.css";

export function WeekEditor({ plan, busy, onApply }: {
  plan: SwimHubView;
  busy: boolean;
  onApply: (preview: SwimWeekEditPreview) => void;
}) {
  const weeks = plan.editableWeeks ?? [];
  const [week, setWeek] = useState(weeks[0]?.week ?? 1);
  const [repeats, setRepeats] = useState(weeks[0]?.mainRepeats ?? 1);
  const [preview, setPreview] = useState<SwimWeekEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);

  if (!weeks.length) return null;
  return (
    <section className={styles.section}>
      <h2>Adjust a week</h2>
      <form className={styles.form} method="post"
        onChange={() => { request.current++; setPreview(null); setError(null); }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const sequence = ++request.current;
          setPreview(null); setError(null);
          startTransition(async () => {
            try {
              const result = await previewSwimWeekEdit({
                planId: plan.id, revision: plan.revision, week, mainRepeats: repeats,
                reason: String(form.get("reason") ?? ""),
              });
              if (sequence !== request.current) return;
              if (result.error) setError(result.error);
              else if (result.preview) setPreview(result.preview);
            } catch {
              if (sequence === request.current) setError("Could not preview this week. Try again.");
            }
          });
        }}>
        <fieldset className={styles.formFields} disabled={busy}>
          <div className={styles.columns}>
            <label className={styles.field}>Week
              <select name="week" value={week} onChange={(event) => {
                const selected = Number(event.target.value);
                setWeek(selected);
                const option = weeks.find((entry) => entry.week === selected);
                if (option) setRepeats(option.mainRepeats);
              }}>
                {weeks.map((entry) => <option key={entry.week} value={entry.week}>
                  Week {entry.week}
                </option>)}
              </select>
            </label>
            <label className={styles.field}>Main repeats per swim
              <input name="repeats" type="number" min="1" max="2000" step="1" required value={repeats}
                onChange={(event) => setRepeats(Number(event.target.value))} />
            </label>
          </div>
          <label className={styles.field}>Adjustment reason<textarea name="reason" maxLength={1000} required /></label>
          <button className={styles.secondary} disabled={busy || pending}>{pending ? "Preparing…" : "Preview changes"}</button>
        </fieldset>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {preview && <>
        {preview.warning && <p role="status" className={styles.warning}>{preview.warning}</p>}
        {preview.excludedCount > 0 && <p className={styles.muted}>
          {preview.excludedCount} {preview.excludedCount === 1 ? "swim" : "swims"} excluded
        </p>}
        <ul className={styles.list}>{preview.changes.map((change, index) => <li key={index} className={styles.row}>
          <span>{change.date}</span><span>{change.before} → {change.after}</span>
        </li>)}</ul>
        <PlanPreview plan={preview.plan} title="Adjusted week" />
        <button type="button" className={styles.button} disabled={busy || pending} onClick={() => onApply(preview)}>Apply changes</button>
      </>}
    </section>
  );
}
