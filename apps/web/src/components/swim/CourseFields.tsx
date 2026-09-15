"use client";

import { swimCourseWorkoutKey, swimCourseWorkoutTitle, type SwimCourse } from "@hta/domain";
import styles from "./Swim.module.css";

export type CourseFieldsValue = {
  pool: string;
  poolLength: string;
  experience: string;
  comfortableLengths: string;
  strokes: string[];
  equipment: string[];
  poolLengths: Record<string, string>;
};

export function initialCourseFields(): CourseFieldsValue {
  return { pool: "50m", poolLength: "", experience: "", comfortableLengths: "", strokes: [], equipment: [], poolLengths: {} };
}

export function CourseFields({
  source, value, onChange, inline = false,
}: {
  source: SwimCourse;
  value: CourseFieldsValue;
  onChange(value: CourseFieldsValue): void;
  inline?: boolean;
}) {
  const Heading = inline ? "h4" : "h2";
  function toggle(field: "strokes" | "equipment", key: string, checked: boolean) {
    onChange({ ...value, [field]: checked ? [...value[field], key] : value[field].filter((item) => item !== key) });
  }

  return <>
    <section className={inline ? styles.inlineSection : styles.section}>
      <Heading>Pool</Heading>
      <label className={styles.field}>Pool length
        <select name="pool" value={value.pool} onChange={(event) => onChange({ ...value, pool: event.target.value })}>
          <option value="50m">50 metres</option><option value="25m">25 metres</option><option value="custom">Other length</option>
        </select>
      </label>
      {value.pool === "custom" && <label className={styles.field}>Length in metres
        <input name="poolLength" required maxLength={64} placeholder="33 1/3" value={value.poolLength}
          onChange={(event) => onChange({ ...value, poolLength: event.target.value })} />
      </label>}
      <input name="poolUnit" type="hidden" value="m" />
      <details className={styles.details}><summary>Different pool for a workout</summary>
        {source.weeks.map((week, weekIndex) => <details key={weekIndex} className={styles.details}>
          <summary>Week {weekIndex + 1}</summary>
          <div className={styles.columns}>{week.workouts.map((workout, workoutIndex) => {
            const key = swimCourseWorkoutKey(weekIndex, workoutIndex);
            return <label key={key} className={styles.field}>
              {swimCourseWorkoutTitle(workout.title, key)}
              <input name={`pool-${key}`} maxLength={64} placeholder="Use plan pool"
                aria-label={`Week ${weekIndex + 1}, swim ${workoutIndex + 1} pool length in metres`}
                value={value.poolLengths[key] ?? ""}
                onChange={(event) => onChange({
                  ...value, poolLengths: { ...value.poolLengths, [key]: event.target.value },
                })} />
            </label>;
          })}</div>
        </details>)}
      </details>
    </section>
    <section className={inline ? styles.inlineSection : styles.section}>
      <Heading>Swimming experience</Heading>
      <input name="goal" type="hidden" value="endurance" />
      <label className={styles.field}>Experience
        <select name="experience" required value={value.experience}
          onChange={(event) => onChange({ ...value, experience: event.target.value })}>
          <option value="" disabled>Choose experience</option>
          <option value="beginner">Beginner</option><option value="returning">Returning</option>
          <option value="regular">Regular swimmer</option><option value="trained">Experienced</option>
        </select>
      </label>
      <label className={styles.field}>Comfortable non-stop lengths in the plan pool
        <input name="comfortableLengths" type="number" min="1" max="2000" step="1" required
          value={value.comfortableLengths}
          onChange={(event) => onChange({ ...value, comfortableLengths: event.target.value })} />
      </label>
      <fieldset className={styles.choices}><legend>Known strokes</legend>
        {([["freestyle", "Freestyle"], ["backstroke", "Backstroke"], ["breaststroke", "Breaststroke"], ["butterfly", "Butterfly"]] as const).map(([key, label]) =>
          <label key={key} className={styles.choice}><input name="strokes" type="checkbox" value={key}
            checked={value.strokes.includes(key)} onChange={(event) => toggle("strokes", key, event.target.checked)} />{label}</label>)}
      </fieldset>
      <fieldset className={styles.choices}><legend>Equipment</legend>
        {([["kickboard", "Kickboard"], ["pull_buoy", "Pull buoy"], ["fins", "Fins"], ["paddles", "Paddles"], ["snorkel", "Snorkel"]] as const).map(([key, label]) =>
          <label key={key} className={styles.choice}><input name="equipment" type="checkbox" value={key}
            checked={value.equipment.includes(key)} onChange={(event) => toggle("equipment", key, event.target.checked)} />{label}</label>)}
      </fieldset>
    </section>
  </>;
}
