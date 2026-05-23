"use client";

/**
 * HowRecoveredCard — inline 1/3/5/7/9 fatigue + soreness check-in.
 *
 * Lives just below the hero on the Today page. The user taps one
 * button per row; we fire the server action immediately (no Save
 * button). Once both rows are answered the card replaces itself with
 * a small "✓ logged" confirmation. The parent decides whether to
 * render this at all — see `apps/web/src/app/app/page.tsx`.
 */

import { useState, useTransition } from "react";
import type { RecordCheckInAction } from "./BodyweightNudge";

const SCALE = [1, 3, 5, 7, 9] as const;

export function HowRecoveredCard({
  todayYmd,
  initialFatigue,
  initialSoreness,
  recordDailyCheckIn,
}: {
  todayYmd: string;
  initialFatigue: number | null;
  initialSoreness: number | null;
  recordDailyCheckIn: RecordCheckInAction;
}) {
  const [fatigue, setFatigue] = useState<number | null>(initialFatigue);
  const [soreness, setSoreness] = useState<number | null>(initialSoreness);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const submit = (field: "fatigue" | "soreness", value: number) => {
    setError(null);
    const fd = new FormData();
    fd.set("date", todayYmd);
    fd.set(field, String(value));
    startTransition(async () => {
      const res = await recordDailyCheckIn(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      if (field === "fatigue") setFatigue(value);
      else setSoreness(value);
    });
  };

  const done = fatigue != null && soreness != null;

  if (done) {
    return (
      <section
        className="cp-card"
        data-testid="how-recovered-saved"
        style={{ padding: 14, fontSize: 13, color: "var(--cp-text-muted)" }}
      >
        <span style={{ color: "var(--cp-success)", fontWeight: 700 }}>✓</span>{" "}
        Recovery logged · fatigue {fatigue} · soreness {soreness}. Tomorrow&apos;s prescription will weight this in.
      </section>
    );
  }

  return (
    <section
      className="cp-card"
      data-testid="how-recovered"
      style={{ padding: 18, display: "grid", gap: 12 }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.12em",
            fontWeight: 600,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            marginBottom: 4,
          }}
        >
          How recovered?
        </div>
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          Today&apos;s fatigue and soreness bias the AI suggester. Tap to log.
        </div>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 18,
        }}
      >
        <ScaleRow
          title="Fatigue"
          hint="1 fresh · 9 wrecked"
          value={fatigue}
          disabled={isPending}
          onPick={(v) => submit("fatigue", v)}
          testidPrefix="fatigue"
        />
        <ScaleRow
          title="Soreness"
          hint="1 none · 9 severe"
          value={soreness}
          disabled={isPending}
          onPick={(v) => submit("soreness", v)}
          testidPrefix="soreness"
        />
      </div>
      {error && (
        <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
          {error}
        </div>
      )}
    </section>
  );
}

function ScaleRow({
  title,
  hint,
  value,
  disabled,
  onPick,
  testidPrefix,
}: {
  title: string;
  hint: string;
  value: number | null;
  disabled: boolean;
  onPick: (n: number) => void;
  testidPrefix: string;
}) {
  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          fontSize: 11,
          color: "var(--cp-text-muted)",
          marginBottom: 6,
        }}
      >
        <span
          style={{
            fontWeight: 600,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "var(--cp-text)",
          }}
        >
          {title}
        </span>
        <span>{hint}</span>
      </div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(5, 1fr)",
          gap: 6,
        }}
      >
        {SCALE.map((n) => {
          const selected = value === n;
          return (
            <button
              key={n}
              type="button"
              data-testid={`${testidPrefix}-${n}`}
              aria-pressed={selected}
              disabled={disabled}
              onClick={() => onPick(n)}
              style={{
                background: selected
                  ? "var(--cp-accent)"
                  : "var(--cp-surface-soft)",
                color: selected
                  ? "var(--cp-accent-fg, #fff)"
                  : "var(--cp-text)",
                border: `1px solid ${selected ? "var(--cp-accent)" : "var(--cp-border)"}`,
                padding: "10px 0",
                borderRadius: 8,
                fontSize: 14,
                fontWeight: selected ? 700 : 500,
                cursor: disabled ? "default" : "pointer",
              }}
            >
              {n}
            </button>
          );
        })}
      </div>
    </div>
  );
}
