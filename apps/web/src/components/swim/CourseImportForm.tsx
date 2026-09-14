"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_SWIM_COURSE_BYTES, SWIM_WEEKDAYS, parsePoolLengthInput, swimCourseWorkoutKey,
  type SwimCourse, type SwimCourseWorkoutChoice,
} from "@hta/domain";
import { parseSwimCourseFile } from "@/lib/swim/course-file";
import { previewPrivateSwimCourse, importPrivateSwimCourse } from "@/lib/swim/course-actions";
import type { SwimCourseImportPreview } from "@/lib/swim/course-view";
import { PlanPreview } from "./PlanPreview";
import { CourseFields, initialCourseFields } from "./CourseFields";
import styles from "./Swim.module.css";

export function CourseImportForm({ today }: { today: string }) {
  const router = useRouter();
  const [source, setSource] = useState<SwimCourse | null>(null);
  const [fields, setFields] = useState(initialCourseFields);
  const [preview, setPreview] = useState<SwimCourseImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const fileRevision = useRef(0);
  const [reading, setReading] = useState(false);

  async function chooseFile(file?: File) {
    const revision = ++fileRevision.current;
    setSource(null);
    setFields((previous) => ({ ...previous, poolLengths: {} }));
    setPreview(null);
    setError(null);
    if (!file) { setReading(false); return; }
    setReading(true);
    try {
      if (file.size > MAX_SWIM_COURSE_BYTES) throw new Error("Choose a plan file smaller than 256 KB.");
      const parsed = parseSwimCourseFile(await file.text());
      if (revision === fileRevision.current) setSource(parsed);
    } catch {
      if (revision === fileRevision.current) setError("Choose a prepared JSON plan file smaller than 256 KB.");
    } finally { if (revision === fileRevision.current) setReading(false); }
  }

  function submit(form: FormData) {
    if (!source || busy.current || reading || savedId) return;
    busy.current = true;
    setError(null);
    setWarning(null);
    try {
      const choices: SwimCourseWorkoutChoice[] = [];
      source.weeks.forEach((week, weekIndex) => week.workouts.forEach((_, workoutIndex) => {
        const key = swimCourseWorkoutKey(weekIndex, workoutIndex);
        const length = String(form.get(`pool-${key}`) ?? "").trim();
        if (!length) return;
        const parsed = parsePoolLengthInput(length, "m");
        if (!parsed.ok) throw new Error(`Week ${weekIndex + 1}, swim ${workoutIndex + 1}: ${parsed.error.message}`);
        choices.push({ weekIndex, workoutIndex, course: parsed.value });
      }));
      form.delete("file");
      form.set("courseFile", JSON.stringify(source));
      form.set("poolChoices", JSON.stringify(choices));
      startTransition(async () => {
        try {
          if (preview) {
            const result = await importPrivateSwimCourse(form, preview.id);
            if (result.error) setError(result.error);
            else if (result.planId) {
              setSavedId(result.planId);
              if (result.warning) setWarning(result.warning);
              else {
                router.push(`/app/swim?plan=${result.planId}`);
                router.refresh();
              }
            } else setError("The import was not confirmed. Check your swimming plans before trying again.");
          } else {
            const result = await previewPrivateSwimCourse(form);
            if (result.error) setError(result.error);
            else if (result.preview) setPreview(result.preview);
            else setError("Could not preview the plan. Try again.");
          }
        } catch {
          setError(preview
            ? "The import was not confirmed. Check your swimming plans before trying again."
            : "Could not preview the plan. Try again.");
        } finally { busy.current = false; }
      });
    } catch (caught) {
      busy.current = false;
      setError(caught instanceof Error ? caught.message : "Review the pool lengths.");
    }
  }

  return <form method="post" className={styles.form} onSubmit={(event) => {
    event.preventDefault();
    submit(new FormData(event.currentTarget));
  }}>
    <fieldset className={styles.formFields} disabled={pending || !!savedId}
      onChange={() => { setPreview(null); setError(null); }}>
      <section className={styles.section}>
        <label className={styles.field}>Prepared plan file
          <input name="file" type="file" accept=".json,application/json"
            onChange={(event) => { void chooseFile(event.target.files?.[0]); }} />
        </label>
        {source && <div className={styles.previewHeading}>
          <h2>{source.title}</h2>
          <p className={styles.muted}>{source.source.edition}</p>
        </div>}
      </section>
      {source && <>
        <section className={styles.section}>
          <h2>Schedule</h2>
          <label className={styles.field}>Start date<input name="startDate" type="date" min={today} defaultValue={today} required /></label>
          <fieldset className={styles.choices}><legend>Swim days</legend>
            {SWIM_WEEKDAYS.map(({ value, label }) => <label key={value} className={styles.choice}>
              <input name="weekdays" type="checkbox" value={value} />{label.slice(0, 3)}
            </label>)}
          </fieldset>
        </section>
        <CourseFields source={source} value={fields} onChange={setFields} />
      </>}
    </fieldset>
    {preview && <>
      <PlanPreview plan={preview.plan} title={preview.title} />
      <section className={styles.section}>
        {preview.totals.map((total) => <p key={total.key} className={styles.warning}>
          Week {total.week}, swim {total.workout}: the file lists {total.reported} m; its sets add up to {total.calculated} m.
        </p>)}
        {preview.totals.length > 0 && <label className={styles.choice}>
          <input name="acceptSetTotals" type="checkbox" required disabled={pending || !!savedId} />Use the distances from the listed sets
        </label>}
        {preview.strengthDays.length > 0 && <label className={styles.choice}>
          <input name="acceptOverlap" type="checkbox" required disabled={pending || !!savedId} />
          Swim on strength days: {preview.strengthDays.join(", ")}
        </label>}
        <label className={styles.choice}><input name="reviewed" type="checkbox" required disabled={pending || !!savedId} />
          I have reviewed the workouts, dates and pools
        </label>
      </section>
    </>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    {warning && <p className={styles.warning} role="status">{warning}</p>}
    <div className={styles.actions}>
      {savedId ? <a className={styles.button} href={`/app/swim?plan=${savedId}`}>Open swimming plan</a> : <>
        <button className={styles.button} disabled={!source || reading || pending}>
          {pending ? "Please wait..." : preview ? "Import plan" : "Review plan"}
        </button>
        {preview && <button type="button" className={styles.secondary} disabled={pending}
          onClick={() => setPreview(null)}>Change details</button>}
      </>}
    </div>
  </form>;
}
