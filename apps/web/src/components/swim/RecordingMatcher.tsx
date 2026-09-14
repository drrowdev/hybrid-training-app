"use client";

import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { findSwimMatchWorkouts, saveSwimImportMatch } from "@/lib/swim/import-match-actions";
import type { MatchWorkoutChoice } from "@/lib/swim/import-matching";
import { createRequestGate } from "@/lib/swim/hub-request";
import styles from "./Swim.module.css";

export type RecordingMatcherProps = {
  importId: string; enabled: boolean; expectedMatchId: string | null;
  current: { importId: string; workoutId: string; title: string; date: string } | null;
};

export function RecordingMatcher({ importId, enabled, expectedMatchId, current }: RecordingMatcherProps) {
  const router = useRouter();
  const [date, setDate] = useState("");
  const [choices, setChoices] = useState<MatchWorkoutChoice[] | null>(null);
  const [selected, setSelected] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gate] = useState(createRequestGate);
  const version = useRef(0);
  const request = useRef<{ id: string; target: string | null } | null>(null);
  const target = choices?.find((choice) => choice.id === selected);

  function search() {
    const generation = version.current;
    void gate(async () => {
      setError(null);
      try {
        const result = await findSwimMatchWorkouts(date);
        if (generation !== version.current) return;
        if (!result.ok) { setError(result.error); return; }
        setChoices(result.value);
        setSelected("");
      } catch { setError("Workouts could not be loaded. Try again."); }
    }, setPending);
  }

  function save(remove: boolean) {
    if (!remove && !target) return;
    void gate(async () => {
      setError(null);
      const workoutId = remove ? null : target!.id;
      try {
        if (!request.current || request.current.target !== workoutId) {
          request.current = { id: crypto.randomUUID(), target: workoutId };
        }
        const result = await saveSwimImportMatch({
          requestId: request.current.id, importId, workoutId, expectedMatchId,
          workoutRevision: remove ? null : target!.revision,
        });
        if (!result.ok) { setError(result.error); return; }
        router.refresh();
      } catch { setError("The match is unconfirmed. Reload before trying again."); }
    }, setPending);
  }

  if (!enabled && !current) return null;
  return <section className={styles.section}>
    <h2>Planned workout</h2>
    {current && <div>
      <Link href={`/app/swim/${current.workoutId}`}>{current.title}</Link>
      <p className={styles.muted}>{current.date}</p>
      {current.importId !== importId && <Link href={`/app/swim/recordings/${current.importId}`}>View matched recording</Link>}
    </div>}
    {enabled && <form className={styles.form} onSubmit={(event) => { event.preventDefault(); search(); }}>
      <fieldset className={styles.formFields} disabled={pending}>
        <label className={styles.field}>Workout date
          <input type="date" required value={date} onChange={(event) => {
            version.current++; setDate(event.target.value); setChoices(null); setSelected(""); request.current = null; setError(null);
          }} />
        </label>
        <div className={styles.actions}><button className={styles.secondary} type="submit">Find workouts</button></div>
        {choices !== null && (choices.length
          ? <label className={styles.field}>Workout
            <select value={selected} onChange={(event) => { setSelected(event.target.value); request.current = null; }}>
              <option value="">Choose a workout</option>
              {choices.map((choice) => <option key={choice.id} value={choice.id}>{[choice.title, choice.slot, choice.distance, choice.pool, choice.plan].filter(Boolean).join(" · ")}</option>)}
            </select>
          </label>
          : <p className={styles.muted}>No planned swims on this date.</p>)}
        {target && <div className={styles.actions}>
          <button className={styles.button} type="button" onClick={() => save(false)}>{current ? "Change match" : "Match workout"}</button>
          <Link className={styles.secondary} href={`/app/swim/${target.id}`}>View workout</Link>
        </div>}
      </fieldset>
    </form>}
    {current && <div className={styles.actions}>
      <button className={styles.secondary} type="button" disabled={pending} onClick={() => save(true)}>Remove match</button>
    </div>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
  </section>;
}
