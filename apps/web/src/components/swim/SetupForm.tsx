"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MAX_POOL_LENGTHS, MAX_SESSION_BUDGET_MINUTES } from "@hta/domain";
import { createSwimPlan } from "@/lib/swim/actions";
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

export function SetupForm({ today }: { today: string }) {
  const router = useRouter();
  const [pool, setPool] = useState("25m");
  const [error, setError] = useState<string | null>(null);
  const [options, setOptions] = useState<string[]>([]);
  const [guidance, setGuidance] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(form: FormData) {
    setError(null);
    setOptions([]);
    setGuidance(null);
    startTransition(async () => {
      try {
        const result = await createSwimPlan(form);
        if (result.error) {
          setError(result.error);
          setOptions(result.options ?? []);
        }
        else if (result.guidance) setGuidance(result.guidance);
        else if (result.planId) {
          router.push(`/app/swim?plan=${result.planId}`);
          router.refresh();
        }
      } catch {
        setError("Could not save your swim plan. Try again.");
      }
    });
  }

  return (
    <form method="post" onSubmit={(event) => {
      event.preventDefault();
      submit(new FormData(event.currentTarget));
    }} className={styles.form}>
      <section className={styles.section}>
        <h2>Your swimming</h2>
        <label className={styles.field}>Goal
          <select name="goal" defaultValue="base">
            <option value="base">Technique & base</option><option value="endurance">Endurance</option>
          </select>
        </label>
        <label className={styles.field}>Swimming experience
          <select name="experience" defaultValue="beginner">
            <option value="beginner">Getting started</option><option value="returning">Returning to swimming</option><option value="regular">Swimming regularly</option><option value="trained">Experienced swimmer</option>
          </select>
        </label>
        <label className={styles.field}>Recent comfortable continuous lengths
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
            <label className={styles.field}>Custom pool length<input name="poolLength" maxLength={64} required placeholder="33 1/3" /></label>
            <label className={styles.field}>Unit<select name="poolUnit"><option value="m">Metres</option><option value="yd">Yards</option></select></label>
          </div>
        </>}
      </section>
      <section className={styles.section}>
        <h2>Schedule</h2>
        <fieldset className={styles.choices}><legend>Swim days</legend>
          {[[1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [0, "Sun"]].map(([value, label]) => (
            <label key={value} className={styles.choice}><input type="checkbox" name="weekdays" value={value} defaultChecked={value === 1 || value === 4} />{label}</label>
          ))}
        </fieldset>
        <div className={styles.columns}>
          <label className={styles.field}>Minutes per swim<input name="timeBudgetMinutes" type="number" min="10" max={MAX_SESSION_BUDGET_MINUTES} step="1" required defaultValue="30" /></label>
          <label className={styles.field}>Weeks<input name="weeks" type="number" min="2" max="16" step="1" required defaultValue="6" /></label>
        </div>
        <label className={styles.field}>Start date<input name="startDate" type="date" min={today} required defaultValue={today} /></label>
      </section>
      <section className={styles.section}>
        <h2>Optional targets</h2>
        <details className={styles.details}><summary>Pool event</summary>
          <label className={styles.field}>Event date<input name="eventDate" type="date" min={today} /></label>
          <div className={styles.columns}>
            <label className={styles.field}>Distance<input name="eventDistance" type="number" min="1" max="1000000" step="any" /></label>
            <label className={styles.field}>Unit<select name="eventUnit"><option value="m">Metres</option><option value="yd">Yards</option></select></label>
          </div>
        </details>
        <BenchmarkFields />
      </section>
      {error && <div role="alert">
        <p className={styles.error}>{error}</p>
        {options.length > 0 && <ul>{options.map((option) => <li key={option}>{option}</li>)}</ul>}
      </div>}
      {guidance && <p role="status" className={styles.status}>{guidance}</p>}
      <button type="submit" className={styles.button} disabled={pending}>{pending ? "Saving…" : "Create swim plan"}</button>
    </form>
  );
}
