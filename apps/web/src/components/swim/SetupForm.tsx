"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { DEFAULT_SWIM_POOL, MAX_POOL_LENGTHS, MAX_SESSION_BUDGET_MINUTES, SWIM_WEEKDAYS, swimScheduleAdvice, type TrainingCommitment } from "@hta/domain";
import { createSwimPlan, previewSwimPlan } from "@/lib/swim/actions";
import type { SwimSetupPreview } from "@/lib/swim/view-types";
import { PlanPreview } from "./PlanPreview";
import styles from "./Swim.module.css";

export function BenchmarkFields() {
  return (
    <details className={styles.details}>
      <summary>200 / 400 assessment (optional)</summary>
      <div className={styles.columns}>
        <label className={styles.field}>200 time · min:sec<input name="time200" placeholder="3:45.000" /></label>
        <label className={styles.field}>400 time · min:sec<input name="time400" placeholder="7:50.000" /></label>
      </div>
      <label className={styles.field}>Swum on<input name="benchmarkDate" type="date" /></label>
      <label className={styles.field}>Assessment stroke<StrokeSelect name="benchmarkStroke" /></label>
      <label className={styles.choice}>
        <input name="verified" type="checkbox" />
        Verified times, same pool and stroke, without equipment
      </label>
    </details>
  );
}

export function StrokeSelect({ name, defaultValue = "freestyle" }: { name: string; defaultValue?: string }) {
  return <select name={name} defaultValue={defaultValue}>
    <option value="freestyle">Freestyle</option>
    <option value="backstroke">Backstroke</option>
    <option value="breaststroke">Breaststroke</option>
    <option value="butterfly">Butterfly</option>
  </select>;
}

