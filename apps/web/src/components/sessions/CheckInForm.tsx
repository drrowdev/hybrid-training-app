"use client";

import { useState, useTransition } from "react";
import Link from "next/link";

type Level = 1 | 2 | 3 | 4 | 5;

const FATIGUE_OPTIONS: { value: Level; label: string; hint: string }[] = [
  { value: 1, label: "Fresh", hint: "Slept well, ready to go" },
  { value: 2, label: "Good", hint: "Solid, no complaints" },
  { value: 3, label: "Neutral", hint: "Average day" },
  { value: 4, label: "Tired", hint: "Stress or short sleep" },
  { value: 5, label: "Cooked", hint: "Drained, fighting through it" },
];

const SORENESS_OPTIONS: { value: Level; label: string; hint: string }[] = [
  { value: 1, label: "None", hint: "Body feels normal" },
  { value: 2, label: "Mild", hint: "Faint awareness of yesterday" },
  { value: 3, label: "Moderate", hint: "Stiff in spots, fades when warm" },
  { value: 4, label: "High", hint: "Sore enough to limit movement" },
  { value: 5, label: "Severe", hint: "Painful — would skip if pushed" },
];

export function CheckInForm({
  plannedId,
  sessionTitle,
  startAction,
}: {
  plannedId: string;
  sessionTitle: string;
  startAction: (fd: FormData) => Promise<void>;
}) {
  const [fatigue, setFatigue] = useState<Level | null>(null);
  const [soreness, setSoreness] = useState<Level | null>(null);
  const [notes, setNotes] = useState("");
  const [isPending, startTransition] = useTransition();

  const submit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (fatigue == null || soreness == null) return;
    const fd = new FormData();
    fd.set("id", plannedId);
    fd.set("fatigue", String(fatigue));
    fd.set("soreness", String(soreness));
    if (notes.trim()) fd.set("notes", notes.trim());
    startTransition(async () => {
      await startAction(fd);
    });
  };

  const skip = () => {
    const fd = new FormData();
    fd.set("id", plannedId);
    startTransition(async () => {
      await startAction(fd);
    });
  };

  const ready = fatigue != null && soreness != null;

  return (
    <form onSubmit={submit} style={{ display: "grid", gap: 18 }}>
      <header>
        <div style={{ fontSize: 11, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
          Pre-session check-in
        </div>
        <h1 style={{ fontSize: 24, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
          How are you feeling today?
        </h1>
        <p style={{ margin: "6px 0 0", color: "var(--cp-text-muted)", fontSize: 13, lineHeight: 1.5 }}>
          Two quick taps. We use this to nudge today&apos;s top set up or down so the planner
          actually meets you where you are.
        </p>
      </header>

      <section className="cp-card" style={{ padding: 18, display: "grid", gap: 8 }}>
        <Label>Fatigue</Label>
        <ChipRow
          options={FATIGUE_OPTIONS}
          value={fatigue}
          onChange={(v) => setFatigue(v)}
          ariaLabel="Fatigue level"
        />
        {fatigue != null && (
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.4 }}>
            {FATIGUE_OPTIONS.find((o) => o.value === fatigue)?.hint}
          </div>
        )}
      </section>

      <section className="cp-card" style={{ padding: 18, display: "grid", gap: 8 }}>
        <Label>Soreness</Label>
        <ChipRow
          options={SORENESS_OPTIONS}
          value={soreness}
          onChange={(v) => setSoreness(v)}
          ariaLabel="Soreness level"
        />
        {soreness != null && (
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)", lineHeight: 1.4 }}>
            {SORENESS_OPTIONS.find((o) => o.value === soreness)?.hint}
          </div>
        )}
      </section>

      <section className="cp-card" style={{ padding: 18, display: "grid", gap: 8 }}>
        <Label>Notes <span style={{ color: "var(--cp-text-muted)", fontWeight: 400 }}>(optional)</span></Label>
        <input
          type="text"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          maxLength={280}
          placeholder="Anything worth noting — sleep, stress, hydration…"
          style={{ padding: "8px 10px", fontSize: 14 }}
        />
      </section>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <button
          type="button"
          onClick={skip}
          disabled={isPending}
          className="cp-btn ghost"
          style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
        >
          Skip check-in →
        </button>
        <button
          type="submit"
          disabled={!ready || isPending}
          className="cp-btn primary big"
        >
          {isPending ? "Starting…" : `⚡ Start ${sessionTitle}`}
        </button>
      </div>

      <div style={{ textAlign: "center" }}>
        <Link href="/app" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          ← back to today
        </Link>
      </div>
    </form>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontSize: 11,
        color: "var(--cp-text-muted)",
        textTransform: "uppercase",
        letterSpacing: "0.06em",
        fontWeight: 600,
      }}
    >
      {children}
    </span>
  );
}

function ChipRow({
  options,
  value,
  onChange,
  ariaLabel,
}: {
  options: { value: Level; label: string }[];
  value: Level | null;
  onChange: (v: Level) => void;
  ariaLabel: string;
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {options.map((opt) => {
        const sel = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={sel}
            onClick={() => onChange(opt.value)}
            style={{
              flex: 1,
              minWidth: 60,
              padding: "10px 8px",
              borderRadius: 999,
              border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
              background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
              color: sel ? "var(--cp-accent)" : "var(--cp-text)",
              fontWeight: sel ? 600 : 500,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            <div className="mono" style={{ fontSize: 10, opacity: 0.7 }}>{opt.value}</div>
            <div>{opt.label}</div>
          </button>
        );
      })}
    </div>
  );
}
