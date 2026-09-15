"use client";

import type { ReactNode } from "react";
import {
  CONDITIONING_ACTIVITIES, SWIM_WEEKDAYS, validateConditioningChoices,
  type ConditioningActivity, type ConditioningChoice,
} from "@hta/domain";
import { PREFERRED_CARDIO_MODALITY_LABEL } from "@/lib/planner/preferred-cardio-modality";
import styles from "./ConditioningStep.module.css";

export function ConditioningStep({
  weekdays, choices, onChange, swimmingOptions, disabled = false,
}: {
  weekdays: readonly number[];
  choices: readonly ConditioningChoice[];
  onChange(choices: readonly ConditioningChoice[]): void;
  swimmingOptions: ReactNode;
  disabled?: boolean;
}) {
  const validation = validateConditioningChoices(weekdays, choices);
  const selected = new Map(choices.map((choice) => [choice.weekday, choice.activity]));
  const days = SWIM_WEEKDAYS.map((day) => ({ ...day, weekday: (day.value + 6) % 7 }));
  const removed = choices.filter((choice) => !weekdays.includes(choice.weekday));
  const swimming = choices.some((choice) => choice.activity === "swimming" && weekdays.includes(choice.weekday));

  function choose(weekday: number, value: string) {
    const activity = CONDITIONING_ACTIVITIES.find((candidate) => candidate === value);
    const next = choices.filter((choice) => choice.weekday !== weekday);
    onChange(activity ? [...next, { weekday, activity }] : next);
  }

  return (
    <section className={styles.section} aria-labelledby="conditioning-heading">
      <h2 id="conditioning-heading" className={styles.heading}>Conditioning</h2>
      <fieldset className={styles.fields} disabled={disabled}>
        <legend className={styles.legend}>Activities</legend>
        {days.filter((day) => weekdays.includes(day.weekday)).map((day) => (
          <label className={styles.row} key={day.weekday}>
            <span>{day.label}</span>
            <select value={selected.get(day.weekday) ?? ""} onChange={(event) => choose(day.weekday, event.target.value)}>
              <option value="">Use plan default</option>
              {CONDITIONING_ACTIVITIES.map((activity: ConditioningActivity) => (
                <option key={activity} value={activity}>{PREFERRED_CARDIO_MODALITY_LABEL[activity]}</option>
              ))}
            </select>
          </label>
        ))}
      </fieldset>
      {removed.length > 0 && <div role="alert" className={styles.error}>
        <p>Some selected activities no longer have a conditioning day.</p>
        <button type="button" disabled={disabled} onClick={() =>
          onChange(choices.filter((choice) => weekdays.includes(choice.weekday)))}>
          Remove those activities
        </button>
      </div>}
      {!validation.ok && removed.length === 0 && <p role="alert" className={styles.error}>{validation.error.message}</p>}
      {swimming && <section className={styles.swimming} aria-labelledby="conditioning-swimming-heading">
        <h3 id="conditioning-swimming-heading">Swimming</h3>
        {swimmingOptions}
      </section>}
    </section>
  );
}
