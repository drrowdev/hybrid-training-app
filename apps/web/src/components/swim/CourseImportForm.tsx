"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  MAX_SWIM_COURSE_BYTES, SWIM_WEEKDAYS, parsePoolLengthInput, swimCourseWorkoutKey, swimCourseWorkoutTitle,
  type SwimCourse, type SwimCourseWorkoutChoice, type TrainingCommitment,
} from "@hta/domain";
import { parseSwimCourseFile } from "@/lib/swim/course-file";
import { previewPrivateSwimCourse, importPrivateSwimCourse } from "@/lib/swim/course-actions";
import type { SwimCourseImportPreview } from "@/lib/swim/course-view";
import { PlanPreview } from "./PlanPreview";
import { ProgramConfirmation } from "@/components/program/ProgramDialog";
import styles from "./Swim.module.css";

export function CourseImportForm({ today, schedule = [], replacePlanId }: { today: string; schedule?: TrainingCommitment[]; replacePlanId?: string }) {
  const router = useRouter();
  const [source, setSource] = useState<SwimCourse | null>(null);
  const [pool, setPool] = useState("50m");
  const [preview, setPreview] = useState<SwimCourseImportPreview | null>(null);
  const [replacementForm, setReplacementForm] = useState<FormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const busy = useRef(false);
  const fileRevision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [reading, setReading] = useState(false);
  const [startDate, setStartDate] = useState(today);
  const requestId = useRef<string | null>(null);
  const horizon = new Date(`${startDate}T00:00:00Z`);
  horizon.setUTCDate(horizon.getUTCDate() + (source?.weeks.length ?? 0) * 7);
  const endDate = Number.isFinite(horizon.getTime()) ? horizon.toISOString().slice(0, 10) : startDate;
  const commitments = schedule.filter((entry) => entry.date >= startDate && entry.date < endDate);

  const chooseFile = useCallback(async (file?: File) => {
    const revision = ++fileRevision.current;
    setSource(null);
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
  }, []);

  useEffect(() => {
    // Recover selections made before hydration attached the change handler.
    const file = fileInput.current?.files?.[0];
    if (file && fileRevision.current === 0) void chooseFile(file);
  }, [chooseFile]);

  function submit(form: FormData, replace = false) {
    if (!source || busy.current || reading || savedId) return;
    if (replacePlanId) form.set("replacePlanId", replacePlanId);
    if (preview?.replaces && !replace) { setReplacementForm(form); return; }
    if (replace) form.set("acceptReplacement", "on");
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
            if (!requestId.current) throw new Error("Review the plan again before importing.");
            form.set("requestId", requestId.current);
            const result = await importPrivateSwimCourse(form, preview.id);
            if (result.error) setError(result.error);
            else if (result.planId) {
              setSavedId(result.planId);
              setReplacementForm(null);
              if (result.warning) setWarning(result.warning);
              else {
                router.push(`/app/swim?plan=${result.planId}`);
                router.refresh();
              }
            } else setError("The import was not confirmed. Check your swimming plans before trying again.");
          } else {
            const result = await previewPrivateSwimCourse(form);
            if (result.error) setError(result.error);
            else if (result.preview) { requestId.current = crypto.randomUUID(); setPreview(result.preview); }
            else setError("Couldn't preview the plan. Try again.");
          }
        } catch {
          setError(preview
            ? "The import was not confirmed. Check your swimming plans before trying again."
            : "Couldn't preview the plan. Try again.");
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
    {replacementForm && preview?.replaces && <ProgramConfirmation
      name={preview.replaces.name} pending={pending} error={error}
      onCancel={() => setReplacementForm(null)} onConfirm={() => submit(replacementForm, true)} />}
    <fieldset className={styles.formFields} disabled={pending || !!savedId}
      onChange={() => { setPreview(null); setError(null); }}>
      <section className={styles.section}>
        <label className={styles.field}>Prepared plan file
          <input ref={fileInput} name="file" type="file" accept=".json,application/json"
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
          <label className={styles.field}>Start date<input name="startDate" type="date" min={today} value={startDate} onChange={(event) => setStartDate(event.target.value)} required /></label>
          <fieldset className={styles.choices}><legend>Swim days</legend>
            {SWIM_WEEKDAYS.map(({ value, label }) => {
              const days = commitments.filter((entry) => new Date(`${entry.date}T00:00:00Z`).getUTCDay() === value);
              const work = days.filter((entry) => entry.state !== "rest" && entry.state !== "paused");
              return <label key={value} className={styles.choice}>
                <input name="weekdays" type="checkbox" value={value} /><span>{label.slice(0, 3)}
                  {work.length > 0 ? <small className={styles.muted}> · {work.length} scheduled</small>
                    : days.some((entry) => entry.state === "rest") ? <small className={styles.muted}> · Planned rest</small> : null}</span>
              </label>;
            })}
          </fieldset>
          {commitments.some((entry) => entry.state !== "rest") && <details className={styles.details}><summary>Scheduled training</summary>
            <ul className={styles.list}>{commitments.filter((entry) => entry.state !== "rest").map((entry) =>
              <li key={`${entry.source}:${entry.id}`} className={styles.row}><span>{entry.date}</span><span>{entry.title}</span></li>)}</ul>
          </details>}
        </section>
        <section className={styles.section}>
          <h2>Pool</h2>
          <label className={styles.field}>Pool length<select name="pool" value={pool} onChange={(event) => setPool(event.target.value)}>
            <option value="50m">50 metres</option><option value="25m">25 metres</option><option value="custom">Other length</option>
          </select></label>
          {pool === "custom" && <label className={styles.field}>Length in metres
            <input name="poolLength" required maxLength={64} placeholder="33 1/3" />
          </label>}
          <input name="poolUnit" type="hidden" value="m" />
          <details className={styles.details}><summary>Different pool for a workout</summary>
            {source.weeks.map((week, weekIndex) => <details key={weekIndex} className={styles.details}>
              <summary>Week {weekIndex + 1}</summary>
              <div className={styles.columns}>{week.workouts.map((workout, workoutIndex) => <label
                key={workoutIndex} className={styles.field}>
                {swimCourseWorkoutTitle(workout.title, swimCourseWorkoutKey(weekIndex, workoutIndex))}
                <input name={`pool-${swimCourseWorkoutKey(weekIndex, workoutIndex)}`} maxLength={64}
                  placeholder="Use plan pool" aria-label={`Week ${weekIndex + 1}, swim ${workoutIndex + 1} pool length in metres`} />
              </label>)}</div>
            </details>)}
          </details>
        </section>
        <section className={styles.section}>
          <h2>Swimming experience</h2>
          <input name="goal" type="hidden" value="endurance" />
          <label className={styles.field}>Experience<select name="experience" required defaultValue="">
            <option value="" disabled>Choose experience</option>
            <option value="beginner">Beginner</option><option value="returning">Returning</option>
            <option value="regular">Regular swimmer</option><option value="trained">Experienced</option>
          </select></label>
          <label className={styles.field}>Comfortable non-stop lengths in the plan pool
            <input name="comfortableLengths" type="number" min="1" max="2000" step="1" required />
          </label>
          <fieldset className={styles.choices}><legend>Known strokes</legend>
            {[["freestyle", "Freestyle"], ["backstroke", "Backstroke"], ["breaststroke", "Breaststroke"], ["butterfly", "Butterfly"]].map(([value, label]) =>
              <label key={value} className={styles.choice}><input name="strokes" type="checkbox" value={value} />{label}</label>)}
          </fieldset>
          <fieldset className={styles.choices}><legend>Equipment</legend>
            {[["kickboard", "Kickboard"], ["pull_buoy", "Pull buoy"], ["fins", "Fins"], ["paddles", "Paddles"], ["snorkel", "Snorkel"]].map(([value, label]) =>
              <label key={value} className={styles.choice}><input name="equipment" type="checkbox" value={value} />{label}</label>)}
          </fieldset>
        </section>
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
        {(preview.overlaps?.length ?? 0) > 0 && <><ul className={styles.list}>{preview.overlaps!.map((entry) =>
          <li key={`${entry.source}:${entry.id}`} className={styles.row}><span>{entry.date}</span><span>{entry.title}</span></li>)}</ul><label className={styles.choice}>
          <input name="acceptOverlap" type="checkbox" required disabled={pending || !!savedId} />
          Keep both workouts on these dates
        </label></>}
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