export function SetupForm({ today, schedule = [] }: { today: string; schedule?: TrainingCommitment[] }) {
  const router = useRouter();
  const [pool, setPool] = useState(`${DEFAULT_SWIM_POOL.numerator}m`);
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [startDate, setStartDate] = useState(today);
  const [weeks, setWeeks] = useState(6);
  const [days, setDays] = useState(() => swimScheduleAdvice({ blockId: null, sessions: schedule }, today, 6).defaults);
  const [preview, setPreview] = useState<SwimSetupPreview | null>(null);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const request = useRef(0);
  const requestId = useRef<string | null>(null);
  const busy = useRef(false);
  const [operation, setOperation] = useState<"preview" | "create" | null>(null);
  const end = Date.parse(`${startDate}T00:00:00Z`) + weeks * 7 * 86_400_000;
  const commitments = schedule.filter((entry) => entry.date >= startDate && Date.parse(`${entry.date}T00:00:00Z`) < end);

  function submit(form: FormData, mode: "preview" | "create") {
    if (busy.current || savedId) return;
    if (mode === "create") {
      if (!preview || !requestId.current) { setError("Preview the plan before saving."); return; }
      form.set("requestId", requestId.current);
      form.set("previewId", preview.id);
    }
    busy.current = true;
    const revision = ++request.current;
    setOperation(mode);
    if (mode === "preview") { setPreview(null); setAcceptOverlap(false); }
    setError(null);
    setOptions([]);
    setGuidance(null);
    startTransition(async () => {
      try {
        const result = await (mode === "preview" ? previewSwimPlan(form) : createSwimPlan(form));
        if (mode === "preview" && revision !== request.current) return;
        if (result.error) {
          setError(result.error);
          setOptions(result.options ?? []);
        }
        else if (result.guidance) setGuidance(result.guidance);
        else if (result.preview) { requestId.current = crypto.randomUUID(); setPreview(result.preview); }
        else if (result.planId) {
          setSavedId(result.planId);
          if (result.warning) setWarning(result.warning);
          else { router.push(`/app/swim?plan=${result.planId}`); router.refresh(); }
        }
      } catch {
        if (mode !== "preview" || revision === request.current) {
          setError(mode === "preview" ? "Could not preview your swim plan. Try again." : "Could not save your swim plan. Try again.");
        }
      } finally {
        busy.current = false;
        if (revision === request.current) setOperation(null);
      }
    });
  }

  return (
    <form method="post" onSubmit={(event) => {
      event.preventDefault();
      const submitter = (event.nativeEvent as SubmitEvent | undefined)?.submitter;
      submit(new FormData(event.currentTarget), submitter?.getAttribute("value") === "preview" ? "preview" : "create");
    }} className={styles.form}>
      <fieldset className={styles.formFields} disabled={pending || !!savedId}
        onChange={() => { request.current++; setPreview(null); requestId.current = null; setAcceptOverlap(false); setError(null); }}>
      <section className={styles.section}>
        <h2>Training</h2>
        <label className={styles.field}>Goal
          <select name="goal" defaultValue="base">
            <option value="base">Technique & base</option><option value="endurance">Endurance</option>
          </select>
        </label>
        <label className={styles.field}>Experience
          <select name="experience" defaultValue="beginner">
            <option value="beginner">Beginner</option><option value="returning">Returning</option><option value="regular">Regular swimmer</option><option value="trained">Experienced</option>
          </select>
        </label>
        <label className={styles.field}>Recent comfortable non-stop lengths
          <input name="comfortableLengths" type="number" required min="0" max={MAX_POOL_LENGTHS} step="1" defaultValue="1" />
        </label>
        <fieldset className={styles.choices}><legend>Known strokes</legend>
          {[["freestyle", "Freestyle"], ["backstroke", "Backstroke"], ["breaststroke", "Breaststroke"], ["butterfly", "Butterfly"]].map(([value, label]) => (
            <label key={value} className={styles.choice}><input type="checkbox" name="strokes" value={value} defaultChecked={value === "freestyle"} />{label}</label>
          ))}
        </fieldset>
        <fieldset className={styles.choices}><legend>Equipment</legend>
          {[["kickboard", "Kickboard"], ["pull_buoy", "Pull buoy"], ["fins", "Fins"], ["paddles", "Paddles"], ["snorkel", "Snorkel"]].map(([value, label]) => (
            <label key={value} className={styles.choice}><input type="checkbox" name="equipment" value={value} />{label}</label>
          ))}
        </fieldset>
      </section>
      <section className={styles.section}>
        <h2>Pool</h2>
        <label className={styles.field}>Pool length
          <select name="pool" value={pool} onChange={(event) => setPool(event.target.value)}>
            <option value="25m">25 metres</option><option value="50m">50 metres</option><option value="25yd">25 yards</option><option value="custom">Custom</option>
          </select>
        </label>
        {pool === "custom" && <>
          <div className={styles.columns}>
            <label className={styles.field}>Custom length<input name="poolLength" maxLength={64} required placeholder="33 1/3" /></label>
            <label className={styles.field}>Unit<select name="poolUnit"><option value="m">Metres</option><option value="yd">Yards</option></select></label>
          </div>
        </>}
      </section>
      <section className={styles.section}>
        <h2>Schedule</h2>
        <fieldset className={styles.choices}><legend>Swim days</legend>
          {SWIM_WEEKDAYS.map(({ value, label }) => {
            const dates = commitments.filter((entry) => new Date(`${entry.date}T00:00:00Z`).getUTCDay() === value);
            const work = dates.filter((entry) => entry.state !== "rest" && entry.state !== "paused");
            return (
            <label key={value} className={styles.choice}><input type="checkbox" name="weekdays" value={value} checked={days.includes(value)}
              onChange={(event) => setDays(event.target.checked ? [...days, value] : days.filter((day) => day !== value))} />
              <span>{label.slice(0, 3)}{work.length ? <small className={styles.muted}> · {work.length} scheduled</small>
                : dates.some((entry) => entry.state === "rest") ? <small className={styles.muted}> · Planned rest</small> : null}</span></label>
          ); })}
        </fieldset>
        {!!commitments.length && <details className={styles.details}><summary>Scheduled training</summary>
          <ul className={styles.list}>{commitments.map((entry) =>
            <li key={`${entry.source}:${entry.id}`} className={styles.row}><span>{entry.date}</span><span>{entry.title}</span></li>)}</ul>
        </details>}
        <div className={styles.columns}>
          <label className={styles.field}>Minutes per swim<input name="timeBudgetMinutes" type="number" min="10" max={MAX_SESSION_BUDGET_MINUTES} step="1" required defaultValue="30" /></label>
          <label className={styles.field}>Weeks<input name="weeks" type="number" min="2" max="16" step="1" required value={weeks} onChange={(event) => setWeeks(Number(event.target.value))} /></label>
        </div>
        <label className={styles.field}>Start date<input name="startDate" type="date" min={today} required value={startDate} onChange={(event) => setStartDate(event.target.value)} /></label>
      </section>
      <section className={styles.section}>
        <h2>Targets</h2>
        <details className={styles.details}><summary>Pool event</summary>
          <label className={styles.field}>Event date<input name="eventDate" type="date" min={today} /></label>
          <div className={styles.columns}>
            <label className={styles.field}>Distance<input name="eventDistance" type="number" min="1" max="1000000" step="any" /></label>
            <label className={styles.field}>Unit<select name="eventUnit"><option value="m">Metres</option><option value="yd">Yards</option></select></label>
          </div>
        </details>
        <BenchmarkFields />
      </section>
      </fieldset>
      {preview && <PlanPreview plan={preview} />}
      {!!preview?.overlaps.length && <section className={styles.section}>
        <ul className={styles.list}>{preview.overlaps.map((entry) =>
          <li key={`${entry.source}:${entry.id}`} className={styles.row}><span>{entry.date}</span><span>{entry.title}</span></li>)}</ul>
        <label className={styles.choice}><input name="acceptOverlap" type="checkbox" checked={acceptOverlap}
          onChange={(event) => setAcceptOverlap(event.target.checked)} disabled={pending || !!savedId} />
          Keep both workouts on these dates
        </label>
      </section>}
      {error && <div role="alert">
        <p className={styles.error}>{error}</p>
        {options.length > 0 && <ul>{options.map((option) => <li key={option}>{option}</li>)}</ul>}
      </div>}
      {guidance && <p role="status" className={styles.status}>{guidance}</p>}
      {warning && <p role="status" className={styles.warning}>{warning}</p>}
      {savedId && <a className={styles.button} href={`/app/swim?plan=${savedId}`}>Open swimming plan</a>}
      <div className={styles.actions}>
        <button type="submit" name="intent" value="preview" className={styles.secondary} disabled={pending || !!savedId}>
          {pending && operation === "preview" ? "Preparing…" : "Preview plan"}
        </button>
        {preview && <button type="submit" className={styles.button} disabled={pending || !!savedId || (!!preview.overlaps.length && !acceptOverlap)}>
          {pending && operation === "create" ? "Saving…" : "Create swim plan"}
        </button>}
      </div>
    </form>
  );
}
