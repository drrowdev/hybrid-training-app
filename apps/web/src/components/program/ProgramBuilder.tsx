"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import {
  authoredProgramDates, commitmentWeekday, formatAuthoredInterval,
  type AuthoredCatalogMovement, type AuthoredMovement, type AuthoredProgramDefinition,
  type AuthoredWorkout, type AuthoredWorkoutPart, type ProgramActivity, type TrainingCommitment,
} from "@hta/domain";
import { previewAuthoredProgram, saveAuthoredProgram, type AuthoredPreview } from "@/lib/programs/authored/actions";
import { restSecondsForKind } from "@/lib/sessions/rest";
import styles from "./ProgramBuilder.module.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const STEPS = ["Type", "Setup", "Week", "Workout", "Review"];
const ACTIVITY_LABELS: Record<ProgramActivity, string> = { strength: "Strength", running: "Running", hybrid: "Hybrid" };
const newId = () => crypto.randomUUID();
function newMovement(movementId = ""): AuthoredMovement {
  return { id: newId(), movementId, role: "main", sets: 3, dose: { kind: "reps", reps: 5 }, restSeconds: restSecondsForKind("main"), notes: "" };
}

function LibraryPicker({ catalog, value, onChange }: {
  catalog: AuthoredCatalogMovement[]; value: string; onChange: (movement: AuthoredCatalogMovement) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = catalog.find((movement) => movement.id === value);
  const [open, setOpen] = useState(!selected);
  const matches = catalog.filter((movement) =>
    `${movement.displayName} ${movement.pattern}`.toLowerCase().includes(query.toLowerCase())).slice(0, 20);
  return <div className={styles.library}>
    <div className={styles.row}>
      <strong>{selected?.displayName ?? "Choose an exercise"}</strong>
      {selected && <button type="button" className={styles.button} onClick={() => setOpen(!open)}>{open ? "Close library" : "Swap"}</button>}
    </div>
    {open && <>
      <label className={styles.field}>Search library<input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Name or movement pattern" /></label>
      <div className={styles.results}>
        {matches.map((movement) => <button type="button" className={styles.result} aria-pressed={movement.id === value} key={movement.id}
          onClick={() => { onChange(movement); setOpen(false); }}>{movement.displayName}</button>)}
        {matches.length === 0 && <p className={styles.muted}>No matching exercises.</p>}
      </div>
    </>}
  </div>;
}

function MovementEditor({ movement, catalog, onChange, inCircuit }: {
  movement: AuthoredMovement; catalog: AuthoredCatalogMovement[]; onChange: (movement: AuthoredMovement) => void; inCircuit?: boolean;
}) {
  const update = (patch: Partial<AuthoredMovement>) => onChange({ ...movement, ...patch });
  return <div className={styles.panel}>
    <LibraryPicker catalog={catalog.filter((entry) => entry.pattern !== "cardio")} value={movement.movementId}
      onChange={(selected) => update({ movementId: selected.id })} />
    <div className={styles.fields}>
      <label className={styles.field}>Role<select className={styles.select} value={movement.role} onChange={(event) => {
        const role = event.target.value as AuthoredMovement["role"];
        update({ role, restSeconds: restSecondsForKind(role) });
      }}><option value="main">Main lift</option><option value="accessory">Accessory</option><option value="tendon">Rehab</option></select></label>
      {!inCircuit && <label className={styles.field}>Sets<input className={styles.input} type="number" min={1} max={20} value={movement.sets} onChange={(event) => update({ sets: Number(event.target.value) })} /></label>}
      <label className={styles.field}>Measure<select className={styles.select} value={movement.dose.kind} onChange={(event) => update({
        dose: event.target.value === "hold" ? { kind: "hold", seconds: 30 }
          : event.target.value === "distance" ? { kind: "distance", metres: 20 } : { kind: "reps", reps: 5 },
      })}><option value="reps">Reps</option><option value="hold">Hold (seconds)</option><option value="distance">Distance (metres)</option></select></label>
      <label className={styles.field}>{movement.dose.kind === "reps" ? "Reps" : movement.dose.kind === "hold" ? "Seconds" : "Metres"}
        <input className={styles.input} type="number" min={1} value={movement.dose.kind === "reps" ? movement.dose.reps : movement.dose.kind === "hold" ? movement.dose.seconds : movement.dose.metres}
          onChange={(event) => update({ dose: movement.dose.kind === "reps" ? { kind: "reps", reps: Number(event.target.value) }
            : movement.dose.kind === "hold" ? { kind: "hold", seconds: Number(event.target.value) } : { kind: "distance", metres: Number(event.target.value) } })} /></label>
      <label className={styles.field}>Load (kg)<input className={styles.input} type="number" min={0} step="0.5" value={movement.weightKg ?? ""} placeholder="Optional"
        onChange={(event) => update({ weightKg: event.target.value === "" ? undefined : Number(event.target.value) })} /></label>
      <label className={styles.field}>Rest (seconds)<input className={styles.input} type="number" min={0} max={1800} value={movement.restSeconds} onChange={(event) => update({ restSeconds: Number(event.target.value) })} /></label>
    </div>
    <label className={styles.field}>Notes<input className={styles.input} value={movement.notes} maxLength={500} onChange={(event) => update({ notes: event.target.value })} /></label>
  </div>;
}

type RehabChoice = { id: string; name: string; summary: string };

function PartEditor({ part, catalog, rehabProtocols, onChange }: {
  part: AuthoredWorkoutPart; catalog: AuthoredCatalogMovement[]; rehabProtocols: RehabChoice[];
  onChange: (part: AuthoredWorkoutPart) => void;
}) {
  if (part.kind === "rehab") return <div className={styles.panel}>
    <label className={styles.field}>Rehab protocol<select className={styles.select} value={part.protocolId}
      onChange={(event) => onChange({ ...part, protocolId: event.target.value })}>
      <option value="">Choose a protocol</option>
      {rehabProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.name}</option>)}
    </select></label>
    {part.protocolId && <p className={styles.muted}>{rehabProtocols.find((protocol) => protocol.id === part.protocolId)?.summary}</p>}
  </div>;
  if (part.kind === "movement") return <MovementEditor movement={part.movement} catalog={catalog} onChange={(movement) => onChange({ ...part, movement })} />;
  if (part.kind === "circuit") return <>
    <div className={styles.fields}>
      <label className={styles.field}>Circuit name<input className={styles.input} maxLength={100} value={part.name} onChange={(event) => onChange({ ...part, name: event.target.value })} /></label>
      <label className={styles.field}>Rounds<input className={styles.input} type="number" min={1} max={20} value={part.rounds} onChange={(event) => onChange({ ...part, rounds: Number(event.target.value) })} /></label>
    </div>
    {part.movements.map((movement, index) => <div key={movement.id}>
      <div className={styles.row}><h3>Station {index + 1}</h3><div className={styles.actions}>
        <button type="button" className={styles.iconButton} disabled={index === 0} aria-label={`Move station ${index + 1} up`} onClick={() => {
          const movements = [...part.movements]; [movements[index - 1], movements[index]] = [movements[index]!, movements[index - 1]!]; onChange({ ...part, movements });
        }}>Up</button>
        <button type="button" className={styles.button} disabled={part.movements.length <= 2} onClick={() => onChange({ ...part, movements: part.movements.filter((entry) => entry.id !== movement.id) })}>Remove</button>
      </div></div>
      <MovementEditor movement={movement} catalog={catalog} inCircuit onChange={(next) => onChange({ ...part, movements: part.movements.map((entry) => entry.id === movement.id ? next : entry) })} />
    </div>)}
    <button type="button" className={styles.button} disabled={part.movements.length >= 12} onClick={() => onChange({ ...part, movements: [...part.movements, newMovement()] })}>Add station</button>
  </>;
  return <>
    <LibraryPicker catalog={catalog.filter((entry) => entry.pattern === "cardio" && ["run", "bike", "row", "ski"].includes(entry.modality ?? ""))}
      value={part.movementId} onChange={(movement) => onChange({ ...part, movementId: movement.id, modality: movement.modality as typeof part.modality })} />
    <div className={styles.fields}>
      <label className={styles.field}>Session type<select className={styles.select} value={part.intensity} onChange={(event) => onChange({ ...part, intensity: event.target.value as typeof part.intensity })}>
        <option value="z2">Easy aerobic</option><option value="threshold">Threshold</option><option value="vo2">VO2 intervals</option><option value="alactic">Short sprints</option>
      </select></label>
      <label className={styles.field}>Repeat sequence<input className={styles.input} type="number" min={1} max={50} value={part.repeats} onChange={(event) => onChange({ ...part, repeats: Number(event.target.value) })} /></label>
    </div>
    {part.intervals.map((interval, index) => <div className={styles.panel} key={interval.id}>
      <div className={styles.row}><strong>Interval {index + 1}</strong><button type="button" className={styles.button} disabled={part.intervals.length === 1}
        onClick={() => onChange({ ...part, intervals: part.intervals.filter((entry) => entry.id !== interval.id) })}>Remove</button></div>
      <div className={styles.fields}>
        <label className={styles.field}>Label<input className={styles.input} maxLength={60} value={interval.label} onChange={(event) => onChange({ ...part, intervals: part.intervals.map((entry) => entry.id === interval.id ? { ...entry, label: event.target.value } : entry) })} /></label>
        <label className={styles.field}>Measure<select className={styles.select} value={interval.target.kind} onChange={(event) => onChange({ ...part, intervals: part.intervals.map((entry) => entry.id === interval.id ? { ...entry, target: event.target.value === "time" ? { kind: "time", seconds: 60 } : { kind: "distance", metres: 400 } } : entry) })}>
          <option value="time">Seconds</option><option value="distance">Metres</option></select></label>
        <label className={styles.field}>{interval.target.kind === "time" ? "Seconds" : "Metres"}<input className={styles.input} type="number" min={1}
          value={interval.target.kind === "time" ? interval.target.seconds : interval.target.metres} onChange={(event) => onChange({ ...part, intervals: part.intervals.map((entry) => entry.id === interval.id ? { ...entry, target: entry.target.kind === "time" ? { kind: "time", seconds: Number(event.target.value) } : { kind: "distance", metres: Number(event.target.value) } } : entry) })} /></label>
        <label className={styles.field}>Effort<select className={styles.select} value={interval.effort} onChange={(event) => onChange({ ...part, intervals: part.intervals.map((entry) => entry.id === interval.id ? { ...entry, effort: event.target.value as typeof entry.effort } : entry) })}>
          <option value="easy">Easy</option><option value="steady">Steady</option><option value="hard">Hard</option><option value="recovery">Recovery</option></select></label>
      </div>
    </div>)}
    <button type="button" className={styles.button} disabled={part.intervals.length >= 20} onClick={() => onChange({ ...part, intervals: [...part.intervals, {
      id: newId(), label: "Recovery", effort: "recovery", target: { kind: "time", seconds: 60 },
    }] })}>Add interval</button>
  </>;
}

