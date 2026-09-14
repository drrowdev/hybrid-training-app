"use client";

import { useEffect, useRef, useState } from "react";
import {
  MAX_SWIM_COURSE_BYTES, parsePoolLengthInput, swimCourseWorkoutKey,
  type SwimCourse, type SwimCourseWorkoutChoice,
} from "@hta/domain";
import { parseSwimCourseFile } from "@/lib/swim/course-file";
import { conditioningCourseSchema, planConditioningCourse, type ProgramConditioningInput } from "@/lib/swim/conditioning-input";
import { SwimInputError } from "@/lib/swim/input-error";
import { CourseFields, initialCourseFields, type CourseFieldsValue } from "../swim/CourseFields";
import { PlanPreview } from "../swim/PlanPreview";
import styles from "../swim/Swim.module.css";

export type ConditioningPlanOption = { id: string; revision: number; title: string };
export type ConditioningSwimDraft = {
  selected: string;
  source: SwimCourse | null;
  fileName: string | null;
  fields: CourseFieldsValue;
  previewKey: string | null;
  confirmedKey: string | null;
  acceptedTotalsKey: string | null;
};
export function initialConditioningSwimDraft(): ConditioningSwimDraft {
  return {
    selected: "course", source: null, fileName: null, fields: initialCourseFields(),
    previewKey: null, confirmedKey: null, acceptedTotalsKey: null,
  };
}

export function conditioningCourseDraft(
  value: ConditioningSwimDraft, startedOn: string, weekdays: readonly number[],
) {
  if (!value.source) throw new SwimInputError("Choose a prepared plan file.");
  if (!value.fields.experience) throw new SwimInputError("Choose your swimming experience.");
  if (!value.fields.comfortableLengths) throw new SwimInputError("Enter the number of lengths you can swim without stopping.");
  if (!value.fields.strokes.length) throw new SwimInputError("Choose the strokes you can swim.");
  const poolChoices: SwimCourseWorkoutChoice[] = [];
  value.source.weeks.forEach((week, weekIndex) => week.workouts.forEach((_, workoutIndex) => {
    const key = swimCourseWorkoutKey(weekIndex, workoutIndex);
    const length = value.fields.poolLengths[key]?.trim();
    if (!length) return;
    const parsed = parsePoolLengthInput(length, "m");
    if (!parsed.ok) throw new SwimInputError(`Week ${weekIndex + 1}, swim ${workoutIndex + 1}: ${parsed.error.message}`);
    poolChoices.push({ weekIndex, workoutIndex, course: parsed.value });
  }));
  const parsed = conditioningCourseSchema.safeParse({
    kind: "course", courseFile: JSON.stringify(value.source), pool: value.fields.pool,
    poolLength: value.fields.poolLength, experience: value.fields.experience,
    comfortableLengths: Number(value.fields.comfortableLengths),
    strokes: value.fields.strokes, equipment: value.fields.equipment,
    poolChoices, reviewed: false,
  });
  if (!parsed.success) throw new SwimInputError("Check the swimming details.");
  const plan = planConditioningCourse(parsed.data, startedOn, weekdays);
  const key = JSON.stringify({ input: parsed.data, startedOn, weekdays });
  return { input: parsed.data, plan, key };
}

export function prepareConditioningSwimDraft(
  value: ConditioningSwimDraft, startedOn: string, weekdays: readonly number[], plans: readonly ConditioningPlanOption[],
): {
  input: ProgramConditioningInput["swim"] | null;
  course: ReturnType<typeof conditioningCourseDraft> | null;
  error: string | null;
} {
  const selected = plans.find((plan) => plan.id === value.selected);
  if (selected) return { input: { kind: "existing", planId: selected.id, revision: selected.revision }, course: null, error: null };
  try {
    if (value.selected !== "course") throw new SwimInputError("Choose an active swimming plan.");
    if (plans.length) throw new SwimInputError("Finish or archive your current swimming plan before importing another.");
    const course = conditioningCourseDraft(value, startedOn, weekdays);
    const ready = value.previewKey === course.key && value.confirmedKey === course.key &&
      (course.plan.totals.length === 0 || value.acceptedTotalsKey === course.key);
    return {
      course, error: null, input: ready
        ? { ...course.input, reviewed: true, acceptSetTotals: value.acceptedTotalsKey === course.key }
        : null,
    };
  } catch (error) {
    return { input: null, course: null, error: error instanceof SwimInputError ? error.message : "The swimming plan could not be prepared." };
  }
}

