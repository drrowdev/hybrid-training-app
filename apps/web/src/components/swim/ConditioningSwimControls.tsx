"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { applySwimDateEdit, changeConditioningSwim } from "@/lib/swim/actions";
import type { ConditioningChange } from "@/lib/swim/conditioning-lifecycle";
import type { ConditioningSwim } from "@/lib/swim/conditioning-presentation";
import type { SwimWorkoutView } from "@/lib/swim/view-types";
import type { ActionResult } from "@/lib/offline/outbox-core";
import { createRequestGate } from "@/lib/swim/hub-request";
import { SWIM_REFRESH_WARNING } from "@/lib/swim/action-feedback";
import { DateEditor } from "./DateEditor";
import styles from "./Swim.module.css";

export function ConditioningSwimControls({ swim, workout, busy = false, onBusyChange }: {
  swim: ConditioningSwim; workout?: SwimWorkoutView; busy?: boolean; onBusyChange?: (busy: boolean) => void;
}) {
  const router = useRouter();
  const [gate] = useState(createRequestGate);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const request = useRef<{ key: string; id: string } | null>(null);
  const controls = swim.controls;
  if (!controls) return null;
  const disabled = busy || pending || saved;
  function run(action: () => Promise<ActionResult & { warning?: string }>) {
    if (disabled) return;
    void gate(async () => {
      setError(null); setWarning(null);
      try {
        const result = await action();
        if (result.ok !== true || result.error) {
          setError(result.error ?? "Could not save this change. Try again."); return;
        }
        setSaved(true);
        setWarning(result.warning ?? null);
        try { router.refresh(); } catch { setWarning(SWIM_REFRESH_WARNING); }
      } catch { setError("Could not save this change. Try again."); }
    }, (value) => { setPending(value); onBusyChange?.(value); });
  }
  function change(input: ConditioningChange) {
    const key = JSON.stringify(input);
    if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
    const id = request.current.id;
    run(() => changeConditioningSwim(id, input));
  }
  const plan = { planId: controls.planId, planRevision: controls.planRevision };
  const target = { ...plan, workoutId: swim.id, workoutRevision: controls.workoutRevision };
  return <div className={styles.form}>
    {controls.planStatus === "active" && controls.editable && <>
      {workout?.reschedule && <DateEditor
        plan={{ id: controls.planId, revision: controls.planRevision, status: controls.planStatus }}
        workout={workout} busy={disabled} onApply={(preview) => run(() => applySwimDateEdit(preview))} />}
      {swim.status === "skipped"
        ? <button type="button" className={styles.secondary} disabled={disabled}
          onClick={() => change({ ...target, command: "unskip" })}>Undo skip</button>
        : <details className={styles.details}><summary>Skip swim</summary>
          <form className={styles.form} onSubmit={(event) => {
            event.preventDefault();
            change({ ...target, command: "skip", reason: String(new FormData(event.currentTarget).get("reason") ?? "") });
          }}>
            <label className={styles.field}>Reason<textarea name="reason" maxLength={1000} required disabled={disabled} /></label>
            <button className={styles.secondary} disabled={disabled}>Skip swim</button>
          </form>
        </details>}
    </>}
    <details className={styles.details}><summary>Swimming options</summary>
      <div className={styles.actions}>
        <button type="button" className={styles.secondary} disabled={disabled}
          onClick={() => change({ ...plan, command: controls.planStatus === "paused" ? "resume" : "pause" })}>
          {controls.planStatus === "paused" ? "Resume swimming" : "Pause swimming"}
        </button>
        <details className={styles.details}><summary>End swimming</summary>
          <button type="button" className={styles.secondary} disabled={disabled}
            onClick={() => change({ ...plan, command: "finish" })}>End swimming</button>
        </details>
      </div>
    </details>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {warning && <p role="status" className={styles.warning}>{warning}</p>}
  </div>;
}
