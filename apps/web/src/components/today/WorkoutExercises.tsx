import { Fragment } from "react";
import type { PrescriptionItem } from "@hta/db";
import { collapseIdenticalSetItems, groupByMovementThenKind, isSupplementalOnlySection, type PrescriptionMovementRow } from "@/lib/plan/prescription-grouping";
import { segmentSupersetRows, circuitNameOfRow } from "@/lib/plan/superset-grouping";
import { estimateSessionMinutes } from "@/lib/sessions/estimate-duration";
import { formatPrescriptionItem } from "@/lib/planner/archetypes";
import { splitPrescriptionChunks } from "@/lib/plan/prescription-chunks";
import { cardioPreviewRows } from "@/components/session/cardio-preview-rows";
import type { SwimWorkoutView } from "@/lib/swim/view-types";
import styles from "./Today.module.css";

function range(min: number, max: number) { return min === max ? String(min) : `${min}–${max}`; }

export function workoutDose(items: PrescriptionItem[]): { text: string; spoken: string } {
  const first = items[0];
  if (!first) return { text: "", spoken: "" };
  const sets = first.setRange ? range(first.setRange.min, first.setRange.max) : String(items.reduce((sum, item) => sum + (item.sets ?? 1), 0));
  const repItems = items.filter((item) => item.reps != null || item.repRange);
  let text: string;
  let spoken: string;
  if (repItems.length === items.length && items.every((item) => !item.holdSec && !item.bw && !item.isAmrap)) {
    const reps = range(Math.min(...repItems.map((item) => item.repRange?.min ?? item.reps!)),
      Math.max(...repItems.map((item) => item.repRange?.max ?? item.reps!)));
    text = `${sets} × ${reps}`;
    spoken = `${sets.replace("–", " to ")} ${sets === "1" ? "set" : "sets"} of ${reps.replace("–", " to ")} reps`;
  } else {
    text = collapseIdenticalSetItems(items).map((item) => {
      const formatted = formatPrescriptionItem(item);
      return item.isAmrap && item.reps != null ? `${formatted}+` : formatted;
    }).filter(Boolean).join(" · ");
    spoken = text.replaceAll("–", " to ").replaceAll("×", "by");
  }
  return { text, spoken };
}

function Row({ row, detailed = false }: { row: PrescriptionMovementRow; detailed?: boolean }) {
  const dose = workoutDose(row.items);
  const first = row.items[0];
  const load = detailed && first ? [
    first.targetWeightKg != null ? `${first.targetWeightKg} kg` : null,
    first.intensityLabel ?? (first.percentTm != null ? `${first.percentTm}% TM` : null),
  ].filter(Boolean).join(" · ") : "";
  const value = [dose.text, load].filter(Boolean).join(" · ");
  const cue = [...new Set(row.items.flatMap((item) => item.notes ? [item.notes] : item.intensityCue ? [item.intensityCue] : []))].join(" ");
  return <li className={styles.exercise} data-testid={`session-preview-movement-${row.rowKey}`}
    data-optional={detailed && first?.optional && !first.setRange ? "true" : undefined}>
    <div><span data-testid="prescription-name">{row.movementName}</span>{cue && <div className={styles.cue}>{cue}</div>}
      {detailed && first?.optional && !first.setRange && <div className={styles.cue}>Optional</div>}</div>
    <span className={styles.dose} data-testid="prescription-value" aria-label={[dose.spoken, load].filter(Boolean).join(", ")}>
      {splitPrescriptionChunks(value).map((chunk, index) => <Fragment key={index}>{index > 0 ? " · " : ""}<span data-prescription-chunk>{chunk}</span></Fragment>)}
    </span>
  </li>;
}

