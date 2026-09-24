"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { saveSwimImportOutcome } from "@/lib/swim/import-outcome-actions";
import { createRequestGate } from "@/lib/swim/hub-request";
import { swimWorkoutHref, type SwimOrigin } from "@/lib/swim/return-context";
import styles from "./Swim.module.css";

type Outcome = "completed" | "stopped_early";
export function RecordingOutcome({ workoutId, matchId, workoutRevision, expectedOutcomeId, current, enabled,
  canRemove, needsReview, otherMatch, workoutTitle, origin }: {
  workoutId: string; matchId: string | null; workoutRevision: number; workoutTitle?: string; origin?: SwimOrigin;
  expectedOutcomeId: string | null; current: Outcome | null; enabled: boolean;
  canRemove: boolean; needsReview: boolean; otherMatch: boolean;
}) {
  const router = useRouter();
  const headingId = useId();
  const [selected, setSelected] = useState<Outcome | "">("");
  const [editing, setEditing] = useState(current === null && !otherMatch && !needsReview);
  const [receipt, setReceipt] = useState<{ id: string; outcome: Outcome | null } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [gate] = useState(createRequestGate);
  const request = useRef<{ id: string; outcome: Outcome | null } | null>(null);
  const displayedOutcome = receipt ? receipt.outcome : current;
  const removable = receipt ? receipt.outcome !== null : canRemove;

  function save(outcome: Outcome | null) {
    if (outcome !== null && matchId === null) {
      setError("Choose a matched recording before confirming.");
      return;
    }
    void gate(async () => {
      setError(null);
      setWarning(null);
      try {
        if (!request.current || request.current.outcome !== outcome) {
          request.current = { id: crypto.randomUUID(), outcome };
        }
        const result = await saveSwimImportOutcome({
          requestId: request.current.id, workoutId, matchId: outcome === null ? null : matchId,
          outcome, expectedOutcomeId: receipt?.id ?? expectedOutcomeId,
          workoutRevision: outcome === null ? null : workoutRevision,
        });
        if (!result.ok) { setError(result.error); return; }
        setReceipt({ id: result.value, outcome });
        request.current = null;
        setSelected("");
        setEditing(outcome === null);
        setWarning(result.warning ?? null);
        try { router.refresh(); }
        catch { setWarning("Couldn't refresh this workout. Try again."); }
      } catch { setError("Couldn't confirm this change. Try again."); }
    }, setPending);
  }

  if (!enabled && receipt?.outcome === null && !error && !warning) return null;

  return <section className={styles.section} aria-labelledby={headingId}>
    <h2 id={headingId}>{workoutTitle
      ? <Link href={origin ? swimWorkoutHref(workoutId, origin) : `/app/swim/${workoutId}`}>{workoutTitle}</Link>
      : "Workout outcome"}</h2>
    {displayedOutcome && <p aria-live="polite">{displayedOutcome === "completed" ? "Completed" : "Stopped early"}</p>}
    {!receipt && needsReview && <p role="status">The recording or workout changed. Review the match before confirming again.</p>}
    {!receipt && otherMatch && <p role="status">This workout has a confirmation for another recording.</p>}
    {enabled && !editing && <button className={styles.secondary} type="button"
      disabled={pending} onClick={() => setEditing(true)}>Change outcome</button>}
    {enabled && editing && <form className={styles.form} onSubmit={(event) => {
      event.preventDefault();
      if (selected) save(selected);
    }}>
      <fieldset className={styles.choices} disabled={pending}>
        <legend>How did the workout finish?</legend>
        <label className={styles.choice}><input type="radio" name="outcome" value="completed" required
          checked={selected === "completed"} onChange={() => { setSelected("completed"); request.current = null; }} />Completed</label>
        <label className={styles.choice}><input type="radio" name="outcome" value="stopped_early" required
          checked={selected === "stopped_early"} onChange={() => { setSelected("stopped_early"); request.current = null; }} />Stopped early</label>
      </fieldset>
      <div className={styles.actions}>
        <button className={styles.button} disabled={pending || !selected}>Confirm outcome</button>
        {removable && <button className={styles.secondary} type="button" disabled={pending}
          onClick={() => { setEditing(false); setSelected(""); }}>Cancel</button>}
      </div>
    </form>}
    {removable && <button className={styles.secondary} type="button" disabled={pending} onClick={() => save(null)}>Remove confirmation</button>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {warning && <p role="status" className={styles.warning}>{warning}</p>}
  </section>;
}
