"use client";

/**
 * EventFormModal — create or edit a priority event.
 *
 * Single component handles both flows: pass `initial` to edit, omit
 * to create. Field set varies by chosen modality (cardio modalities
 * surface distance/time/pace, strength surfaces total + three lifts,
 * padel surfaces rank, other is free description).
 *
 * The performance payload posted to the server matches the loose
 * `performanceSchema` shape — fields the user didn't fill are
 * dropped so we don't store empty strings.
 */
import { useState, useTransition } from "react";
import type { FormEvent, ReactElement } from "react";
import { createEvent, updateEvent } from "@/lib/events/actions";
import {
  EVENT_MODALITIES,
  EVENT_PRIORITIES,
  type EventFormInput,
  type EventModality,
  type EventPerformance,
  type EventPriority,
} from "@/lib/events/schema";
import type { EventRowView } from "./types";

export type EventFormModalProps = {
  open: boolean;
  onClose: () => void;
  initial?: EventRowView | null;
};

function paceFromString(s: string): number | null {
  // Accepts "4:30" or "4.30" or "270" (seconds).
  const trimmed = s.trim();
  if (!trimmed) return null;
  if (/^\d+$/.test(trimmed)) {
    const n = Number.parseInt(trimmed, 10);
    return Number.isFinite(n) ? n : null;
  }
  const m = trimmed.match(/^(\d+)[:.](\d{1,2})$/);
  if (!m) return null;
  return Number.parseInt(m[1]!, 10) * 60 + Number.parseInt(m[2]!, 10);
}

