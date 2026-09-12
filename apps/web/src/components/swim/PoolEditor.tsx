"use client";

import { useRef, useState, useTransition } from "react";
import { formatPoolCourse, poolCourseEquals, type PoolCourse } from "@hta/domain";
import { previewSwimPoolEdit } from "@/lib/swim/actions";
import { parsePoolForm } from "@/lib/swim/forms";
import { SwimInputError } from "@/lib/swim/input-error";
import type { SwimPoolEditContext, SwimPoolEditPreview } from "@/lib/swim/view-types";
import styles from "./Swim.module.css";

function preset(course: PoolCourse) {
  if (course.denominator === 1) {
    if (course.unit === "m" && course.numerator === 50) return "50m";
    if (course.numerator === 25) return course.unit === "m" ? "25m" : "25yd";
  }
  return "custom";
}

export function PoolEditor({ context, busy, onApply }: {
  context: SwimPoolEditContext; busy: boolean; onApply: (preview: SwimPoolEditPreview) => void;
}) {
  const workout = context.workout;
  const course = workout?.override ?? workout?.course ?? context.defaultCourse;
  const inherited = workout && !workout.override && poolCourseEquals(workout.course, context.defaultCourse);
  const [pool, setPool] = useState(inherited ? "default" : preset(course));
  const [preview, setPreview] = useState<SwimPoolEditPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const request = useRef(0);
  return (
    <details className={styles.poolEditor}>
      <summary>{workout ? "Change pool" : "Change default pool"}</summary>
      <form className={styles.form} onChange={() => { request.current++; setPreview(null); setError(null); }}
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          const sequence = ++request.current;
          setPreview(null); setError(null);
          startTransition(async () => {
            try {
              const result = await previewSwimPoolEdit({
                planId: context.planId, revision: context.revision,
                target: workout ? { kind: "workout", id: workout.id, revision: workout.revision } : { kind: "plan" },
                course: form.get("pool") === "default" ? null : parsePoolForm(form),
              });
              if (sequence !== request.current) return;
              if (result.error) setError(result.error);
              else if (result.preview) setPreview(result.preview);
              else setError("Could not preview this pool change. Try again.");
            } catch (cause) {
              if (sequence === request.current) setError(cause instanceof SwimInputError ? cause.message : "Could not preview this pool change. Try again.");
            }
          });
        }}>
        <fieldset className={styles.formFields} disabled={busy}>
          <label className={styles.field}>{workout ? "Pool length" : "Default pool"}
            <select name="pool" value={pool} onChange={(event) => setPool(event.target.value)}>
              {workout && <option value="default">Programme default ({formatPoolCourse(context.defaultCourse)})</option>}
              <option value="50m">50 m</option><option value="25m">25 m</option>
              <option value="25yd">25 yd</option><option value="custom">Custom</option>
            </select>
          </label>
          {pool === "custom" && <div className={styles.columns}>
            <label className={styles.field}>Custom length
              <input name="poolLength" defaultValue={course.denominator === 1 ? course.numerator : `${course.numerator}/${course.denominator}`} maxLength={64} required />
            </label>
            <label className={styles.field}>Unit<select name="poolUnit" defaultValue={course.unit}>
              <option value="m">Metres</option><option value="yd">Yards</option>
            </select></label>
          </div>}
          <button className={styles.secondary} disabled={pending || busy}>{pending ? "Preparing…" : "Preview pool change"}</button>
        </fieldset>
      </form>
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {preview && <div className={styles.form}>
        <strong>{preview.courseLabel}</strong>
        {preview.changes.length > 0 && <ul className={styles.list}>
          {preview.changes.map((change) => <li key={change.id} className={styles.row}>
            <span>{change.date}<small>{change.beforeCourse} → {change.afterCourse}</small></span>
            <span>{change.distance}<small>{change.beforeLengths !== change.afterLengths && `${change.beforeLengths} → `}{change.afterLengths} lengths</small></span>
          </li>)}
        </ul>}
        {preview.warning && <p role="status" className={styles.warning}>{preview.warning}</p>}
        <button type="button" className={styles.button} disabled={busy || pending} onClick={() => onApply(preview)}>Save pool</button>
      </div>}
    </details>
  );
}
