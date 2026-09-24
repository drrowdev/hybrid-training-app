"use client";

import Link from "next/link";
import { ProgramDialog, ProgramIcon } from "./ProgramDialog";
import type { ProgramOverviewItem } from "./ProgramsOverview";
import styles from "./ProgramBuilder.module.css";

export const PROGRAM_TYPES = ["strength", "running", "swimming", "hybrid"] as const;
export type ProgramType = typeof PROGRAM_TYPES[number];
export const PROGRAM_LABELS = { strength: "Strength", running: "Running", swimming: "Swimming", hybrid: "Hybrid" };
const TEMPLATES = {
  strength: [{ id: "wendler-531", name: "5/3/1" }, { id: "tactical-barbell", name: "Tactical Barbell" }],
  hybrid: [{ id: "green-protocol", name: "Green Protocol" }, { id: "hyrox", name: "HYROX" }],
};

export function NewProgramChooser({ programs, type, swimHref, onSelect, onClose }: {
  programs: readonly ProgramOverviewItem[]; type: ProgramType | null; swimHref: string | null;
  onSelect: (type: ProgramType | null) => void; onClose: () => void;
}) {
  const legacy = programs.find((program) => program.kind === null);
  const occupied = programs.find((program) => program.kind === type);
  return <ProgramDialog title={type ? `New ${PROGRAM_LABELS[type].toLowerCase()} program` : "New program"}
    onClose={onClose} onBack={type ? () => onSelect(null) : undefined}>
    {type ? <>
      {occupied && <p className={styles.replaces}>Replaces {occupied.name}</p>}
      <div className={styles.programList}>
        <Link className={`${styles.setupRow} ${styles.buildRow}`} href={`/app/program/build?activity=${type}`}>
          <span><ProgramIcon kind="plus" />Build your own</span><ProgramIcon kind="chevron" />
        </Link>
      </div>
      {(type === "strength" || type === "hybrid") && <>
        <h3 className={styles.templatesHeading}>Templates</h3>
        <div className={styles.programList}>
          {TEMPLATES[type].map((template) => <Link key={template.id} className={styles.setupRow}
            href={`/app/program?program=${template.id}`}><span>{template.name}</span><ProgramIcon kind="chevron" /></Link>)}
        </div>
      </>}
    </> : <div className={styles.typeOptions}>
      {PROGRAM_TYPES.map((kind) => {
        const program = programs.find((candidate) => candidate.kind === kind);
        const locked = !!legacy && kind !== "swimming";
        return <button key={kind} type="button" className={styles.typeOption} data-kind={kind}
          disabled={locked || (kind === "swimming" && !program && !swimHref)} onClick={() => onSelect(kind)}>
          <span className={styles.typeIcon}><ProgramIcon kind={kind} /></span>
          <span><strong>{PROGRAM_LABELS[kind]}</strong>
            {locked ? <small><ProgramIcon kind="lock" />End {legacy.name} first</small>
              : kind === "swimming" && program ? <small>End {program.name} first</small>
              : program ? <small><ProgramIcon kind="swap" />Replace {program.name}</small>
                : kind === "hybrid" ? <small>Combine training types</small> : null}
          </span>
        </button>;
      })}
    </div>}
  </ProgramDialog>;
}
