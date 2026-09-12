"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { skipSwimWorkout, applySwimPoolEdit } from "@/lib/swim/actions";
import { formatSwimTime } from "@/lib/swim/time";
import { nextConfirmedView, type SwimWorkoutView } from "@/lib/swim/view-types";
import { PoolEditor } from "./PoolEditor";
import { createRequestGate } from "@/lib/swim/hub-request";
import { SWIM_REFRESH_WARNING } from "@/lib/swim/action-feedback";
import styles from "./Swim.module.css";

export function WorkoutScreen({ workout: incomingWorkout }: { workout: SwimWorkoutView }) {
  const router = useRouter();
  const [heldWorkout, setWorkout] = useState(incomingWorkout);
  const workout = nextConfirmedView(heldWorkout, incomingWorkout, "props");
  if (workout !== heldWorkout) setWorkout(workout);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [requestGate] = useState(createRequestGate);
  const [poolBusy, setPoolBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  return (
    <>
      <section className={styles.section}>
        <div className={styles.actions}><p className={styles.distance}>{workout.total}</p><span className={styles.muted}>{workout.course}</span></div>
        <p className={styles.muted}>{workout.date} · Up to {workout.budgetMinutes} min{workout.provisional && !workout.sessionId ? " · Draft" : ""}</p>
        {workout.calibrationLabel && <p className={styles.muted}>{workout.calibrationLabel}</p>}
        {workout.poolEditing && <PoolEditor key={`${workout.id}:${workout.revision}:${workout.poolEditing.revision}`}
          context={workout.poolEditing} busy={pending || poolBusy} onApply={(preview) => {
            setError(null); setWarning(null);
            void requestGate(async () => {
              try {
                const result = await applySwimPoolEdit(preview);
                if (result.ok !== true || result.error) { setError(result.error ?? "Could not save this pool. Try again."); return; }
                if (result.workoutView) {
                  const view = result.workoutView;
                  setWorkout((current) => nextConfirmedView(current, view, "confirmed"));
                }
                setWarning(result.warning ?? null);
                try { router.refresh(); } catch { setWarning(SWIM_REFRESH_WARNING); }
              } catch { setError("Could not save this pool. Try again."); }
            }, setPoolBusy);
          }} />}
        {warning && <p role="status" className={styles.warning}>{warning}</p>}
        {!workout.sessionId && workout.status === "scheduled" && workout.planStatus !== "active" && (
          <p role="status" className={styles.muted}>{({ paused: "Plan paused", finished: "Plan finished", archived: "Plan archived" })[workout.planStatus]}</p>
        )}
        {workout.deleted && <Link href="/app/settings/trash" className={styles.secondary}>Restore from Trash</Link>}
        {workout.sourceGone && <p role="status" className={styles.muted}>Result removed</p>}
      </section>
      <section className={styles.section}>
        <h2>Workout</h2>
        <ol className={styles.steps}>
          {workout.steps.map((step) => (
            <li key={step.id} className={styles.step}>
              <div className={styles.stepTitle}><span>{step.section}</span><span>{step.title}</span></div>
              {step.lengths !== undefined && <p className={styles.muted}>{step.lengths} lengths per repeat</p>}
              <p className={styles.muted}>{step.detail}</p>
              {step.guidance && <p>{step.guidance}</p>}
              <p className={styles.muted}>{step.effort} · {step.rest}{step.pace ? ` · ${step.pace}` : ""}</p>
            </li>
          ))}
        </ol>
      </section>
      {!workout.sourceGone && workout.result && <section className={styles.section}>
        <h2>Your swim</h2>
        {workout.result.distance && <p className={styles.distance}>{workout.result.distance}</p>}
        <p>{workout.result.lengths} lengths · {formatSwimTime(workout.result.timeMs)}{workout.result.rpe != null ? ` · RPE ${workout.result.rpe}` : ""}</p>
        {workout.result.course && <p className={styles.muted}>{workout.result.course}</p>}
        {workout.result.notes && <p className={styles.muted}>{workout.result.notes}</p>}
      </section>}
      {!workout.sessionId && workout.status === "scheduled" && workout.planStatus === "active" && <form method="post" onSubmit={(event) => {
        event.preventDefault();
        const form = new FormData(event.currentTarget);
        setError(null);
        startTransition(async () => {
          try {
            const result = await skipSwimWorkout(workout.id, workout.revision, String(form.get("reason") ?? ""));
            if (result.error) setError(result.error); else router.refresh();
          } catch { setError("Could not skip this swim. Try again."); }
        });
      }} className={styles.section}>
        <details className={styles.details}><summary>Skip swim</summary>
          <label className={styles.field}>Reason<textarea name="reason" maxLength={1000} required /></label>
          <button className={styles.secondary} disabled={pending || poolBusy}>Skip swim</button>
        </details>
      </form>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {workout.sessionId && !workout.deleted && !workout.sourceGone && (
        <DeleteSessionButton sessionId={workout.sessionId} label="Swim" redirectTo="/app/swim" variant="menu" />
      )}
    </>
  );
}