function asNumber(s: string): number | null {
  if (!s.trim()) return null;
  const n = Number.parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function buildPerformance(
  modality: EventModality,
  state: PerfState,
): EventPerformance | null {
  const out: EventPerformance = {};
  if (["run", "bike", "swim", "row", "ski"].includes(modality)) {
    const d = asNumber(state.distance);
    const t = state.time.trim();
    const p = paceFromString(state.pace);
    if (d != null) out.targetDistanceKm = d;
    if (t) out.targetTime = t;
    if (p != null) out.paceSecPerKm = p;
    if (modality === "bike") {
      const w = asNumber(state.power);
      if (w != null) out.avgPowerW = Math.round(w);
    }
  } else if (modality === "strength") {
    const total = asNumber(state.total);
    if (total != null) out.targetTotal = total;
    const lifts: Record<string, number> = {};
    const squat = asNumber(state.squat);
    const bench = asNumber(state.bench);
    const dl = asNumber(state.deadlift);
    if (squat != null) lifts.squat = squat;
    if (bench != null) lifts.bench = bench;
    if (dl != null) lifts.deadlift = dl;
    if (Object.keys(lifts).length > 0) out.lifts = lifts;
  } else if (modality === "padel") {
    if (state.rank.trim()) out.targetRank = state.rank.trim();
  } else {
    if (state.description.trim()) out.description = state.description.trim();
  }
  return Object.keys(out).length > 0 ? out : null;
}

type PerfState = {
  distance: string;
  time: string;
  pace: string;
  power: string;
  total: string;
  squat: string;
  bench: string;
  deadlift: string;
  rank: string;
  description: string;
};

function emptyPerf(): PerfState {
  return {
    distance: "",
    time: "",
    pace: "",
    power: "",
    total: "",
    squat: "",
    bench: "",
    deadlift: "",
    rank: "",
    description: "",
  };
}

function perfFromInitial(p: EventPerformance | null | undefined): PerfState {
  const s = emptyPerf();
  if (!p) return s;
  if (typeof p.targetDistanceKm === "number") s.distance = String(p.targetDistanceKm);
  if (typeof p.targetTime === "string") s.time = p.targetTime;
  if (typeof p.paceSecPerKm === "number") {
    const m = Math.floor(p.paceSecPerKm / 60);
    const ss = p.paceSecPerKm % 60;
    s.pace = `${m}:${String(ss).padStart(2, "0")}`;
  }
  if (typeof p.avgPowerW === "number") s.power = String(p.avgPowerW);
  if (typeof p.targetTotal === "number") s.total = String(p.targetTotal);
  const lifts = p.lifts as Record<string, number> | null | undefined;
  if (lifts && typeof lifts === "object") {
    if (typeof lifts.squat === "number") s.squat = String(lifts.squat);
    if (typeof lifts.bench === "number") s.bench = String(lifts.bench);
    if (typeof lifts.deadlift === "number") s.deadlift = String(lifts.deadlift);
  }
  if (typeof p.targetRank === "string") s.rank = p.targetRank;
  if (typeof p.description === "string") s.description = p.description;
  return s;
}

export function EventFormModal({
  open,
  onClose,
  initial = null,
}: EventFormModalProps): ReactElement | null {
  const [name, setName] = useState(initial?.name ?? "");
  const [eventDate, setEventDate] = useState(initial?.eventDate ?? "");
  const [priority, setPriority] = useState<EventPriority>(initial?.priority ?? "A");
  const [modality, setModality] = useState<EventModality>(
    (initial?.modality as EventModality) ?? "run",
  );
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [perf, setPerf] = useState<PerfState>(perfFromInitial(initial?.targetPerformance));
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  if (!open) return null;

  const onSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) return setError("Pick a date");

    const payload: EventFormInput = {
      name: name.trim(),
      eventDate,
      priority,
      modality,
      notes: notes.trim() ? notes.trim() : null,
      targetPerformance: buildPerformance(modality, perf),
    };

    startTransition(async () => {
      const res = initial
        ? await updateEvent(initial.id, payload)
        : await createEvent(payload);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onClose();
    });
  };

  const fieldStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 10px",
    borderRadius: 8,
    border: "1px solid var(--cp-border)",
    background: "var(--cp-surface-soft, transparent)",
    color: "var(--cp-text)",
    fontSize: 13,
    fontFamily: "inherit",
  };
  const labelStyle: React.CSSProperties = {
    fontSize: 12,
    fontWeight: 600,
    color: "var(--cp-text-muted)",
    display: "block",
    marginBottom: 4,
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="event-modal-title"
      data-testid="event-form-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.55)",
        display: "grid",
        placeItems: "center",
        zIndex: 100,
        padding: 16,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "min(560px, 100%)",
          maxHeight: "calc(100dvh - 48px)",
          overflowY: "auto",
          background: "var(--cp-panel-strong, var(--cp-surface))",
          border: "1px solid var(--cp-border)",
          borderRadius: 14,
          padding: 20,
          color: "var(--cp-text)",
        }}
      >
        <header style={{ marginBottom: 16 }}>
          <h2 id="event-modal-title" style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>
            {initial ? "Edit event" : "Add event"}
          </h2>
          <p style={{ margin: "4px 0 0", fontSize: 12, color: "var(--cp-text-muted)" }}>
            Mark a race, comp, meet or test so the planner can suggest a taper.
          </p>
        </header>

        <div style={{ display: "grid", gap: 14 }}>
          <div>
            <label htmlFor="ev-name" style={labelStyle}>Name</label>
            <input
              id="ev-name"
              data-testid="ev-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={120}
              required
              style={fieldStyle}
              placeholder="Half marathon / squat meet / club ladder final"
            />
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label htmlFor="ev-date" style={labelStyle}>Date</label>
              <input
                id="ev-date"
                data-testid="ev-date"
                type="date"
                value={eventDate}
                onChange={(e) => setEventDate(e.target.value)}
                required
                style={fieldStyle}
              />
            </div>
            <div>
              <label htmlFor="ev-priority" style={labelStyle}>Priority</label>
              <select
                id="ev-priority"
                data-testid="ev-priority"
                value={priority}
                onChange={(e) => setPriority(e.target.value as EventPriority)}
                style={fieldStyle}
              >
                {EVENT_PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p === "A" ? "A — peak" : p === "B" ? "B — important" : "C — logged"}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ev-modality" style={labelStyle}>Modality</label>
            <select
              id="ev-modality"
              data-testid="ev-modality"
              value={modality}
              onChange={(e) => setModality(e.target.value as EventModality)}
              style={fieldStyle}
            >
              {EVENT_MODALITIES.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>

          <fieldset
            data-testid="ev-perf"
            style={{ border: "1px dashed var(--cp-border)", borderRadius: 8, padding: 10, margin: 0 }}
          >
            <legend style={{ ...labelStyle, padding: "0 6px" }}>Target performance (optional)</legend>
            <PerfFields modality={modality} state={perf} setState={setPerf} fieldStyle={fieldStyle} labelStyle={labelStyle} />
          </fieldset>

          <div>
            <label htmlFor="ev-notes" style={labelStyle}>Notes</label>
            <textarea
              id="ev-notes"
              data-testid="ev-notes"
              rows={3}
              maxLength={2000}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              style={{ ...fieldStyle, resize: "vertical" }}
            />
          </div>

          {error && (
            <div
              role="alert"
              data-testid="ev-error"
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                background: "var(--cp-danger-soft, rgba(239,68,68,0.12))",
                color: "var(--cp-danger, #ef4444)",
                fontSize: 12,
                border: "1px solid var(--cp-danger, #ef4444)",
              }}
            >
              {error}
            </div>
          )}

          <footer style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
            <button
              type="button"
              data-testid="ev-cancel"
              onClick={onClose}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--cp-border)",
                background: "transparent",
                color: "var(--cp-text-muted)",
                fontSize: 13,
                cursor: "pointer",
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              data-testid="ev-save"
              disabled={pending}
              style={{
                padding: "8px 14px",
                borderRadius: 8,
                border: "1px solid var(--cp-accent, var(--cp-text))",
                background: "var(--cp-accent, var(--cp-text))",
                color: "var(--cp-accent-fg, var(--cp-bg))",
                fontSize: 13,
                fontWeight: 600,
                cursor: pending ? "wait" : "pointer",
                opacity: pending ? 0.7 : 1,
              }}
            >
              {pending ? "Saving…" : "Save"}
            </button>
          </footer>
        </div>
      </form>
    </div>
  );
}