function Group({ title, rows, minutes, detailed = false }: {
  title: string; rows: PrescriptionMovementRow[]; minutes?: number | null; detailed?: boolean;
}) {
  if (!rows.length) return null;
  const renderRow = (row: PrescriptionMovementRow) => detailed
    ? collapseIdenticalSetItems(row.items).map((item, index) =>
      <Row key={`${row.rowKey}-${index}`} row={{ ...row, items: [item] }} detailed />)
    : <Row key={row.rowKey} row={row} />;
  return <section className={styles.group} data-testid={`session-preview-section-${title === "Warm-up rehab" ? "rehab" : title === "Main lifts" ? "strength" : title.toLowerCase()}`}>
    <h3>{title}{minutes != null && <span>~{minutes} min</span>}</h3>
    {segmentSupersetRows(rows).map((segment) => segment.kind === "solo"
      ? <ul className={styles.rows} key={segment.row.rowKey}>{renderRow(segment.row)}</ul>
      : <div className={styles.superset} role="group" aria-label={circuitNameOfRow(segment.rows[0]!) ?? "Superset"}
        data-testid="superset-cluster" key={segment.groupId}>
        <div className={styles.supersetLabel}>{circuitNameOfRow(segment.rows[0]!) ?? "Superset"}</div>
        <ul className={styles.rows}>{segment.rows.map(renderRow)}</ul>
      </div>)}
  </section>;
}

export function WorkoutExercises({ items, detailed = false }: { items: PrescriptionItem[]; detailed?: boolean }) {
  const groups = groupByMovementThenKind(items);
  const rows = (supplemental: boolean) => groups.movements.filter((group) => isSupplementalOnlySection(group) === supplemental)
    .map((group) => ({ ...group, items: group.sets.length ? group.sets.map((set) => set.item) : group.warmups }));
  return <div className={styles.groups} data-testid={detailed ? "workout-detail-preview" : "today-hero-preview"}>
    <Group title="Warm-up rehab" rows={groups.rehab} minutes={estimateSessionMinutes(groups.rehab.flatMap((row) => row.items))} detailed={detailed} />
    {detailed && <Group title="Warm-up" rows={groups.movements.filter((group) => group.warmups.length > 0)
      .map((group) => ({ ...group, items: group.warmups }))} detailed />}
    <Group title="Main lifts" rows={rows(false)} detailed={detailed} />
    <Group title="Supplemental" rows={rows(true)} detailed={detailed} />
    <Group title="Accessories" rows={[...groups.accessories, ...groups.hingeCompensations, ...groups.tendon]} detailed={detailed} />
    {groups.cardio.map((item, index) => <section className={styles.group} key={index}>
      <h3>{item.movementName ?? "Conditioning"}</h3>
      {item.cardioPlan ? <>
        <p className={styles.cardioCue}>{item.cardioPlan.summary}</p>
        <ul className={styles.rows}>
          {item.cardioPlan.segments?.map((segment, i) => <li className={styles.exercise} key={`segment-${i}`}>
            <span>{segment.label}</span><span className={styles.dose}>{segment.detail}</span>
          </li>)}
          {item.cardioPlan.stations?.map((station, i) => <li className={styles.exercise} key={`station-${i}`}>
            <span>{station.name}</span><span className={styles.dose}>{[station.load, station.target].filter(Boolean).join(" · ")}</span>
          </li>)}
        </ul>
        <p className={styles.cardioCue}>{item.cardioPlan.effort}</p>
      </> : <>
        {item.notes && <p className={styles.cardioCue}>{item.notes}</p>}
        <ul className={styles.rows}>{cardioPreviewRows(item).map((row) => <li className={styles.exercise} key={row.label}>
          <span>{row.label}</span><span className={styles.dose}>{row.value}</span>
        </li>)}</ul>
      </>}
    </section>)}
  </div>;
}

export function SwimExercises({ steps }: { steps: SwimWorkoutView["steps"] }) {
  return <div className={styles.groups}>{[...new Set(steps.map((step) => step.section))].map((section) =>
    <section className={styles.group} key={section}><h3>{section}</h3><ul className={styles.rows}>
      {steps.filter((step) => step.section === section).map((step) => <li key={step.id} className={styles.exercise}>
        <div>{step.detail}<div className={styles.cue}>{[step.effort, step.rest, step.pace].filter(Boolean).join(" · ")}</div></div>
        <span className={styles.dose}>{step.title}</span>
      </li>)}
    </ul></section>)}</div>;
}
