"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import {
  authoredLoadDisplay, authoredWorkoutActivity, effectiveAuthoredMovement, formatAuthoredInterval, formatAuthoredLoad,
  parseAuthoredLoad, upgradeAuthoredProgram,
  type AuthoredCatalogMovement, type AuthoredMovement, type AuthoredMovementOverride, type AuthoredProgramDefinition,
  type AuthoredProgramDefinitionV2, type AuthoredWeek, type AuthoredWorkout, type AuthoredWorkoutPart,
  type ProgramActivity, type TrainingCommitment,
} from "@hta/domain";
import { previewAuthoredProgram, saveAuthoredProgram, reloadAuthoredProgram, type AuthoredPreview } from "@/lib/programs/authored/actions";
import { ProgramConfirmation } from "./ProgramDialog";
import { restSecondsForKind } from "@/lib/sessions/rest";
import { formatProgramDate } from "@/lib/programs/presentation";
import styles from "./ProgramBuilder.module.css";

const DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const newId = () => crypto.randomUUID();
const newWeek = (): AuthoredWeek => ({ type: "Build", sets: "3", reps: "5", pct: 75 });
const newMovement = (role: AuthoredMovement["role"] = "accessory"): AuthoredMovement => ({
  id: newId(), movementId: "", role, sets: "3", dose: { kind: "reps", reps: "8–12" },
  load: null, restSeconds: restSecondsForKind(role), notes: "",
});
type RehabChoice = { id: string; name: string; summary: string };
type Loads = { oneRmByMovementId?: Record<string, number>; bodyweightKg?: number };

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className={styles.field}><span>{label}</span>{children}</label>;
}
function LibraryPicker({ catalog, value, onChange }: {
  catalog: AuthoredCatalogMovement[]; value: string; onChange: (movement: AuthoredCatalogMovement) => void;
}) {
  const [query, setQuery] = useState("");
  const selected = catalog.find((movement) => movement.id === value);
  const [open, setOpen] = useState(!selected);
  const matches = catalog.filter((movement) => movement.displayName.toLowerCase().includes(query.toLowerCase())).slice(0, 30);
  return <div className={styles.exercisePicker}>
    <span className={styles.muted}>Exercise</span>
    <button type="button" className={styles.pickerButton} aria-expanded={open} onClick={() => setOpen(!open)}>
      {selected?.displayName ?? "Choose an exercise"}<span aria-hidden="true">⌄</span>
    </button>
    {open && <div className={styles.library}>
      <Field label="Search library"><input className={styles.input} value={query} onChange={(event) => setQuery(event.target.value)} /></Field>
      <div className={styles.results}>
        {matches.map((movement) => <button type="button" className={styles.result} aria-pressed={movement.id === value} key={movement.id}
          onClick={() => { onChange(movement); setOpen(false); setQuery(""); }}>{movement.displayName}</button>)}
        {matches.length === 0 && <p className={styles.muted}>No matching exercises.</p>}
      </div>
    </div>}
  </div>;
}

function LoadField({ value, onChange }: { value: AuthoredMovement["load"]; onChange: (value: AuthoredMovement["load"]) => void }) {
  const [text, setText] = useState(formatAuthoredLoad(value));
  const formatted = formatAuthoredLoad(value);
  const [previous, setPrevious] = useState(formatted);
  if (previous !== formatted) {
    setPrevious(formatted);
    try { if (formatAuthoredLoad(parseAuthoredLoad(text)) !== formatted) setText(formatted); }
    catch { setText(formatted); }
  }
  return <Field label="Load"><input className={styles.input} value={text} placeholder="75%, 80 kg or RIR 2"
    ref={(input) => {
      if (!input) return;
      try { parseAuthoredLoad(text); input.setCustomValidity(""); }
      catch (error) { input.setCustomValidity(error instanceof Error ? error.message : "Enter a valid load."); }
    }}
    onChange={(event) => {
      setText(event.target.value);
      try { const load = parseAuthoredLoad(event.target.value); event.target.setCustomValidity(""); onChange(load); }
      catch (error) { event.target.setCustomValidity(error instanceof Error ? error.message : "Enter a valid load."); }
    }} onBlur={(event) => event.target.reportValidity()} /></Field>;
}

