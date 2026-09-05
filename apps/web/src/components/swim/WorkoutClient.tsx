"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_POOL_LENGTHS } from "@hta/domain";
import Link from "next/link";
import { DeleteSessionButton } from "@/components/trash/DeleteSessionButton";
import { startSwimWorkout, skipSwimWorkout, editSwimResult } from "@/lib/swim/actions";
import { enqueue, listForSession, listDeadLettered } from "@/lib/offline/outbox";
import { createOutboxEntryId } from "@/lib/offline/outbox-core";
import { flushOutbox, startAutoFlush } from "@/lib/offline/flusher";
import { formatSwimTime, parseSwimTime } from "@/lib/swim/time";
import { persistSwimDraft, readSwimDraft, swimDraftKey, type SwimDraft } from "@/lib/swim/draft";
import type { SwimWorkoutView } from "@/lib/swim/view-types";
import { SWIM_EQUIPMENT_LABEL, SWIM_STROKE_LABEL } from "@/lib/swim/presentation";
import styles from "./Swim.module.css";

export function WorkoutClient({ workout, userId, edit = false }: { workout: SwimWorkoutView; userId: string; edit?: boolean }) {
  const router = useRouter();
  const key = swimDraftKey(userId, workout.id);
  const [draft, setDraft] = useState<SwimDraft>({
    checked: [], lengths: workout.result ? String(workout.result.lengths) : "",
    time: workout.result ? formatSwimTime(workout.result.timeMs) : "",
    rpe: workout.result?.rpe != null ? String(workout.result.rpe) : "",
    notes: workout.result?.notes ?? workout.notes ?? "", reason: workout.result?.reason ?? "",
    splits: workout.result?.splits ?? "",
    stroke: "planned",
    equipment: workout.result?.equipment ?? workout.equipment,
    pool: "planned", poolNumerator: String(workout.pool.numerator),
    poolDenominator: String(workout.pool.denominator), poolUnit: workout.pool.unit,
  });
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sync, setSync] = useState<"idle" | "queued" | "saved" | "checking">("idle");
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(edit);

  useEffect(() => {
    let alive = true;
    queueMicrotask(() => {
      if (!alive) return;
      try {
        const stored = workout.result ? null : readSwimDraft(localStorage.getItem(key));
        if (stored) {
          setDraft(stored);
          if (stored.queuedId) setSync("queued");
          else if (stored.acceptedId) setSync("saved");
        }
      } catch {
        setError("Local progress is unavailable in this browser.");
      }
      setReady(true);
    });
    return () => { alive = false; };
  }, [key, workout.result]);

  useEffect(() => {
    if (!ready) return;
    try { persistSwimDraft(localStorage, key, draft, !!workout.result); }
    catch { queueMicrotask(() => setError(workout.result ? "Could not clear local progress." : "Could not keep your progress on this device.")); }
  }, [draft, key, ready, workout.result]);

  useEffect(() => {
    if (!workout.sessionId) return;
    let alive = true;
    async function checkQueue(dropped = false) {
      try {
        const [entries, failed] = await Promise.all([
          listForSession(workout.sessionId!), listDeadLettered(),
        ]);
        if (!alive) return;
        const queued = entries.find((entry) => entry.op === "swim_complete");
        const rejected = failed.find((entry) => entry.op === "swim_complete" && entry.sessionId === workout.sessionId);
        if (workout.result || draft.acceptedId) {
          setSync("saved");
          setDraft((current) => ({ ...current, queuedId: undefined }));
        } else if (queued) {
          setSync("queued");
          setDraft((current) => ({ ...current, queuedId: queued.id }));
        } else if (rejected) {
          setError(rejected.lastError ?? rejected.deadLetterReason ?? "Your swim could not be saved. Review and retry.");
          setSync("idle");
          setDraft((current) => ({ ...current, queuedId: undefined }));
        } else if (draft.queuedId) {
          if (dropped) {
            setError("Your pending swim was rejected. Review the entries and retry.");
            setSync("idle");
            setDraft((current) => ({ ...current, queuedId: undefined }));
          } else {
            setSync("checking");
            router.refresh();
          }
        }
      } catch { if (alive) setError("Could not read pending saves on this device."); }
    }
    void checkQueue();
    const stop = startAutoFlush((result) => {
      if (result.completedSessionIds.includes(workout.sessionId!)) {
        setSync("saved");
        setDraft((current) => ({ ...current, acceptedId: current.queuedId ?? current.acceptedId ?? "confirmed", queuedId: undefined }));
        router.refresh();
      } else if (result.dropped > 0) {
        void checkQueue(true);
      } else {
        void checkQueue();
      }
    });
    return () => { alive = false; stop(); };
  }, [workout.sessionId, workout.result, router, draft.queuedId, draft.acceptedId]);

  function change(field: keyof SwimDraft, value: string) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  function start() {
    setError(null);
    startTransition(async () => {
      try {
        const result = await startSwimWorkout(workout.id, workout.revision);
        if (result.error) setError(result.error);
        else router.refresh();
      } catch { setError("Connect to start this swim, then try again."); }
    });
  }

  function submit(form: FormData) {
    setError(null);
    startTransition(async () => {
      try {
        const timeMs = parseSwimTime(draft.time);
        const lengths = Number(draft.lengths);
        if (!Number.isSafeInteger(lengths) || lengths < 1 || lengths > MAX_POOL_LENGTHS) throw new Error("Enter the whole lengths you swam.");
        if (!workout.sessionId) throw new Error("Start this swim before saving.");
        const payload = {
          workoutId: workout.id, sessionId: workout.sessionId,
          lengths: String(lengths), timeMs: String(timeMs), rpe: draft.rpe,
          notes: draft.notes, reason: draft.reason, splits: draft.splits,
          stroke: draft.stroke ?? "planned",
          equipment: JSON.stringify(draft.equipment ?? workout.equipment),
          pool: draft.pool ?? "planned", poolNumerator: draft.poolNumerator ?? "",
          poolDenominator: draft.poolDenominator ?? "", poolUnit: draft.poolUnit ?? "",
          confirmPool: String(form.get("confirmPool") ?? ""),
          expectedRevision: String(workout.revision),
        };
        if (editing && workout.result) {
          const data = new FormData();
          for (const [name, value] of Object.entries(payload)) data.set(name, value);
          const result = await editSwimResult(data);
          if (result.error) { setError(result.error); return; }
          setEditing(false);
          setSync("saved");
          router.replace(`/app/swim/${workout.id}`);
          router.refresh();
          return;
        }
        const existing = (await listForSession(workout.sessionId)).find((entry) => entry.op === "swim_complete");
        if (existing) { setSync("queued"); return; }
        const receipt = createOutboxEntryId();
        const queued = await enqueue({ id: receipt, op: "swim_complete", sessionId: workout.sessionId, payload });
        if (queued.status !== "stored") throw new Error("Could not save on this device. Keep this page open and try again.");
        setDraft((current) => ({ ...current, queuedId: receipt }));
        setSync("queued");
        const result = await flushOutbox();
        if (result.completedSessionIds.includes(workout.sessionId)) {
          setSync("saved");
          setDraft((current) => ({ ...current, queuedId: undefined, acceptedId: receipt }));
          router.refresh();
        } else if (result.dropped) {
          setError("Your swim was not accepted. Review the entries and retry.");
          setSync("idle");
          setDraft((current) => ({ ...current, queuedId: undefined }));
        }
      } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not save this swim. Try again."); }
    });
  }

  const completed = !workout.sourceGone && (!!workout.result || sync === "saved");
  const canLog = !!workout.sessionId && !workout.deleted && !workout.sourceGone && (!completed || editing);
  return (
    <>
      <section className={styles.section}>
        <div className={styles.actions}><p className={styles.distance}>{workout.total}</p><span className={styles.muted}>{workout.course}</span></div>
        <p className={styles.muted}>{workout.date} · {workout.budgetMinutes} min budget{workout.provisional && !workout.sessionId ? " · Provisional" : ""}</p>
        {workout.calibrationLabel && <p className={styles.muted}>{workout.calibrationLabel}</p>}
        {!workout.sessionId && workout.status === "scheduled" && workout.planStatus === "active" && (
          <button className={styles.button} disabled={pending} onClick={start}>{pending ? "Starting…" : "Start swim"}</button>
        )}
        {canLog && <a href="#swim-result" className={styles.secondary}>Log swim</a>}
        {!workout.sessionId && workout.status === "scheduled" && workout.planStatus !== "active" && (
          <p role="status" className={styles.muted}>{({ paused: "Plan paused", finished: "Plan finished", archived: "Plan archived" })[workout.planStatus]}</p>
        )}
        {workout.deleted && <Link href="/app/settings/trash" className={styles.secondary}>Restore from Trash</Link>}
        {workout.sourceGone && <p role="status" className={styles.muted}>Result removed</p>}
        {sync === "queued" && !workout.sourceGone && <p role="status" className={styles.status}>Saved on this device · Waiting to sync</p>}
        {completed && !editing && <p role="status" className={styles.status}>Swim saved</p>}
        {sync === "checking" && !workout.sourceGone && <p role="status" className={styles.status}>Checking saved swim…</p>}
      </section>
      <section className={styles.section}>
        <h2>Workout</h2>
        <ol className={styles.steps}>
          {workout.steps.map((step) => (
            <li key={step.id} className={styles.step} data-done={draft.checked.includes(step.id)}>
              <div className={styles.stepTitle}><span>{step.section}</span><span>{step.title}</span></div>
              <p className={styles.muted}>{step.detail}</p>
              <p className={styles.muted}>{step.effort} · {step.rest}{step.pace ? ` · ${step.pace}` : ""}</p>
              {workout.sessionId && !completed && !workout.deleted && !workout.sourceGone && <label className={styles.choice}>
                <input type="checkbox" aria-label={`Mark ${step.section}, ${step.title} done`} checked={draft.checked.includes(step.id)} disabled={!ready || sync === "queued"} onChange={(event) => {
                  setDraft((current) => ({ ...current, checked: event.target.checked ? [...current.checked, step.id] : current.checked.filter((id) => id !== step.id) }));
                }} />Done
              </label>}
            </li>
          ))}
        </ol>
      </section>
      {completed && !editing && workout.result && <section className={styles.section}>
        <h2>Your swim</h2>
        <p>{workout.result.lengths} lengths · {formatSwimTime(workout.result.timeMs)}{workout.result.rpe != null ? ` · RPE ${workout.result.rpe}` : ""}</p>
        {workout.result.course && <p className={styles.muted}>{workout.result.course}</p>}
        {workout.result.notes && <p className={styles.muted}>{workout.result.notes}</p>}
        {!workout.deleted && <button className={styles.secondary} onClick={() => setEditing(true)}>Edit result</button>}
      </section>}
      {canLog && <form id="swim-result" action={submit} className={styles.section}>
        <h2>{editing ? "Edit your swim" : "Log your swim"}</h2>
        <fieldset className={styles.formFields} disabled={pending || !ready || sync === "queued"} aria-label="Swim result">
        <div className={styles.columns}>
          <label className={styles.field}>Whole lengths<input type="number" min="1" max={MAX_POOL_LENGTHS} step="1" required value={draft.lengths} onChange={(event) => change("lengths", event.target.value)} /></label>
          <label className={styles.field}>Time · min:sec<input required placeholder="18:30.000" value={draft.time} onChange={(event) => change("time", event.target.value)} /></label>
        </div>
        <label className={styles.field}>Effort · RPE (optional)<input type="number" min="0" max="10" step="0.1" value={draft.rpe} onChange={(event) => change("rpe", event.target.value)} /></label>
        <details className={styles.details}>
          <summary>Notes, changes and splits</summary>
          <label className={styles.field}>Notes<textarea rows={2} maxLength={2000} value={draft.notes} onChange={(event) => change("notes", event.target.value)} /></label>
          <label className={styles.field}>Changed or skipped work<textarea rows={2} maxLength={1000} value={draft.reason} onChange={(event) => change("reason", event.target.value)} /></label>
          <label className={styles.field}>Stroke<select value={draft.stroke ?? "planned"} onChange={(event) => change("stroke", event.target.value)}>
            <option value="planned">{(workout.result?.strokes ?? workout.strokes).map((stroke) => SWIM_STROKE_LABEL[stroke as keyof typeof SWIM_STROKE_LABEL]).join(", ")}</option>
            {Object.entries(SWIM_STROKE_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
          <fieldset className={styles.choices}><legend>Equipment used</legend>
            {Object.entries(SWIM_EQUIPMENT_LABEL).map(([value, label]) => <label key={value} className={styles.choice}>
              <input type="checkbox" checked={(draft.equipment ?? workout.equipment).includes(value)} onChange={(event) => {
                setDraft((current) => {
                  const equipment = current.equipment ?? workout.equipment;
                  return { ...current, equipment: event.target.checked ? [...equipment, value] : equipment.filter((piece) => piece !== value) };
                });
              }} />{label}
            </label>)}
          </fieldset>
          <label className={styles.field}>Pool used<select value={draft.pool ?? "planned"} onChange={(event) => change("pool", event.target.value)}>
            <option value="planned">{workout.result?.course ?? workout.course}</option><option value="25m">25 metres</option><option value="50m">50 metres</option><option value="25yd">25 yards</option><option value="custom">Custom</option>
          </select></label>
          {draft.pool === "custom" && <>
            <div className={styles.columns}>
              <label className={styles.field}>Length numerator<input type="number" min="1" required value={draft.poolNumerator} onChange={(event) => change("poolNumerator", event.target.value)} /></label>
              <label className={styles.field}>Length denominator<input type="number" min="1" required value={draft.poolDenominator} onChange={(event) => change("poolDenominator", event.target.value)} /></label>
            </div>
            <label className={styles.field}>Unit<select value={draft.poolUnit} onChange={(event) => change("poolUnit", event.target.value)}><option value="m">Metres</option><option value="yd">Yards</option></select></label>
          </>}
          {draft.pool && draft.pool !== "planned" && <label className={styles.choice}><input type="checkbox" name="confirmPool" required />Use this pool for my result</label>}
          <label className={styles.field}>Splits · lengths, min:sec<textarea rows={3} placeholder={"4, 2:10.000\n4, 2:15.000"} value={draft.splits} onChange={(event) => change("splits", event.target.value)} /></label>
        </details>
        </fieldset>
        <button className={styles.button} disabled={pending || !ready || sync === "queued"}>{pending ? "Saving…" : editing ? "Save changes" : sync === "queued" ? "Waiting to sync" : "Finish swim"}</button>
        {editing && <button type="button" className={styles.secondary} onClick={() => setEditing(false)}>Cancel</button>}
      </form>}
      {!workout.sessionId && workout.status === "scheduled" && workout.planStatus === "active" && <form action={(form) => {
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
          <button className={styles.secondary} disabled={pending}>Skip swim</button>
        </details>
      </form>}
      {error && <p role="alert" className={styles.error}>{error}</p>}
      {workout.sessionId && !workout.deleted && !workout.sourceGone && sync !== "queued" && (
        <DeleteSessionButton sessionId={workout.sessionId} label="Swim" redirectTo="/app/swim" variant="menu" />
      )}
    </>
  );
}
