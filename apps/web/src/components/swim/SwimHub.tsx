"use client";

import Link from "next/link";
import { useState } from "react";
import {
  proposeSwimWeek, proposeSwimBenchmark, decideSwimProposal,
  changeSwimPlanStatus, previewSwimResume, resumeSwimPlan,
  decideSwimBenchmark, applySwimWeekEdit, applySwimDateEdit,
} from "@/lib/swim/actions";
import { nextSwimHubView, type SwimHubView, type SwimResumePreview } from "@/lib/swim/view-types";
import type { SwimBenchmarkPreview } from "@/lib/swim/model";
import type { ActionResult } from "@/lib/offline/outbox-core";
import { createRequestGate } from "@/lib/swim/hub-request";
import { PageHeader } from "@/components/ui/PageHeader";
import { BenchmarkFields } from "./SetupForm";
import { WeekEditor } from "./WeekEditor";
import { DateEditor } from "./DateEditor";
import styles from "./Swim.module.css";

export function SwimHub({ plan: incomingPlan, plans, setupEnabled }: {
  plan: SwimHubView;
  plans: { id: string; startedOn: string; status: SwimHubView["status"] }[];
  setupEnabled: boolean;
}) {
  const [heldPlan, setPlan] = useState(incomingPlan);
  const plan = nextSwimHubView(heldPlan, incomingPlan, "props");
  if (plan !== heldPlan) setPlan(plan);
  const choices = plans.map((choice) => choice.id === plan.id ? { ...choice, status: plan.status } : choice);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [requestGate] = useState(createRequestGate);
  const [requestBusy, setRequestBusy] = useState(false);
  const [preview, setPreview] = useState<SwimResumePreview | null>(null);
  const [benchmark, setBenchmark] = useState<SwimBenchmarkPreview | null>(null);

  function run(action: () => Promise<ActionResult & { warning?: string; refreshWarning?: string; view?: SwimHubView }>) {
    void requestGate(async () => {
      setError(null);
      setWarnings([]);
      try {
        const result = await action();
        if (!result || result.ok !== true || result.error || result.errorCode) {
          setError(result?.error || "Could not save this change. Try again.");
          return;
        }
        const view = result.view;
        if (view) setPlan((current) => nextSwimHubView(current, view, "confirmed"));
        setWarnings([result.warning, result.refreshWarning].filter((warning): warning is string => !!warning));
        setPreview(null);
        setBenchmark(null);
      } catch { setError("Could not save this change. Try again."); return; }
    }, setRequestBusy);
  }
  const editable = plan.status === "active" || plan.status === "paused";
  return (
    <>
      <PageHeader title="Swimming" back={{ href: "/app/plan", label: "Plan" }}
        actions={setupEnabled && !choices.some((choice) => choice.status === "active")
          ? <Link href="/app/swim/setup" className={styles.button}>Set up swimming</Link> : undefined} />
      {choices.length > 1 && <nav className={styles.actions} aria-label="Swim plans">
        {choices.map((choice) => <Link key={choice.id} href={`/app/swim?plan=${choice.id}`} className={styles.secondary} aria-current={choice.id === plan.id ? "page" : undefined}>
          {choice.startedOn} · {({ active: "Active", paused: "Paused", finished: "Finished", archived: "Archived" })[choice.status]}
        </Link>)}
      </nav>}
      <section className={styles.section}>
        <h2>{plan.goal}</h2>
        <p className={styles.muted}>{plan.course} · {plan.dates}</p>
        {plan.assessment && <p className={styles.muted}>{plan.assessment.label} · {plan.assessment.pace}</p>}
        <p className={styles.status}>{({ active: "Active", paused: "Paused", finished: "Finished", archived: "Archived" })[plan.status]}</p>
        {plan.status === "active" && <button className={styles.secondary} disabled={requestBusy} onClick={() => run(() => proposeSwimWeek(plan.id, plan.revision))}>Review next week</button>}
      </section>
      {warnings.map((warning, index) => <p key={index} role="status" className={styles.warning}>{warning}</p>)}
      {plan.proposals.filter((proposal) => proposal.status === "pending").map((proposal) => (
        <section key={proposal.id} className={styles.section}>
          <h2>{proposal.title}</h2>
          <p className={styles.muted}>{proposal.detail}</p>
          {!!proposal.excludedCount && <p className={styles.muted}>{proposal.excludedCount} {proposal.excludedCount === 1 ? "swim" : "swims"} excluded</p>}
          {proposal.changes.length > 0 && <ul className={styles.list}>
            {proposal.changes.map((change, index) => <li className={styles.row} key={index}>
              <span>{change.title}</span><span>{change.before} → {change.after}</span>
            </li>)}
          </ul>}
          {editable && <>
            <div className={styles.actions}>
              <button className={styles.button} disabled={requestBusy} onClick={() => run(() => decideSwimProposal(plan.id, plan.revision, proposal.id, "accepted"))}>Accept</button>
              <button className={styles.secondary} disabled={requestBusy} onClick={() => run(() => decideSwimProposal(plan.id, plan.revision, proposal.id, "rejected"))}>Reject</button>
            </div>
            {proposal.kind === "week" && <details className={styles.details}><summary>Choose a different week</summary>
              <form className={styles.form} method="post" onSubmit={(event) => {
                event.preventDefault();
                const form = new FormData(event.currentTarget);
                run(() => decideSwimProposal(
                  plan.id, plan.revision, proposal.id, "overridden",
                  String(form.get("repeats")), String(form.get("reason")),
                ));
              }}>
                <label className={styles.field}>Main repeats<input name="repeats" type="number" min="1" max="2000" defaultValue={proposal.mainRepeats} required /></label>
                <label className={styles.field}>Reason<textarea name="reason" maxLength={1000} required /></label>
                <button className={styles.secondary} disabled={requestBusy}>Apply my choice</button>
              </form>
            </details>}
          </>}
        </section>
      ))}
      <section className={styles.section}>
        <h2>Swims</h2>
        <ul className={styles.list}>
          {plan.workouts.map((workout) => <li key={workout.id} className={styles.scheduledRow}>
            <Link href={`/app/swim/${workout.id}`} className={styles.row}>
              <span><strong>{workout.title}</strong><small>{workout.date} · Week {workout.week}{workout.provisional && workout.status === "Scheduled" ? " · Provisional" : ""}</small></span>
              <span>{workout.total}<small>{workout.status}</small></span>
            </Link>
            {workout.reschedule && <DateEditor key={`${plan.revision}:${workout.reschedule.revision}`}
              plan={plan} workout={workout} busy={requestBusy} onApply={(changes) => run(() => applySwimDateEdit(changes))} />}
          </li>)}
        </ul>
      </section>
      {editable && !!plan.editableWeeks?.length && <WeekEditor
        key={JSON.stringify([plan.id, plan.revision, plan.today, plan.editableWeeks])}
        plan={plan} busy={requestBusy} onApply={(changes) => run(() => applySwimWeekEdit(changes))} />}
      {!!(plan.analytics.weeks.length || plan.analytics.bests.length || plan.analytics.benchmarks.length) && <section className={styles.section}>
        <h2>Swimming history</h2>
        {plan.analytics.weeks.length > 0 && <div className={styles.tableWrap}>
          <table className={styles.table}>
            <caption className={styles.muted}>Weekly distance by pool</caption>
            <thead><tr><th scope="col">Week</th><th scope="col">Pool</th><th scope="col">Planned</th><th scope="col">Swum</th><th scope="col">Swims</th><th scope="col">Adherence</th></tr></thead>
            <tbody>{plan.analytics.weeks.map((week, index) => <tr key={index}>
              <th scope="row">{week.week}</th><td>{week.course}</td><td>{week.planned}</td><td>{week.actual}</td><td>{week.frequency}</td><td>{week.adherence}</td>
            </tr>)}</tbody>
          </table>
        </div>}
        {plan.analytics.bests.length > 0 && <>
          <h3>Best swims</h3>
          <ul className={styles.list}>{plan.analytics.bests.map((best, index) => <li className={styles.row} key={index}>
            <span>{best.label}<small>{best.date}</small></span><strong>{best.time}</strong>
          </li>)}</ul>
        </>}
        {plan.analytics.benchmarks.length > 0 && <>
          <h3>Assessment history</h3>
          <ul className={styles.list}>{plan.analytics.benchmarks.map((benchmark, index) => <li className={styles.row} key={index}>
            <span>{benchmark.label}<small>{benchmark.date}</small></span><strong>{benchmark.pace}</strong>
          </li>)}</ul>
        </>}
      </section>}
      {editable && <section className={styles.section}>
        <h2>New assessment</h2>
        <form className={styles.form} method="post" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void requestGate(async () => {
            setError(null);
            try {
              const result = await proposeSwimBenchmark(plan.id, plan.revision, form);
              if (result.error) setError(result.error);
              else if (result.preview) setBenchmark(result.preview);
            } catch { setError("Could not review this assessment. Try again."); }
          }, setRequestBusy);
        }}>
          <BenchmarkFields />
          <button className={styles.secondary} disabled={requestBusy}>Review assessment</button>
        </form>
        {benchmark && <>
          <ul className={styles.list}>{benchmark.changes.map((change, index) => <li key={index} className={styles.row}>
            <span>{change.title}<small>{change.before}</small></span><strong>{change.after}</strong>
          </li>)}</ul>
          <div className={styles.actions}>
            <button className={styles.button} disabled={requestBusy} onClick={() => run(() => decideSwimBenchmark(plan.id, benchmark, "accepted"))}>Accept assessment</button>
            <button className={styles.secondary} disabled={requestBusy} onClick={() => run(() => decideSwimBenchmark(plan.id, benchmark, "rejected"))}>Reject assessment</button>
          </div>
        </>}
      </section>}
      <section className={styles.section}>
        <h2>Manage plan</h2>
        {plan.status === "paused" && <form className={styles.form} method="post" onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          void requestGate(async () => {
            setError(null);
            try {
              const result = await previewSwimResume(plan.id, plan.revision, String(form.get("startDate")));
              if (result.error) setError(result.error);
              else if (result.preview) setPreview(result.preview);
            } catch { setError("Could not preview new dates. Try again."); }
          }, setRequestBusy);
        }}>
          <label className={styles.field}>Resume from<input type="date" name="startDate" min={plan.today} defaultValue={plan.today} required /></label>
          <button className={styles.secondary} disabled={requestBusy}>Preview dates</button>
        </form>}
        {preview && <div className={styles.form}>
          <h3>New swim dates</h3>
          <ul className={styles.list}>{preview.dates.map((item) => <li key={item.id} className={styles.row}>{item.date}</li>)}</ul>
          <button className={styles.button} disabled={requestBusy} onClick={() => run(() => resumeSwimPlan(preview))}>Accept dates and resume</button>
        </div>}
        <div className={styles.actions}>
          {plan.status === "active" && <button className={styles.secondary} disabled={requestBusy} onClick={() => run(() => changeSwimPlanStatus(plan.id, plan.revision, "paused"))}>Pause</button>}
          {editable && <button className={styles.secondary} disabled={requestBusy} onClick={() => run(() => changeSwimPlanStatus(plan.id, plan.revision, "finished"))}>Finish plan</button>}
          {plan.status !== "archived" && <button className={styles.secondary} disabled={requestBusy} onClick={() => run(() => changeSwimPlanStatus(plan.id, plan.revision, "archived"))}>Archive</button>}
        </div>
        {plan.proposals.some((proposal) => proposal.status !== "pending") && <details className={styles.details}>
          <summary>Past decisions</summary>
          <ul className={styles.list}>{plan.proposals.filter((proposal) => proposal.status !== "pending").map((proposal) => <li key={proposal.id} className={styles.row}>
            <span>{proposal.title}<small>{proposal.detail}</small>{proposal.warning && <small className={styles.warning}>{proposal.warning}</small>}</span><span>{({ accepted: "Accepted", rejected: "Rejected", overridden: "Overridden" } as Record<string, string>)[proposal.status]}</span>
          </li>)}</ul>
        </details>}
      </section>
      {error && <p role="alert" className={styles.error}>{error}</p>}
    </>
  );
}