function MovementEditor({ movement, catalog, weeks, weekIndex, onChange, loads, inCircuit = false }: {
  movement: AuthoredMovement; catalog: AuthoredCatalogMovement[]; weeks: AuthoredWeek[]; weekIndex: number;
  onChange: (movement: AuthoredMovement) => void; loads: Loads; inCircuit?: boolean;
}) {
  const [scope, setScope] = useState<"all" | "week">(movement.role === "main" ? "week" : "all");
  const effective = effectiveAuthoredMovement(movement, inCircuit ? undefined : weeks[weekIndex], weekIndex);
  const shown = scope === "all" && movement.role !== "main"
    ? { sets: String(movement.sets), reps: movement.dose.kind === "reps" ? String(movement.dose.reps) : "", load: movement.load }
    : effective;
  const selected = catalog.find((entry) => entry.id === movement.movementId);
  const display = authoredLoadDisplay(shown.load, selected, loads.oneRmByMovementId?.[movement.movementId], loads.bodyweightKg);
  const change = (patch: AuthoredMovementOverride) => {
    const overrides = { ...movement.overrides };
    if (!inCircuit && scope === "week") {
      overrides[weekIndex] = { ...overrides[weekIndex], ...patch };
      onChange({ ...movement, overrides }); return;
    }
    if (!inCircuit && movement.role === "main") {
      weeks.forEach((_, index) => { overrides[index] = { ...overrides[index], ...patch }; });
      onChange({ ...movement, overrides }); return;
    }
    for (const key of Object.keys(overrides)) {
      const override = { ...overrides[key] };
      if (patch.sets !== undefined) delete override.sets;
      if (patch.reps !== undefined) delete override.reps;
      if (patch.load !== undefined) delete override.load;
      if (Object.keys(override).length) overrides[key] = override; else delete overrides[key];
    }
    onChange({ ...movement, overrides, ...(patch.sets === undefined ? {} : { sets: patch.sets }),
      ...(patch.reps === undefined ? {} : { dose: { kind: "reps", reps: patch.reps } }),
      ...(patch.load === undefined ? {} : { load: patch.load }) });
  };
  return <>
    <LibraryPicker catalog={catalog.filter((entry) => inCircuit || entry.pattern !== "cardio")} value={movement.movementId}
      onChange={(entry) => onChange({ ...movement, movementId: entry.id,
        ...(entry.pattern === "cardio" ? { dose: { kind: "distance", metres: 500 } } : {}) })} />
    {!inCircuit && <div className={styles.scopeField}><span className={styles.muted}>Role</span>
      <div className={styles.segment} role="group" aria-label="Role">{(["main", "accessory"] as const).map((role) =>
        <button type="button" key={role} aria-pressed={role === "main" ? movement.role === "main" : movement.role !== "main"}
          onClick={() => onChange({ ...movement, role, restSeconds: restSecondsForKind(role) })}>{role === "main" ? "Main lift" : "Other"}</button>)}</div>
    </div>}
    {!inCircuit && <Field label="Sets"><input className={styles.input} value={shown.sets} onChange={(event) => change({ sets: event.target.value })} /></Field>}
    {movement.dose.kind === "reps"
      ? <Field label="Reps"><input className={styles.input} value={shown.reps} onChange={(event) => change({ reps: event.target.value })} /></Field>
      : <Field label={movement.dose.kind === "hold" ? "Seconds" : "Metres"}><input className={styles.input} type="number" min={1}
        value={movement.dose.kind === "hold" ? movement.dose.seconds : movement.dose.metres}
        onChange={(event) => onChange({ ...movement, dose: movement.dose.kind === "hold"
          ? { kind: "hold", seconds: Number(event.target.value) } : { kind: "distance", metres: Number(event.target.value) } })} /></Field>}
    {selected?.pattern !== "cardio" && <LoadField key={`${scope}:${weekIndex}:${movement.id}`} value={shown.load} onChange={(load) => change({ load })} />}
    {inCircuit && selected?.pattern !== "cardio" && <Field label="Measure"><select className={styles.select} value={movement.dose.kind}
      onChange={(event) => onChange({ ...movement, dose: event.target.value === "distance" ? { kind: "distance", metres: 20 }
        : event.target.value === "hold" ? { kind: "hold", seconds: 30 } : { kind: "reps", reps: "15" } })}>
      <option value="reps">Reps</option><option value="distance">Metres</option><option value="hold">Seconds</option>
    </select></Field>}
    {!inCircuit && <div className={styles.scopeField}><span className={styles.muted}>Change</span>
      <div className={styles.segment} role="group" aria-label="Apply changes to">
        <button type="button" aria-pressed={scope === "all"} onClick={() => setScope("all")}>All weeks</button>
        <button type="button" aria-pressed={scope === "week"} onClick={() => setScope("week")}>Week {weekIndex + 1} only</button>
      </div>
    </div>}
    {!inCircuit && effective.overridden && <div className={styles.editorNote}>Week {weekIndex + 1} changed · <button type="button" className={styles.inlineLink} onClick={() => {
      const overrides = { ...movement.overrides }; delete overrides[weekIndex]; onChange({ ...movement, overrides });
    }}>Reset</button></div>}
    {!inCircuit && !effective.overridden && effective.deload && <div className={styles.editorNote}>
      {scope === "all" ? `Week ${weekIndex + 1}: ${effective.sets} sets (deload)` : `Week ${weekIndex + 1} deload: one set fewer`}
    </div>}
    {(display.note || !inCircuit && !effective.overridden && movement.role === "main") && <div className={styles.editorNote}>
      {[!inCircuit && !effective.overridden && movement.role === "main" ? `From week ${weekIndex + 1}` : null,
        display.note || null, display.rounded ? "Rounded to 2.5 kg" : null].filter(Boolean).join(" · ")}
    </div>}
    {shown.load?.kind === "pct" && !display.note && <Link className={styles.inlineLink} href="/app/settings/training-maxes">Set 1RM</Link>}
  </>;
}

