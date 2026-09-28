"use client";

import { useState, useTransition } from "react";
import type { UpsertResult } from "@/lib/training-maxes/actions";

export function ScheduledMaxProgressionToggle({ initial, action }: {
  initial: boolean; action: (form: FormData) => Promise<UpsertResult>;
}) {
  const [on, setOn] = useState(initial);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const label = "Suggest 1RM increases every 3 weeks";
  function flip() {
    const next = !on;
    const form = new FormData();
    form.set("enabled", String(next));
    setError(null);
    startTransition(async () => {
      try {
        const result = await action(form);
        if (result.ok) setOn(next);
        else setError(result.error);
      } catch {
        setError("Couldn't save this setting. Try again.");
      }
    });
  }
  return <div className="cp-card" style={{ padding: 16, display: "grid", gap: 8 }}>
    <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>{label}</span>
      <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={pending} onClick={flip}
        style={{ flex: "0 0 auto", width: 44, height: 26, borderRadius: 999, border: "none",
          cursor: pending ? "wait" : "pointer", background: on ? "var(--cp-accent)" : "var(--cp-border-strong)", position: "relative" }}>
        <span aria-hidden style={{ position: "absolute", top: 3, left: on ? 21 : 3, width: 20, height: 20,
          borderRadius: "50%", background: on ? "var(--cp-accent-fg)" : "var(--cp-text-muted)", transition: "left .15s" }} />
      </button>
    </div>
    {error && <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>{error}</div>}
  </div>;
}
