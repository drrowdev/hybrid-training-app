"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { movePlannedSession, previewPlannedMove, skipPlannedSession, type PlannedMovePreview } from "@/lib/planner/actions";
import { applySwimDateEdit, previewSwimDateEdit, skipSwimWorkout } from "@/lib/swim/actions";
import type { SwimDateEditPreview } from "@/lib/swim/view-types";
import { addDaysToYmd, mondayOfYmd } from "@/lib/dates";
import styles from "./Today.module.css";

export type WorkoutOptionsInput =
  | { kind: "primary"; id: string; startedOn: string; weeks: number; date: string; swapDates: { date: string; title: string }[] }
  | { kind: "swim"; id: string; revision: number; planId: string; planRevision: number; date: string; min: string; max: string; canMove: boolean };

export function WorkoutOptions({ title, input }: { title: string; input: WorkoutOptionsInput }) {
  const [menu, setMenu] = useState(false);
  const [mode, setMode] = useState<"move" | "swap" | "skip">("move");
  const [date, setDate] = useState(input.date);
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<PlannedMovePreview | SwimDateEditPreview | null>(null);
  const [acceptOverlap, setAcceptOverlap] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const label = mode === "skip" ? "Skip workout" : mode === "swap" ? "Swap with another day" : "Move to another day";
  const minimum = input.kind === "primary" ? input.startedOn : input.min;
  const maximum = input.kind === "primary" ? addDaysToYmd(mondayOfYmd(input.startedOn), input.weeks * 7 - 1) : input.max;
  const overlaps = preview?.overlaps ?? [];
  function open(next: typeof mode) {
    setMenu(false); setMode(next); setPreview(null); setError(null); setAcceptOverlap(false);
    setDate(next === "swap" && input.kind === "primary" ? input.swapDates[0]?.date ?? input.date : input.date);
    dialog.current?.showModal();
  }
  function close() { dialog.current?.close(); button.current?.focus(); }
  function submit() {
    setError(null);
    startTransition(async () => {
      try {
        if (mode === "skip") {
          if (input.kind === "primary") {
            const form = new FormData(); form.set("id", input.id); form.set("reason", reason);
            await skipPlannedSession(form);
          } else {
            const result = await skipSwimWorkout(input.id, input.revision, reason);
            if (result.error) throw new Error(result.error);
          }
        } else if (input.kind === "primary") {
          const offset = Math.round((Date.parse(date) - Date.parse(mondayOfYmd(input.startedOn))) / 86_400_000);
          const target = { id: input.id, weekIndex: Math.floor(offset / 7), dayIndex: offset % 7 };
          if (!preview) { setPreview(await previewPlannedMove(target)); return; }
          if (!("requestId" in preview)) throw new Error("Review the date again.");
          const form = new FormData();
          Object.entries(target).forEach(([key, value]) => form.set(key, String(value)));
          form.set("scheduleReview", JSON.stringify({ revision: preview.revision, requestId: preview.requestId, acceptOverlap }));
          await movePlannedSession(form);
        } else {
          if (!preview) {
            const result = await previewSwimDateEdit({
              planId: input.planId, revision: input.planRevision, workoutId: input.id,
              workoutRevision: input.revision, date, reason,
            });
            if (result.error) throw new Error(result.error);
            if (!result.preview) throw new Error("Couldn't preview this date. Try again.");
            setPreview(result.preview); return;
          }
          if (!("workoutId" in preview)) throw new Error("Review the date again.");
          const result = await applySwimDateEdit(preview, acceptOverlap);
          if (result.error) throw new Error(result.error);
        }
        close(); router.refresh();
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Couldn't save this change. Try again.");
      }
    });
  }
  return <div className={styles.options} onBlur={(event) => {
    if (!event.currentTarget.contains(event.relatedTarget)) setMenu(false);
  }} onKeyDown={(event) => {
    if (event.key === "Escape" && menu) { setMenu(false); button.current?.focus(); }
    if (menu && ["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      const items = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1
        : (index + (event.key === "ArrowUp" ? -1 : 1) + items.length) % items.length]?.focus();
    }
  }}>
    <button ref={button} type="button" className={styles.icon} aria-label={`Options for ${title}`}
      aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu(!menu)}>⋯</button>
    {menu && <div className={styles.menu} role="menu" aria-label={`Options for ${title}`}>
      {(input.kind === "primary" || input.canMove) && <button role="menuitem" onClick={() => open("move")}>Move to another day</button>}
      {input.kind === "primary" && input.swapDates.length > 0 &&
        <button role="menuitem" onClick={() => open("swap")}>Swap with another day</button>}
      <button role="menuitem" onClick={() => open("skip")}>Skip workout</button>
    </div>}
    <dialog ref={dialog} className={styles.dialog} aria-label={label} onCancel={() => button.current?.focus()}>
      <div className={styles.right}><h2>{label}</h2><button type="button" className={styles.icon} aria-label="Close" disabled={pending} onClick={close}>×</button></div>
      <form className={styles.form} onSubmit={(event) => { event.preventDefault(); submit(); }}>
        {mode !== "skip" && <label>Date
          {mode === "swap" && input.kind === "primary" ? <select value={date} disabled={pending} onChange={(event) => {
            setDate(event.target.value); setPreview(null); setAcceptOverlap(false);
          }}>{input.swapDates.map((row) => <option key={row.date} value={row.date}>{row.date} · {row.title}</option>)}</select>
            : <input type="date" required min={minimum} max={maximum} value={date} disabled={pending} onChange={(event) => {
              setDate(event.target.value); setPreview(null); setAcceptOverlap(false);
            }} />}
        </label>}
        {(mode === "skip" || input.kind === "swim") && <label>Reason
          <textarea required={input.kind === "swim"} maxLength={1000} value={reason} disabled={pending} onChange={(event) => {
            setReason(event.target.value); setPreview(null); setAcceptOverlap(false);
          }} />
        </label>}
        {preview && "warnings" in preview && preview.warnings.map((warning) => <p key={warning} role="status">{warning}</p>)}
        {preview && "dates" in preview && preview.dates.length > 1 && <p role="status">
          Swap with another day: {input.date} ↔ {date}
        </p>}
        {overlaps.length > 0 && <><ul>{overlaps.map((row) => <li key={row.id}>{row.date} · {row.title}</li>)}</ul>
          <label className={styles.checkbox}><input type="checkbox" checked={acceptOverlap} disabled={pending}
            onChange={(event) => setAcceptOverlap(event.target.checked)} />Keep both workouts on this date</label></>}
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <button className="cp-btn primary" disabled={pending || (mode !== "skip" && date === input.date) || (overlaps.length > 0 && !acceptOverlap)}>
          {pending ? "Saving…" : mode === "skip" ? label : preview ? "Save date" : "Review date"}
        </button>
      </form>
    </dialog>
  </div>;
}