function PartEditor({ part, catalog, rehabProtocols, weeks, weekIndex, onChange, loads }: {
  part: AuthoredWorkoutPart; catalog: AuthoredCatalogMovement[]; rehabProtocols: RehabChoice[];
  weeks: AuthoredWeek[]; weekIndex: number; onChange: (part: AuthoredWorkoutPart) => void; loads: Loads;
}) {
  const [different, setDifferent] = useState(part.kind === "circuit" && !!part.weeks?.some((week) => JSON.stringify(week) !== JSON.stringify(part.weeks?.[0])));
  if (part.kind === "rehab") return <>
    <Field label="Protocol"><select className={styles.select} value={part.protocolId} onChange={(event) => onChange({ ...part, protocolId: event.target.value })}>
      <option value="">Choose a protocol</option>{rehabProtocols.map((protocol) => <option key={protocol.id} value={protocol.id}>{protocol.name}</option>)}
    </select></Field>
    {part.protocolId && <><p className={styles.editorNote}>{rehabProtocols.find((protocol) => protocol.id === part.protocolId)?.summary}</p>
      <Link className={styles.inlineLink} href="/app/settings/rehab-protocols" target="_blank">Edit protocol</Link></>}
  </>;
  if (part.kind === "movement") return <MovementEditor movement={part.movement} catalog={catalog} weeks={weeks} weekIndex={weekIndex}
    loads={loads} onChange={(movement) => onChange({ ...part, movement })} />;
  if (part.kind === "circuit") {
    const plans: { rounds: number; runMetres?: number }[] = part.weeks ?? weeks.map(() => ({ rounds: part.rounds }));
    const hasRun = plans.some((week) => week.runMetres !== undefined);
    const updatePlan = (index: number, patch: Partial<(typeof plans)[number]>) => onChange({
      ...part, weeks: plans.map((plan, i) => different && i !== index ? plan : { ...plan, ...patch }),
    });
    return <>
      <div className={styles.wideField}><Field label="Name"><input className={styles.input} value={part.name} maxLength={100} onChange={(event) => onChange({ ...part, name: event.target.value })} /></Field></div>
      <div className={styles.segment} role="group" aria-label="Circuit weeks">
        <button type="button" aria-pressed={!different} onClick={() => {
          setDifferent(false); onChange({ ...part, weeks: weeks.map(() => ({ ...plans[weekIndex]! })) });
        }}>Same every week</button>
        <button type="button" aria-pressed={different} onClick={() => setDifferent(true)}>Different each week</button>
      </div>
      <label className={styles.builderCheck}><input type="checkbox" checked={hasRun} onChange={(event) => onChange({
        ...part, runMovementId: event.target.checked ? catalog.find((entry) => entry.modality === "run")?.id : undefined,
        weeks: plans.map((plan) => event.target.checked ? { ...plan, runMetres: 800 } : { rounds: plan.rounds }),
      })} />Run before each station</label>
      <div className={`${styles.circuitWeeks} ${different ? styles.circuitDifferent : ""}`}>
        {different && <div className={styles.circuitLabels} aria-hidden="true"><span /><span>Rounds</span>{hasRun && <span>Run (m)</span>}</div>}
        {(different ? plans : [plans[weekIndex]!]).map((plan, index) => <div key={index} className={styles.circuitWeek} data-selected={different && weekIndex === index}>
          {different && <strong>Week {index + 1}</strong>}
          <Field label="Rounds"><input className={styles.input} aria-label={different ? `Week ${index + 1} rounds` : "Rounds"}
            type="number" min={1} max={20} value={plan.rounds} onChange={(event) => updatePlan(index, { rounds: Number(event.target.value) })} /></Field>
          {hasRun && <Field label="Run (m)"><input className={styles.input} aria-label={different ? `Week ${index + 1} run metres` : "Run (m)"}
            type="number" min={1} value={plan.runMetres ?? ""} onChange={(event) => updatePlan(index, { runMetres: Number(event.target.value) })} /></Field>}
        </div>)}
      </div>
      <div className={styles.circuitStations}><h3>Stations</h3>{part.movements.map((movement, index) => <details key={movement.id}>
        <summary>{index + 1}. {catalog.find((entry) => entry.id === movement.movementId)?.displayName ?? "Choose an exercise"}</summary>
        <div className={styles.inlineFields}><MovementEditor movement={movement} catalog={catalog} weeks={weeks} weekIndex={weekIndex} inCircuit loads={loads}
          onChange={(next) => onChange({ ...part, movements: part.movements.map((entry) => entry.id === movement.id ? next : entry) })} />
          <button type="button" className={styles.button} disabled={part.movements.length <= 2}
            onClick={() => onChange({ ...part, movements: part.movements.filter((entry) => entry.id !== movement.id) })}>Remove station</button>
        </div>
      </details>)}<button type="button" className={styles.inlineLink} disabled={part.movements.length >= 12}
        onClick={() => onChange({ ...part, movements: [...part.movements, newMovement()] })}>Add station</button></div>
    </>;
  }
  return <>
    <LibraryPicker catalog={catalog.filter((entry) => entry.pattern === "cardio" && ["run", "bike", "row", "ski"].includes(entry.modality ?? ""))}
      value={part.movementId} onChange={(entry) => onChange({ ...part, movementId: entry.id, modality: entry.modality as typeof part.modality })} />
    {part.duration !== undefined ? <>
      <Field label="Duration"><input className={styles.input} value={part.duration}
        placeholder="40–60" onChange={(event) => onChange({ ...part, duration: event.target.value })} /></Field>
      <Field label="Effort"><input className={styles.input} value={part.effort ?? ""} onChange={(event) => onChange({ ...part, effort: event.target.value })} /></Field>
    </> : <>
      <Field label="Repeat sequence"><input className={styles.input} type="number" min={1} max={50} value={part.repeats}
        onChange={(event) => onChange({ ...part, repeats: Number(event.target.value) })} /></Field>
      {part.intervals.map((interval) => <Field key={interval.id} label={interval.target.kind === "time" ? "Seconds" : "Metres"}>
        <input className={styles.input} type="number" min={1} value={interval.target.kind === "time" ? interval.target.seconds : interval.target.metres}
          onChange={(event) => onChange({ ...part, intervals: part.intervals.map((entry) => entry.id !== interval.id ? entry : { ...entry,
            target: entry.target.kind === "time" ? { kind: "time", seconds: Number(event.target.value) } : { kind: "distance", metres: Number(event.target.value) } }) })} />
      </Field>)}
    </>}
  </>;
}

