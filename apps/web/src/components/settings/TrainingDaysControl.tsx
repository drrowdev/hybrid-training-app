"use client";

import { useRef, useState, useTransition } from "react";
import { updateProfile } from "@/lib/settings/actions";

type Status = "idle" | "saving" | "saved" | "error";

const FREQ = [3, 4, 5, 6, 7];

export function TrainingDaysControl({ initial }: { initial: number }) {
  const [value, setValue] = useState<number>(initial);
  const [status, setStatus] = useState<Status>("idle");
  const [, startTransition] = useTransition();
  const lastSaved = useRef<number>(initial);

  const pick = (n: number) => {
    setValue(n);
    if (n === lastSaved.current) return;
    const fd = new FormData();
    fd.set("trainingDaysPerWeek", String(n));
    setStatus("saving");
    startTransition(async () => {
      try {
        await updateProfile(fd);
        lastSaved.current = n;
        setStatus("saved");
        window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1800);
      } catch {
        setStatus("error");
      }
    });
  };

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
      {FREQ.map((n) => {
        const sel = n === value;
        return (
          <button
            type="button"
            key={n}
            onClick={() => pick(n)}
            aria-pressed={sel}
            style={{
              padding: "8px 16px",
              borderRadius: 999,
              border: `1px solid ${sel ? "var(--cp-accent)" : "var(--cp-border)"}`,
              background: sel ? "var(--cp-accent-soft)" : "var(--cp-surface)",
              color: sel ? "var(--cp-accent)" : "var(--cp-text)",
              fontWeight: sel ? 600 : 500,
              fontSize: 13,
              cursor: "pointer",
            }}
          >
            {n} d/wk
          </button>
        );
      })}
      <StatusBadge status={status} />
    </div>
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "idle") return null;
  if (status === "saving")
    return <span style={{ fontSize: 11, color: "var(--cp-text-muted)", marginLeft: 4 }}>saving…</span>;
  if (status === "saved")
    return <span style={{ fontSize: 11, color: "var(--cp-success)", fontWeight: 600, marginLeft: 4 }}>✓ saved</span>;
  return <span style={{ fontSize: 11, color: "var(--cp-danger)", fontWeight: 600, marginLeft: 4 }}>✗ failed</span>;
}