function PerfFields({
  modality,
  state,
  setState,
  fieldStyle,
  labelStyle,
}: {
  modality: EventModality;
  state: PerfState;
  setState: React.Dispatch<React.SetStateAction<PerfState>>;
  fieldStyle: React.CSSProperties;
  labelStyle: React.CSSProperties;
}) {
  const setField = (k: keyof PerfState) => (v: string) =>
    setState((prev) => ({ ...prev, [k]: v }));

  if (["run", "bike", "swim", "row", "ski"].includes(modality)) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={labelStyle}>Distance (km)</label>
          <input data-testid="perf-distance" type="number" step="0.001" min={0} value={state.distance} onChange={(e) => setField("distance")(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Target time</label>
          <input data-testid="perf-time" type="text" placeholder="1:35:00" value={state.time} onChange={(e) => setField("time")(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Pace (min:sec/km)</label>
          <input data-testid="perf-pace" type="text" placeholder="4:30" value={state.pace} onChange={(e) => setField("pace")(e.target.value)} style={fieldStyle} />
        </div>
        {modality === "bike" && (
          <div>
            <label style={labelStyle}>Avg power (W)</label>
            <input data-testid="perf-power" type="number" min={0} value={state.power} onChange={(e) => setField("power")(e.target.value)} style={fieldStyle} />
          </div>
        )}
      </div>
    );
  }
  if (modality === "strength") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div>
          <label style={labelStyle}>Total (kg)</label>
          <input data-testid="perf-total" type="number" min={0} value={state.total} onChange={(e) => setField("total")(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Squat (kg)</label>
          <input data-testid="perf-squat" type="number" min={0} value={state.squat} onChange={(e) => setField("squat")(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Bench (kg)</label>
          <input data-testid="perf-bench" type="number" min={0} value={state.bench} onChange={(e) => setField("bench")(e.target.value)} style={fieldStyle} />
        </div>
        <div>
          <label style={labelStyle}>Deadlift (kg)</label>
          <input data-testid="perf-deadlift" type="number" min={0} value={state.deadlift} onChange={(e) => setField("deadlift")(e.target.value)} style={fieldStyle} />
        </div>
      </div>
    );
  }
  if (modality === "padel") {
    return (
      <div>
        <label style={labelStyle}>Target rank / category</label>
        <input data-testid="perf-rank" type="text" placeholder="e.g. Liiga 3" value={state.rank} onChange={(e) => setField("rank")(e.target.value)} style={fieldStyle} />
      </div>
    );
  }
  return (
    <div>
      <label style={labelStyle}>Description</label>
      <input data-testid="perf-description" type="text" maxLength={500} value={state.description} onChange={(e) => setField("description")(e.target.value)} style={fieldStyle} />
    </div>
  );
}
