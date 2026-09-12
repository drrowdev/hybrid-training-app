"use client";

import { useRef, useState, useTransition } from "react";
import { previewSwimDateEdit } from "@/lib/swim/actions";
import type { SwimDateEditPreview, SwimHubView } from "@/lib/swim/view-types";
import styles from "./Swim.module.css";

export function DateEditor({ plan, workout, busy, onApply }: {
  plan: SwimHubView;
  workout: SwimHubView["workouts"][number];
  busy: boolean;
  onApply: (preview: SwimDateEditPreview) => void;
}) {
  const [preview, setPreview] = useState<SwimDateEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  const range = workout.reschedule;
  if (!range || plan.status !== "active") return null;
  return (
    <details className={styles.dateEditor}>
      <summary>Move swim</summary>
      <form className={styles.form} method="post"
        onChange={() => { request.current++; setPreview(null); setError(null); }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const sequence = ++request.current;
          setPreview(null); setError(null);
          startTransition(async () => {
            try {
              const result = await previewSwimDateEdit({
                planId: plan.id, revision: plan.revision, workoutId: workout.id, workoutRevision: range.revision,
                date: String(form.get("date") ?? ""), reason: String(form.get("reason") ?? ""),
              });
              if (sequence !== request.current) return;
              if (result.error) setError(result.error);
              else if (result.preview) setPreview(result.preview);
            } catch {
              if (sequence === request.current) setError("Could not preview this date. Try again.");
            }
          });
        }}>
        <fieldset className={styles.formFields} disabled={busy}>
          <label className={styles.field}>Swim date
            <input type="date" name="date" min={range.min} max={range.max} defaultValue={workout.date} required />
          </label>
          <label className={styles.field}>Reason<textarea name="reason" maxLength={1000} required /></label>
          <button className={styles.secondary} disabled={busy || pending}>{pending ? "Preparing…" : "Preview date"}</button>
        </fieldset>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {preview && <div className={styles.form}>
        <p>{preview.previousDate} → {preview.date}</p>
        {preview.warnings.map((warning) => <p key={warning} role="status" className={styles.warning}>{warning}</p>)}
        <button type="button" className={styles.button} disabled={busy || pending} onClick={() => onApply(preview)}>Save date</button>
      </div>}
    </details>
  );
}