export function ConditioningSwimmingOptions({
  value, onChange, prepared, plans, disabled = false,
}: {
  value: ConditioningSwimDraft;
  onChange(value: ConditioningSwimDraft): void;
  prepared: ReturnType<typeof prepareConditioningSwimDraft>;
  plans: readonly ConditioningPlanOption[];
  disabled?: boolean;
}) {
  const [fileError, setFileError] = useState<string | null>(null);
  const [reviewAttempted, setReviewAttempted] = useState(false);
  const fileRevision = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => () => { fileRevision.current += 1; }, []);

  async function chooseFile(file?: File) {
    const revision = ++fileRevision.current;
    setFileError(null);
    setReviewAttempted(false);
    const empty = { ...value, source: null, fileName: null, fields: { ...value.fields, poolLengths: {} }, previewKey: null, confirmedKey: null, acceptedTotalsKey: null };
    onChange(empty);
    if (!file) return;
    try {
      if (file.size > MAX_SWIM_COURSE_BYTES) throw new Error("Oversized plan");
      const source = parseSwimCourseFile(await file.text());
      if (revision === fileRevision.current) onChange({ ...empty, source, fileName: file.name });
    } catch {
      if (revision === fileRevision.current) setFileError("Choose a prepared JSON plan file smaller than 256 KB.");
    }
  }

  const preview = value.selected === "course" && prepared.course?.key === value.previewKey ? prepared.course : null;
  return <fieldset className={styles.formFields} disabled={disabled}>
    <label className={styles.field}>Swimming plan
      <select value={value.selected} onChange={(event) => {
        fileRevision.current += 1;
        onChange({ ...value, selected: event.target.value });
      }}>
        {plans.map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}
        {plans.length === 0 && <option value="course">Import a plan</option>}
      </select>
    </label>
    {value.selected === "course" && <>
      <div className={styles.field}>
        <label htmlFor="conditioning-course-file">Prepared plan file</label>
        <input id="conditioning-course-file" ref={fileInput} type="file" accept=".json,application/json" hidden={!!value.source}
          onChange={(event) => { void chooseFile(event.target.files?.[0]); }} />
        {value.source && <div className={styles.actions}>
          <span className={styles.fileName}>{value.fileName ?? value.source.title}</span>
          <button type="button" className={styles.secondary} onClick={() => fileInput.current?.click()}>Change plan file</button>
        </div>}
      </div>
      {value.source && <>
        <CourseFields source={value.source} value={value.fields} inline onChange={(fields) => {
          setReviewAttempted(false);
          onChange({ ...value, fields, previewKey: null, confirmedKey: null, acceptedTotalsKey: null });
        }} />
        <div className={styles.actions}>
          <button type="button" className={styles.secondary} onClick={() => {
            setReviewAttempted(true);
            if (prepared.course) onChange({ ...value, previewKey: prepared.course.key });
          }}>Review swims</button>
        </div>
      </>}
      {preview && <>
        <PlanPreview plan={preview.plan.preview} title={value.source?.title ?? "Swimming"} />
        {preview.plan.totals.map((total) => <p key={total.key} className={styles.warning}>
          Week {total.week}, swim {total.workout}: the file lists {total.reported} m; its sets add up to {total.calculated} m.
        </p>)}
        {preview.plan.totals.length > 0 && <label className={styles.choice}>
          <input type="checkbox" checked={value.acceptedTotalsKey === preview.key} onChange={(event) =>
            onChange({ ...value, acceptedTotalsKey: event.target.checked ? preview.key : null })} />
          Use the distances from the listed sets
        </label>}
        <label className={styles.choice}>
          <input type="checkbox" checked={value.confirmedKey === preview.key} onChange={(event) =>
            onChange({ ...value, confirmedKey: event.target.checked ? preview.key : null })} />
          I have reviewed the workouts, dates and pools
        </label>
      </>}
      {(fileError || (reviewAttempted && prepared.error)) && <p role="alert" className={styles.error}>
        {fileError ?? prepared.error}
      </p>}
    </>}
  </fieldset>;
}
