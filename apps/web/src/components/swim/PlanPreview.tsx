import type { SwimPlanPreview } from "@/lib/swim/view-types";
import styles from "./Swim.module.css";

export function PlanPreview({ plan }: { plan: SwimPlanPreview }) {
  return (
    <section className={styles.section} aria-labelledby="swim-plan-preview-title">
      <div className={styles.previewHeading}>
        <h2 id="swim-plan-preview-title">Plan preview</h2>
        <p className={styles.muted}>
          {plan.course} · {plan.weeks.length} weeks · {plan.workoutCount} swims
        </p>
      </div>
      {plan.weeks.map((week) => (
        <details key={week.week} className={styles.previewWeek} open={week.week === plan.weeks[0]?.week}>
          <summary className={styles.previewSummary}>
            <span>
              <strong>Week {week.week}</strong>
              <small>{week.startDate}{week.provisional ? " · Provisional" : ""}</small>
            </span>
            <span>{week.total}</span>
          </summary>
          {week.workouts.length === 0 ? <p className={styles.muted}>No swims scheduled.</p> : (
            <div className={styles.previewWorkouts}>
              {week.workouts.map((workout) => (
                <details key={workout.slotId} className={styles.details}>
                  <summary className={styles.previewSummary}>
                    <span>
                      <strong>{workout.title}</strong>
                      <small>{workout.date}</small>
                    </span>
                    <span>{workout.total}</span>
                  </summary>
                  <p className={styles.muted}>{workout.budgetMinutes} min limit</p>
                  {workout.calibrationLabel && <p className={styles.muted}>{workout.calibrationLabel}</p>}
                  <ol className={styles.steps}>
                    {workout.steps.map((step) => (
                      <li key={step.id} className={styles.step}>
                        <span className={styles.muted}>{step.section}</span>
                        <div className={styles.stepTitle}><strong>{step.title}</strong><span>{step.effort}</span></div>
                        <span>{step.detail}</span>
                        <span className={styles.muted}>{step.rest}{step.pace && ` · ${step.pace}`}</span>
                        {step.guidance && <p className={styles.muted}>{step.guidance}</p>}
                      </li>
                    ))}
                  </ol>
                </details>
              ))}
            </div>
          )}
        </details>
      ))}
    </section>
  );
}