export function ProgramBuilder({ catalog, rehabProtocols = [], today, initial, editBlockId, initialStartDate, initialRevision,
  activity = "hybrid", workoutId, plannedSessionId, initialWeekIndex = 0, oneRmByMovementId, bodyweightKg, replacesName,
}: {
  catalog: AuthoredCatalogMovement[]; today: string; commitments: TrainingCommitment[]; rehabProtocols?: RehabChoice[];
  initial?: AuthoredProgramDefinition; editBlockId?: string; initialStartDate?: string; initialRevision?: string;
  activity?: ProgramActivity; swimHref?: string | null; workoutId?: string; plannedSessionId?: string;
  initialWeekIndex?: number; activitySelected?: boolean; replacesName?: string;
} & Loads) {
  const router = useRouter();
  const [definition, setDefinition] = useState<AuthoredProgramDefinitionV2>(() => initial ? upgradeAuthoredProgram(initial)
    : { version: 2, activity, name: "", weeks: Array.from({ length: 6 }, newWeek), workouts: [] });
  const [weekIndex, setWeekIndex] = useState(initialWeekIndex);
  const [editWeek, setEditWeek] = useState(false);
  const [openDay, setOpenDay] = useState<number | null>(initial?.workouts.find((workout) => workout.id === workoutId)?.weekday ?? 0);
  const [openPart, setOpenPart] = useState<string | null>(null);
  const [menu, setMenu] = useState<"add" | "copy" | null>(null);
  const [startedOn, setStartedOn] = useState(initialStartDate ?? today);
  const [editRevision, setEditRevision] = useState(initialRevision);
  const [current, setCurrent] = useState<Awaited<ReturnType<typeof reloadAuthoredProgram>> | null>(null);
  const [scope, setScope] = useState<"program" | "workout" | "future">(workoutId ? "workout" : "program");
  const [preview, setPreview] = useState<AuthoredPreview | null>(null);
  const [requestId, setRequestId] = useState<string | null>(null);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
  const [confirmReplacement, setConfirmReplacement] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const week = definition.weeks[weekIndex]!;
  const loads = { oneRmByMovementId, bodyweightKg };
  const input = { definition, startedOn, scope, ...(editBlockId ? { editBlockId, editRevision } : {}),
    ...(workoutId ? { workoutId, plannedSessionId } : {}) };
  const update = (next: AuthoredProgramDefinitionV2) => {
    setDefinition(next); setPreview(null); setRequestId(null); setAcceptOverlap(false); setError(null);
  };
  const updateWeek = (patch: Partial<AuthoredWeek>) => update({ ...definition, weeks: definition.weeks.map((entry, index) => index === weekIndex ? { ...entry, ...patch } : entry) });
  const setWorkout = (workout: AuthoredWorkout) => update({ ...definition, workouts: definition.workouts.some((entry) => entry.id === workout.id)
    ? definition.workouts.map((entry) => entry.id === workout.id ? workout : entry) : [...definition.workouts, workout] });
  const save = (checked: AuthoredPreview, id: string, replace = false) => {
    if (checked.replaces && !replace) { setConfirmReplacement(true); return; }
    startTransition(async () => {
      try {
        const result = await saveAuthoredProgram(input, checked.id, { revision: checked.revision, requestId: id, acceptOverlap,
          ...(replace && checked.replacesBlockId ? { replaceBlockId: checked.replacesBlockId } : {}) });
        if (!result.ok) {
          setError(result.error);
          if (!replace) { setPreview(null); setRequestId(null); }
          return;
        }
        router.push(`/app/plan?block=${result.blockId}`); router.refresh();
      } catch { setError("Couldn't confirm the save. Retry to check the same request."); }
    });
  };
  const review = () => {
    if (preview && requestId) { save(preview, requestId); return; }
    setError(null);
    startTransition(async () => {
      try {
        const result = await previewAuthoredProgram(input);
        if (!result.ok) { setError(result.error); return; }
        const id = newId(); setPreview(result.preview); setRequestId(id);
        if (result.preview.overlaps.length === 0 && result.preview.plannedRest.length === 0) save(result.preview, id);
      } catch { setError("Couldn't review your program. Your changes are still here."); }
    });
  };
  const addPart = (weekday: number, kind: AuthoredWorkoutPart["kind"]) => {
    const workout = definition.workouts.find((entry) => entry.weekday === weekday) ?? { id: newId(), weekday, name: `${DAYS[weekday]} workout`, parts: [] };
    const part: AuthoredWorkoutPart = kind === "movement" ? { id: newId(), kind, movement: newMovement() }
      : kind === "rehab" ? { id: newId(), kind, protocolId: "" }
        : kind === "circuit" ? { id: newId(), kind, name: "Station circuit", rounds: 3, weeks: definition.weeks.map(() => ({ rounds: 3 })), movements: [newMovement(), newMovement()] }
          : { id: newId(), kind, movementId: "", modality: "run", intensity: "z2", repeats: 1, notes: "", duration: "40–60", effort: "Zone 2",
            intervals: [{ id: newId(), label: "Run", effort: "easy", target: { kind: "time", seconds: 2400 } }] };
    setWorkout({ ...workout, parts: [...workout.parts, part] }); setOpenPart(part.id); setMenu(null);
  };
  const copyTo = (workout: AuthoredWorkout, weekday: number) => {
    const existing = definition.workouts.find((entry) => entry.weekday === weekday);
    if (existing?.parts.length && !window.confirm(`Replace ${DAYS[weekday]} exercises?`)) return;
    const copy = structuredClone(workout);
    copy.id = existing?.id ?? newId(); copy.weekday = weekday;
    copy.parts = copy.parts.map((part) => part.kind === "movement" ? { ...part, id: newId(), movement: { ...part.movement, id: newId() } }
      : part.kind === "rehab" ? { ...part, id: newId() }
        : part.kind === "circuit" ? { ...part, id: newId(), movements: part.movements.map((entry) => ({ ...entry, id: newId() })) }
          : { ...part, id: newId(), intervals: part.intervals.map((entry) => ({ ...entry, id: newId() })) });
    setWorkout(copy); setMenu(null);
  };
  const partSummary = (part: AuthoredWorkoutPart) => {
    if (part.kind === "rehab") return rehabProtocols.find((entry) => entry.id === part.protocolId)?.summary ?? "";
    if (part.kind === "cardio") return part.duration ? `${part.duration} min${part.effort ? ` · ${part.effort}` : ""}` : part.intervals.map(formatAuthoredInterval).join(" / ");
    if (part.kind === "circuit") {
      const plan = part.weeks?.[weekIndex] ?? { rounds: part.rounds };
      return plan.runMetres ? `${plan.rounds} × ${plan.runMetres} m run + station` : `${plan.rounds} rounds`;
    }
    const effective = effectiveAuthoredMovement(part.movement, week, weekIndex);
    const dose = part.movement.dose.kind === "reps" ? effective.reps : part.movement.dose.kind === "hold" ? `${part.movement.dose.seconds} sec` : `${part.movement.dose.metres} m`;
    const load = authoredLoadDisplay(effective.load, catalog.find((entry) => entry.id === part.movement.movementId),
      oneRmByMovementId?.[part.movement.movementId], bodyweightKg).text;
    return `${effective.sets} × ${dose}${load ? ` · ${load}` : ""}`;
  };
  return <form className={`${styles.singleBuilder} ${styles.programSetup}`} onSubmit={(event) => { event.preventDefault(); review(); }}>
    <Link className={styles.inlineLink} href={editBlockId ? `/app/plan?block=${editBlockId}` : "/app/programs"}>{editBlockId ? "Cancel" : "‹ Programs"}</Link>
    <h1 className={styles.srOnly}>{editBlockId ? "Edit program" : "New program"}</h1>
    <div className={styles.titleRow}><input className={styles.titleInput} aria-label="Program name" placeholder="Program name" required maxLength={100}
      value={definition.name} onChange={(event) => update({ ...definition, name: event.target.value })} />
      <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={pending || !definition.workouts.length || (!!preview?.overlaps.length && !acceptOverlap)}>
        {pending ? "Saving..." : editBlockId ? "Save changes" : "Save"}
      </button>
    </div>
    {!editBlockId && replacesName && <p className={styles.muted}>Replaces {replacesName}</p>}
    <details className={styles.builderDetails}><summary>{definition.weeks.length} weeks{startedOn && <> · starts {formatProgramDate(startedOn, true)}</>}</summary>
      <div className={styles.inlineFields}><Field label="Start date"><input className={styles.input} type="date" required min={editBlockId ? undefined : today}
        disabled={!!editBlockId} value={startedOn} onChange={(event) => { setStartedOn(event.target.value); setPreview(null); setRequestId(null); }} /></Field>
        <Field label="Weeks"><select className={styles.select} disabled={!!workoutId} value={definition.weeks.length} onChange={(event) => {
          const count = Number(event.target.value);
          const trim = (movement: AuthoredMovement) => ({ ...movement, overrides: Object.fromEntries(Object.entries(movement.overrides ?? {}).filter(([key]) => Number(key) < count)) });
          update({ ...definition, weeks: Array.from({ length: count }, (_, index) => definition.weeks[index] ?? newWeek()),
            workouts: definition.workouts.map((workout) => ({ ...workout, parts: workout.parts.map((part) => part.kind === "movement" ? { ...part, movement: trim(part.movement) }
              : part.kind === "circuit" ? { ...part, movements: part.movements.map(trim), weeks: Array.from({ length: count }, (_, index) => part.weeks?.[index] ?? { rounds: part.rounds }) } : part) })) });
          setWeekIndex(Math.min(weekIndex, count - 1));
        }}>{Array.from({ length: 16 }, (_, index) => <option key={index} value={index + 1}>{index + 1}</option>)}</select></Field>
      </div>
    </details>
    {workoutId && <Field label="Apply changes to"><select aria-label="Apply changes to" className={styles.select} value={scope} onChange={(event) => {
      setScope(event.target.value as "workout" | "future"); setWeekIndex(initialWeekIndex); setPreview(null); setRequestId(null);
    }}><option value="workout">This workout</option><option value="future">This and future matching workouts</option></select></Field>}
    {error && <p role="alert" className={styles.error}>{error}</p>}
    {error && editBlockId && <button type="button" className={styles.button} disabled={pending} onClick={() => startTransition(async () => {
      try { setCurrent(await reloadAuthoredProgram(editBlockId)); }
      catch { setError("Couldn't reload the program. Your changes are still here."); }
    })}>Reload current version</button>}
    {current && <section className={styles.panel} aria-label="Current program"><h2>{current.definition.name}</h2>
      <Link className={styles.inlineLink} href={`/app/plan?block=${editBlockId}`} target="_blank">View current workouts</Link>
      <button type="button" className={styles.button} onClick={() => {
        const draft = definition.workouts.find((workout) => workout.id === workoutId);
        if (scope !== "program" && draft) setDefinition({ ...current.definition, workouts: current.definition.workouts.map((workout) => workout.id === workoutId ? draft : workout) });
        setEditRevision(current.revision); setCurrent(null); setPreview(null); setRequestId(null); setError(null);
      }}>Reapply my changes</button>
    </section>}
    <h2 className={styles.builderHeading}>Weeks</h2>
    <div className={styles.weekStrip}>{definition.weeks.map((entry, index) => {
      const changed = definition.workouts.some((workout) => workout.parts.some((part) => part.kind === "movement" && Object.keys(part.movement.overrides?.[index] ?? {}).length > 0));
      return <button type="button" key={index} className={styles.weekCard} aria-pressed={index === weekIndex}
        disabled={!!workoutId && (scope === "workout" ? index !== initialWeekIndex : index < initialWeekIndex)}
        onClick={() => { setWeekIndex(index); }}>
        <span data-type={entry.type}>{entry.type === "Build" ? `Week ${index + 1}` : `${index + 1} · ${entry.type}`}
          {changed && <span className={styles.overrideDot} aria-label={`Week ${index + 1} changed`} />}</span>
        <strong>{entry.sets}×{entry.reps} · {entry.pct}%</strong>
      </button>;
    })}</div>
    {editWeek && !workoutId ? <section className={styles.weekEditor} aria-label={`Edit week ${weekIndex + 1}`}>
      <h3>Week {weekIndex + 1}</h3>
      <div className={styles.segment} role="group" aria-label="Week type">{(["Build", "Deload", "Test"] as const).map((type) =>
        <button type="button" key={type} aria-pressed={week.type === type} onClick={() => updateWeek({ type, fewer: type === "Deload" })}>{type}</button>)}</div>
      <Field label="Sets"><input className={styles.input} value={week.sets} onChange={(event) => updateWeek({ sets: event.target.value })} /></Field>
      <Field label="Reps"><input className={styles.input} value={week.reps} onChange={(event) => updateWeek({ reps: event.target.value })} /></Field>
      <Field label="% 1RM"><input className={styles.input} type="number" min={1} max={100} step="0.5" value={week.pct} onChange={(event) => updateWeek({ pct: Number(event.target.value) })} /></Field>
      {week.type === "Deload" && <label className={styles.builderCheck}><input type="checkbox" checked={week.fewer ?? false} onChange={(event) => updateWeek({ fewer: event.target.checked })} />Other exercises: one set fewer</label>}
      <button type="button" className={styles.inlineLink} onClick={() => setEditWeek(false)}>Done</button>
    </section> : !workoutId && <button type="button" className={styles.inlineLink} onClick={() => setEditWeek(true)}>Edit week {weekIndex + 1}</button>}
    <h2 className={styles.builderHeading}>Days · Week {weekIndex + 1}</h2>
    <div className={styles.builderDays}>{DAYS.map((day, weekday) => {
      const workout = definition.workouts.find((entry) => entry.weekday === weekday);
      const open = openDay === weekday;
      if (workoutId && workout?.id !== workoutId) return null;
      return <section key={day} className={styles.builderDay} aria-label={day}>
        <button type="button" className={styles.dayToggle} aria-expanded={open} onClick={() => { setOpenDay(open ? null : weekday); setOpenPart(null); setMenu(null); }}>
          <span>{day.slice(0, 3)}</span><strong>{workout && <span className={styles.activityDot} data-kind={authoredWorkoutActivity(workout, catalog)} aria-hidden="true" />}{workout?.name ?? "Rest"}</strong>
          {workout && <small>{workout.parts.length} {workout.parts.length === 1 ? "exercise" : "exercises"}</small>}
        </button>
        {open && <div className={styles.dayBody}>
          {workout && <details className={styles.builderDetails}><summary>Edit day</summary><div className={styles.inlineFields}>
            <Field label="Workout name"><input className={styles.input} value={workout.name} maxLength={100} onChange={(event) => setWorkout({ ...workout, name: event.target.value })} /></Field>
            {!workoutId && <Field label="Day"><select className={styles.select} aria-label="Day" value={workout.weekday} onChange={(event) => {
              const weekday = Number(event.target.value); setWorkout({ ...workout, weekday }); setOpenDay(weekday);
            }}>{DAYS.map((name, index) => <option key={name} value={index}
              disabled={index !== workout.weekday && definition.workouts.some((entry) => entry.weekday === index)}>{name}</option>)}</select></Field>}
            {!workoutId && <button type="button" className={styles.button} onClick={() => update({ ...definition, workouts: definition.workouts.filter((entry) => entry.id !== workout.id) })}>Rest</button>}
          </div></details>}
          {workout?.parts.map((part, index) => {
            const title = part.kind === "movement" ? catalog.find((entry) => entry.id === part.movement.movementId)?.displayName ?? "Choose an exercise"
              : part.kind === "circuit" ? part.name : part.kind === "rehab" ? rehabProtocols.find((entry) => entry.id === part.protocolId)?.name ?? "Rehab"
                : catalog.find((entry) => entry.id === part.movementId)?.displayName ?? "Cardio";
            const changed = part.kind === "movement" && effectiveAuthoredMovement(part.movement, week, weekIndex).overridden;
            return <div key={part.id} data-testid="builder-exercise">
              <button type="button" className={styles.exerciseRow} aria-expanded={openPart === part.id} onClick={() => setOpenPart(openPart === part.id ? null : part.id)}>
                <span>{part.kind === "movement" && part.movement.role === "main" && <em>Main</em>}{title}
                  {changed && <small>Week {weekIndex + 1} changed</small>}</span>
                <span>{partSummary(part)}</span>
              </button>
              {openPart === part.id && <div className={styles.exerciseEditor}>
                <PartEditor key={`${part.id}:${weekIndex}`} part={part} catalog={definition.activity === "running" ? catalog.filter((entry) => entry.modality === "run") : catalog}
                  rehabProtocols={rehabProtocols} weeks={definition.weeks} weekIndex={weekIndex} loads={loads}
                  onChange={(next) => setWorkout({ ...workout, parts: workout.parts.map((entry) => entry.id === part.id ? next : entry) })} />
                <div className={styles.editorTools}>{[-1, 1].map((delta) => <button type="button" className={styles.iconButton} key={delta}
                  aria-label={delta < 0 ? "Move up" : "Move down"} disabled={index + delta < 0 || index + delta >= workout.parts.length} onClick={() => {
                    const parts = [...workout.parts]; [parts[index], parts[index + delta]] = [parts[index + delta]!, parts[index]!]; setWorkout({ ...workout, parts });
                  }}>{delta < 0 ? "↑" : "↓"}</button>)}
                  <button type="button" className={styles.inlineLink} onClick={() => {
                    setWorkout({ ...workout, parts: workout.parts.filter((entry) => entry.id !== part.id) }); setOpenPart(null);
                  }}>Remove</button>
                </div>
              </div>}
            </div>;
          })}
          <div className={styles.dayTools}>
            <button type="button" className={styles.button} aria-expanded={menu === "add"} onClick={() => setMenu(menu === "add" ? null : "add")}>Add exercise</button>
            {workout && !workoutId && <button type="button" className={styles.inlineLink} aria-expanded={menu === "copy"} onClick={() => setMenu(menu === "copy" ? null : "copy")}>Copy to…</button>}
          </div>
          {menu === "add" && <div className={styles.builderMenu} aria-label="Add exercise">
            {definition.activity !== "running" && <><button type="button" onClick={() => addPart(weekday, "movement")}>Exercise</button>
              <button type="button" onClick={() => addPart(weekday, "circuit")}>Circuit</button></>}
            {definition.activity !== "strength" && <button type="button" onClick={() => addPart(weekday, "cardio")}>Cardio</button>}
            <button type="button" disabled={!rehabProtocols.length} onClick={() => addPart(weekday, "rehab")}>Rehab</button>
            {!rehabProtocols.length && <Link className={styles.inlineLink} href="/app/settings/rehab-protocols" target="_blank">Create a rehab protocol</Link>}
          </div>}
          {menu === "copy" && workout && <div className={styles.builderMenu} aria-label="Copy to another day">{DAYS.map((target, index) => index === weekday ? null
            : <button type="button" key={target} onClick={() => copyTo(workout, index)}>{target}</button>)}</div>}
        </div>}
      </section>;
    })}</div>
    {preview && (preview.overlaps.length > 0 || preview.plannedRest.length > 0) && <section className={styles.notice}>
      {preview.overlaps.length > 0 && <><strong>Workouts on the same day</strong>
        {preview.overlaps.map((entry) => <div key={`${entry.source}:${entry.id}`} className={styles.date}><time>{entry.date}</time><span>{entry.title}</span></div>)}
        <label className={styles.builderCheck}><input type="checkbox" checked={acceptOverlap} onChange={(event) => setAcceptOverlap(event.target.checked)} />Keep both workouts on these dates.</label></>}
      {preview.plannedRest.length > 0 && <p>Includes {preview.plannedRest.length} dates marked as rest in another program.</p>}
      <button type="submit" className={`${styles.button} ${styles.primary}`} disabled={pending || (!!preview.overlaps.length && !acceptOverlap)}>Save</button>
    </section>}
    {confirmReplacement && preview?.replaces && requestId && <ProgramConfirmation name={preview.replaces} pending={pending} error={error}
      onCancel={() => { setConfirmReplacement(false); if (error) { setPreview(null); setRequestId(null); } }}
      onConfirm={() => save(preview, requestId, true)} />}
  </form>;
}