export function ProgramBuilder({ catalog, rehabProtocols = [], today, commitments, initial, editBlockId, initialStartDate, activity = "hybrid", swimHref, workoutId, plannedSessionId }: {
  catalog: AuthoredCatalogMovement[]; today: string; commitments: TrainingCommitment[];
  rehabProtocols?: RehabChoice[];
  initial?: AuthoredProgramDefinition; editBlockId?: string; initialStartDate?: string; activity?: ProgramActivity; swimHref?: string | null;
  workoutId?: string; plannedSessionId?: string;
}) {
  const router = useRouter();
  const [definition, setDefinition] = useState<AuthoredProgramDefinition>(initial ?? { version: 1, activity, name: "", weeks: 6, workouts: [] });
  const [startedOn, setStartedOn] = useState(initialStartDate ?? today);
  const [step, setStep] = useState(workoutId ? 3 : initial ? 2 : 0);
  const [selectedId, setSelectedId] = useState<string | null>(workoutId ?? null);
  const [scope, setScope] = useState<"program" | "workout" | "future">(workoutId ? "workout" : "program");
  const [preview, setPreview] = useState<AuthoredPreview | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
  const [acceptReplacement, setAcceptReplacement] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const selected = definition.workouts.find((workout) => workout.id === selectedId);
  const input = { definition, startedOn, scope, ...(editBlockId ? { editBlockId } : {}), ...(workoutId ? { workoutId, plannedSessionId } : {}) };
  const update = (next: AuthoredProgramDefinition) => {
    setDefinition(next); setPreview(null); setRequestId(null); setAcceptOverlap(false); setAcceptReplacement(false); setError(null);
  };
  const setWorkout = (workout: AuthoredWorkout) => update({ ...definition, workouts: definition.workouts.map((entry) => entry.id === workout.id ? workout : entry) });
  const addWorkout = (weekday: number) => {
    const workout: AuthoredWorkout = { id: newId(), name: `${DAYS[weekday]} workout`, weekday, parts: [] };
    update({ ...definition, workouts: [...definition.workouts, workout] }); setSelectedId(workout.id); setStep(3);
  };
  const addPart = (kind: AuthoredWorkoutPart["kind"]) => {
    if (!selected) return;
    const part: AuthoredWorkoutPart = kind === "movement" ? { id: newId(), kind, movement: newMovement() }
      : kind === "rehab" ? { id: newId(), kind, protocolId: "" }
      : kind === "circuit" ? { id: newId(), kind, name: "Circuit", rounds: 3, movements: [newMovement(), newMovement()] }
        : { id: newId(), kind, movementId: "", modality: "run", intensity: "z2", repeats: 1, notes: "",
          intervals: [{ id: newId(), label: "Run", effort: "easy", target: { kind: "time", seconds: 1200 } }] };
    setWorkout({ ...selected, parts: [...selected.parts, part] });
  };
  const review = () => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await previewAuthoredProgram(input);
        if (!result.ok) { setError(result.error); return; }
        setPreview(result.preview); setRequestId(newId()); setAcceptOverlap(false); setAcceptReplacement(false); setStep(4);
      } catch { setError("Couldn't review your program. Your changes are still here."); }
    });
  };
  const save = () => {
    if (!preview || !requestId) return;
    startTransition(async () => {
      try {
        const result = await saveAuthoredProgram(input, preview.id, {
          revision: preview.revision, requestId, acceptOverlap,
          ...(acceptReplacement && preview.replacesBlockId ? { replaceBlockId: preview.replacesBlockId } : {}),
        });
        if (!result.ok) { setError(result.error); return; }
        router.push(`/app/plan?block=${result.blockId}`); router.refresh();
      } catch { setError("Couldn't confirm the save. Retry to check the same request."); }
    });
  };
  let dates: ReturnType<typeof authoredProgramDates> = [];
  try { dates = authoredProgramDates(definition, startedOn); } catch { /* Date field may be temporarily incomplete. */ }
  const endDate = dates.at(-1)?.date ?? startedOn;
  const visibleCommitments = commitments.filter((entry) => entry.date >= startedOn && entry.date <= endDate &&
    !(entry.source === "primary" && entry.programId === editBlockId));
  return <div className={styles.builder}>
    <header className={styles.header}><div><div className={styles.eyebrow}>{workoutId ? "Edit workout" : editBlockId ? "Edit program" : "New program"}</div><h1>{workoutId ? selected?.name : definition.name || "Build your week"}</h1></div>
      <Link className={styles.button} href={editBlockId ? `/app/plan?block=${editBlockId}` : "/app/programs"}>Cancel</Link></header>
    <nav className={styles.steps} aria-label="Program setup">{STEPS.map((label, index) => workoutId && index < 3 ? null : <button type="button" key={label} className={styles.step}
      aria-current={step === index ? "step" : undefined} disabled={pending || index === 4 || (index === 3 && !selected) || (!!editBlockId && index === 0)}
      onClick={() => setStep(index)}>{index + 1}. {label}</button>)}</nav>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {step === 0 && <section className={styles.cards}>
      {(Object.keys(ACTIVITY_LABELS) as ProgramActivity[]).map((value) => <button key={value} type="button" className={styles.card} aria-pressed={definition.activity === value}
        onClick={() => update({ ...definition, activity: value })}><strong>{ACTIVITY_LABELS[value]}</strong><span className={styles.muted}>
          {value === "strength" ? "Lifts, accessories and rehab" : value === "running" ? "Runs, intervals and rehab" : "Strength, running, machines and rehab"}</span></button>)}
      {swimHref && <Link className={styles.card} href={swimHref}><strong>Swimming</strong><span className={styles.muted}>Import a prepared course</span></Link>}
    </section>}
    {step <= 1 && !editBlockId && definition.activity !== "running" &&
      <Link className={styles.textLink} href="/app/program">Program templates</Link>}
    {step === 1 && <section className={styles.panel}><h2>Program details</h2><div className={styles.fields}>
      <label className={styles.field}>Program name<input className={styles.input} value={definition.name} maxLength={100} onChange={(event) => update({ ...definition, name: event.target.value })} /></label>
      <label className={styles.field}>Start date<input className={styles.input} type="date" min={today} disabled={!!editBlockId} value={startedOn}
        onChange={(event) => { setStartedOn(event.target.value); setPreview(null); setRequestId(null); }} /></label>
      <label className={styles.field}>Weeks<input className={styles.input} type="number" min={1} max={16} value={definition.weeks} onChange={(event) => update({ ...definition, weeks: Number(event.target.value) })} /></label>
    </div></section>}
    {step === 2 && <section className={styles.week} aria-label="Training week">{DAYS.map((day, weekday) => {
      const workout = definition.workouts.find((entry) => entry.weekday === weekday);
      const busy = visibleCommitments.filter((entry) => commitmentWeekday(entry.date) === weekday);
      return <div key={day} className={styles.day}><strong>{day.slice(0, 3)}</strong><div>
        <strong>{workout?.name ?? "Planned rest"}</strong>
        {busy.length > 0 && <p className={styles.muted}>{[...new Set(busy.map((entry) => entry.title))].join(", ")} · {busy.length} {busy.length === 1 ? "date" : "dates"}</p>}
      </div><div className={styles.dayActions}>
        {workout ? <>
          <button type="button" className={styles.button} onClick={() => { setSelectedId(workout.id); setStep(3); }}>Edit</button>
          <button type="button" className={styles.button} onClick={() => update({ ...definition, workouts: definition.workouts.filter((entry) => entry.id !== workout.id) })}>Rest</button>
        </> : <button type="button" className={styles.button} onClick={() => addWorkout(weekday)}>Add workout</button>}
      </div></div>;
    })}</section>}
    {step === 3 && selected && <section className={styles.workout}>
      <div className={styles.panel}><div className={styles.fields}>
        <label className={styles.field}>Workout name<input className={styles.input} value={selected.name} maxLength={100} onChange={(event) => setWorkout({ ...selected, name: event.target.value })} /></label>
        {!workoutId && <label className={styles.field}>Day<select className={styles.select} value={selected.weekday} onChange={(event) => setWorkout({ ...selected, weekday: Number(event.target.value) })}>
          {DAYS.map((day, index) => <option key={day} value={index} disabled={definition.workouts.some((entry) => entry.id !== selected.id && entry.weekday === index)}>{day}</option>)}</select></label>}
        {workoutId && <label className={styles.field}>Apply changes to<select className={styles.select} value={scope} onChange={(event) => {
          setScope(event.target.value as "workout" | "future"); setPreview(null); setRequestId(null);
        }}><option value="workout">This workout</option><option value="future">This and future matching workouts</option></select></label>}
      </div><div className={styles.actions}>
        <button type="button" className={styles.button} disabled={!!workoutId || definition.workouts.length >= 7} onClick={() => {
          const weekday = DAYS.findIndex((_, index) => !definition.workouts.some((entry) => entry.weekday === index));
          if (weekday < 0) return;
          const copy = structuredClone(selected);
          copy.id = newId(); copy.weekday = weekday; copy.name = `${selected.name} copy`;
          copy.parts = copy.parts.map((part) => part.kind === "movement" ? { ...part, id: newId(), movement: { ...part.movement, id: newId() } }
            : part.kind === "rehab" ? { ...part, id: newId() }
            : part.kind === "circuit" ? { ...part, id: newId(), movements: part.movements.map((movement) => ({ ...movement, id: newId() })) }
              : { ...part, id: newId(), intervals: part.intervals.map((interval) => ({ ...interval, id: newId() })) });
          update({ ...definition, workouts: [...definition.workouts, copy] }); setSelectedId(copy.id);
        }}>Copy workout</button>
        <button type="button" className={styles.button} onClick={() => setStep(2)}>Back to week</button>
      </div></div>
      {selected.parts.map((part, index) => <article className={styles.part} key={part.id}>
        <div className={styles.partHeader}><h3>{index + 1}. {part.kind === "movement" ? "Exercise" : part.kind === "circuit" ? "Circuit" : part.kind === "rehab" ? "Rehab" : "Cardio"}</h3><div className={styles.actions}>
          <button type="button" className={styles.iconButton} disabled={index === 0} aria-label={`Move part ${index + 1} up`} onClick={() => {
            const parts = [...selected.parts]; [parts[index - 1], parts[index]] = [parts[index]!, parts[index - 1]!]; setWorkout({ ...selected, parts });
          }}>Up</button>
          <button type="button" className={styles.button} onClick={() => setWorkout({ ...selected, parts: selected.parts.filter((entry) => entry.id !== part.id) })}>Remove</button>
        </div></div>
        <PartEditor part={part} catalog={definition.activity === "running" ? catalog.filter((entry) => entry.modality === "run") : catalog}
          rehabProtocols={rehabProtocols} onChange={(next) => setWorkout({ ...selected, parts: selected.parts.map((entry) => entry.id === part.id ? next : entry) })} />
      </article>)}
      <div className={styles.actions}>{definition.activity !== "running" && <>
        <button type="button" className={styles.button} onClick={() => addPart("movement")}>Add exercise</button>
        <button type="button" className={styles.button} onClick={() => addPart("circuit")}>Add circuit</button>
      </>}
        <button type="button" className={styles.button} disabled={rehabProtocols.length === 0} onClick={() => addPart("rehab")}>Add rehab</button>
        {rehabProtocols.length === 0 && <>
          <Link className={styles.button} href="/app/settings/rehab-protocols" target="_blank" rel="noreferrer">Create a rehab protocol</Link>
          <button type="button" className={styles.button} onClick={() => router.refresh()}>Refresh protocols</button>
        </>}
        {definition.activity !== "strength" && <button type="button" className={styles.button} onClick={() => addPart("cardio")}>Add {definition.activity === "running" ? "run" : "cardio"}</button>}
      </div>
    </section>}
    {step === 4 && preview && <section className={styles.panel}>
      <h2>{definition.name}</h2>
      <p className={styles.muted}>{ACTIVITY_LABELS[definition.activity]} · {definition.weeks} weeks · {preview.dates.length} workouts{preview.preserved > 0 ? ` · ${preview.preserved} existing workouts kept` : ""}</p>
      {definition.workouts.map((workout) => <details key={workout.id}><summary>{DAYS[workout.weekday]} · {workout.name}</summary>
        {workout.parts.map((part) => <p key={part.id} className={styles.muted}>{part.kind === "cardio"
          ? `${catalog.find((entry) => entry.id === part.movementId)?.displayName} · ${part.repeats} rounds · ${part.intervals.map(formatAuthoredInterval).join(" / ")}`
          : part.kind === "circuit" ? `${part.name} · ${part.rounds} rounds · ${part.movements.map((movement) => catalog.find((entry) => entry.id === movement.movementId)?.displayName).join(", ")}`
            : part.kind === "rehab" ? rehabProtocols.find((protocol) => protocol.id === part.protocolId)?.name
            : `${catalog.find((entry) => entry.id === part.movement.movementId)?.displayName} · ${part.movement.sets} sets`}</p>)}
      </details>)}
      {preview.replaces && <label className={styles.check}><input type="checkbox" checked={acceptReplacement} onChange={(event) => setAcceptReplacement(event.target.checked)} />End {preview.replaces} and start this program.</label>}
      {preview.overlaps.length > 0 && <div className={styles.notice}><strong>Workouts on the same day</strong>
        {preview.overlaps.map((entry) => <div key={`${entry.source}:${entry.id}`} className={styles.date}><time>{entry.date}</time><span>{entry.title}</span></div>)}
        <label className={styles.check}><input type="checkbox" checked={acceptOverlap} onChange={(event) => setAcceptOverlap(event.target.checked)} />Keep both workouts on these dates.</label>
      </div>}
      {preview.plannedRest.length > 0 && <div className={styles.notice}>Includes {preview.plannedRest.length} dates marked as rest in another program.</div>}
      <details><summary>All workout dates</summary><div className={styles.dates}>{preview.dates.map((entry) => <div key={`${entry.date}:${entry.title}`} className={styles.date}><time>{entry.date}</time><span>{entry.title}</span></div>)}</div></details>
    </section>}
    <footer className={styles.footer}>
      <button type="button" className={styles.button} disabled={pending || step === 0 || (!!workoutId && step === 3)} onClick={() => setStep(workoutId ? 3 : step === 4 ? 2 : Math.max(0, step - 1))}>Back</button>
      {step < 2 ? <button type="button" className={`${styles.button} ${styles.primary}`} disabled={step === 1 && (!definition.name.trim() || !startedOn)} onClick={() => setStep(step + 1)}>Continue</button>
        : step === 4 ? <button type="button" className={`${styles.button} ${styles.primary}`} disabled={pending || (!!preview?.replaces && !acceptReplacement) || (!!preview?.overlaps.length && !acceptOverlap)} onClick={save}>{pending ? "Saving..." : editBlockId ? "Save changes" : "Start program"}</button>
          : <button type="button" className={`${styles.button} ${styles.primary}`} disabled={pending || definition.workouts.length === 0} onClick={review}>{pending ? "Reviewing..." : workoutId ? "Review changes" : "Review program"}</button>}
    </footer>
  </div>;
}
