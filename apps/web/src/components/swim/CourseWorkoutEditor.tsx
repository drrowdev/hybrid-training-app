"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { SwimCourseItem } from "@hta/domain";
import { previewPrivateSwimEdit, savePrivateSwimEdit } from "@/lib/swim/course-actions";
import type { SwimCourseEditInput, SwimCourseEditPreview } from "@/lib/swim/course-view";
import { SWIM_STROKE_LABEL } from "@/lib/swim/presentation";
import { PlanPreview } from "./PlanPreview";
import styles from "./Swim.module.css";

export function CourseWorkoutEditor({ context, busy = false, onBusyChange }: {
  context: Omit<SwimCourseEditInput, "reason">; busy?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [workout, setWorkout] = useState(context.workout);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<SwimCourseEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);

  function itemChange(sectionIndex: number, itemIndex: number, change: Partial<SwimCourseItem>) {
    setWorkout((current) => ({
      ...current, sections: current.sections.map((section, index) => index !== sectionIndex ? section : {
        ...section, items: section.items.map((item, index) => index !== itemIndex ? item : { ...item, ...change }),
      }),
    }));
    setPreview(null);
  }

  return <details className={styles.details}>
    <summary>Edit workout</summary>
    <form method="post" className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      if (inFlight.current || busy || saved) return;
      inFlight.current = true;
      onBusyChange?.(true);
      setError(null);
      const input = { ...context, workout, reason };
      startTransition(async () => {
        try {
          if (preview) {
            const result = await savePrivateSwimEdit(input, preview.id);
            if (result.error) setError(result.error);
            else if (result.ok) {
              setSaved(true);
              setWarning(result.warning ?? null);
              router.refresh();
            } else setError("The change was not confirmed. Refresh the workout before trying again.");
          } else {
            const result = await previewPrivateSwimEdit(input);
            if (result.error) setError(result.error);
            else if (result.preview) setPreview(result.preview);
            else setError("Could not preview this change. Try again.");
          }
        } catch { setError("The change was not confirmed. Refresh the workout before trying again."); }
        finally { inFlight.current = false; onBusyChange?.(false); }
      });
    }}>
      <fieldset className={styles.formFields} disabled={pending || busy || saved}>
        {workout.sections.map((section, sectionIndex) => <section key={sectionIndex} className={styles.section}>
          <h3>{section.label}</h3>
          <label className={styles.field}>Rounds<input type="number" min="1" max="2000" step="1" required
            value={section.rounds} onChange={(event) => {
              const rounds = Number(event.target.value);
              setWorkout((current) => ({ ...current, sections: current.sections.map((entry, index) =>
                index === sectionIndex ? { ...entry, rounds } : entry) }));
              setPreview(null);
            }} /></label>
          {section.items.map((item, itemIndex) => <fieldset key={itemIndex} className={styles.formFields}>
            <legend>{SWIM_STROKE_LABEL[item.stroke]}</legend>
            {item.drill && <p className={styles.muted}>{item.drill}</p>}
            <div className={styles.columns}>
              <label className={styles.field}>Repeats<input type="number" min="1" max="2000" step="1" required
                value={item.repeats} onChange={(event) => itemChange(sectionIndex, itemIndex, { repeats: Number(event.target.value) })} /></label>
              <label className={styles.field}>Metres per repeat<input type="number" min="1" max="100000" step="1" required
                value={item.distanceMetres} onChange={(event) => itemChange(sectionIndex, itemIndex, { distanceMetres: Number(event.target.value) })} /></label>
              <label className={styles.field}>{item.sendoffSeconds === undefined ? "Rest (seconds)" : "Send-off (seconds)"}
                <input type="number" min={item.sendoffSeconds === undefined ? "0" : "1"} max="86400" step="1"
                  required={item.sendoffSeconds !== undefined}
                  placeholder={item.sendoffSeconds === undefined ? "Not specified" : undefined}
                  value={item.sendoffSeconds ?? item.restSeconds ?? ""} onChange={(event) => itemChange(sectionIndex, itemIndex,
                    item.sendoffSeconds === undefined
                      ? { restSeconds: event.target.value === "" ? undefined : Number(event.target.value) }
                      : { sendoffSeconds: Number(event.target.value) })} />
              </label>
              <label className={styles.field}>Effort<select value={item.effort} onChange={(event) => {
                const effort = event.target.value;
                if (effort === "easy" || effort === "steady" || effort === "brisk" || effort === "threshold" || effort === "sprint") {
                  itemChange(sectionIndex, itemIndex, { effort });
                }
              }}>
                <option value="easy">Easy</option><option value="steady">Steady</option><option value="brisk">Brisk</option>
                <option value="threshold">Threshold</option><option value="sprint">Sprint</option>
              </select></label>
            </div>
            {item.note && <p className={styles.muted}>{item.note}</p>}
          </fieldset>)}
        </section>)}
        <label className={styles.field}>Reason for change<textarea maxLength={1000} required value={reason}
          onChange={(event) => { setReason(event.target.value); setPreview(null); }} /></label>
      </fieldset>
      {preview && <>
        <p className={styles.warning}>{preview.before === preview.after
          ? "This changes the imported workout." : `This changes the imported workout: ${preview.before} to ${preview.after}.`}</p>
        <PlanPreview plan={preview.plan} title="Edited workout" />
      </>}
      {error && <p className={styles.error} role="alert">{error}</p>}
      {warning && <p className={styles.warning} role="status">{warning}</p>}
      {saved ? <button type="button" className={styles.secondary} onClick={() => router.refresh()}>Refresh workout</button>
        : <button className={styles.button} disabled={pending || busy}>{pending ? "Please wait..." : preview ? "Save changes" : "Review changes"}</button>}
    </form>
  </details>;
}
