"use client";

/**
 * Change the day a finished workout is attributed to. Sits under the crumb on
 * the session page; saves through `updateSessionDate` and refreshes.
 */
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateSessionDate } from "@/lib/sessions/actions";

export function SessionDateEditor({
  sessionId,
  performedOn,
  minYmd,
  maxYmd,
}: {
  sessionId: string;
  performedOn: string;
  minYmd: string;
  maxYmd: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(performedOn);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () => {
    if (date === performedOn) {
      setOpen(false);
      return;
    }
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("sessionId", sessionId);
      fd.set("performedOn", date);
      const res = await updateSessionDate(fd);
      if (!res.ok) {
        setError(res.error ?? "Couldn't change the date. Try again.");
        return;
      }
      setOpen(false);
      router.refresh();
    });
  };

  if (!open) {
    return (
      <button
        type="button"
        className="cp-link"
        data-testid="session-date-edit"
        onClick={() => { setDate(performedOn); setError(null); setOpen(true); }}
        style={{ fontSize: 12, minHeight: 32, padding: 0 }}
      >
        Change date
      </button>
    );
  }

  return (
    <div style={{ display: "grid", gap: 4, margin: "6px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <input
          type="date"
          value={date}
          min={minYmd}
          max={maxYmd}
          onChange={(e) => setDate(e.target.value)}
          aria-label="Date performed"
          data-testid="session-date-input"
          style={{
            padding: "6px 8px", borderRadius: 8, fontSize: 14,
            border: "1px solid var(--cp-border)", background: "var(--cp-surface)", color: "var(--cp-text)",
          }}
        />
        <button type="button" className="cp-btn primary" data-testid="session-date-save"
          disabled={pending || date.length === 0} onClick={save} style={{ padding: "6px 12px", fontSize: 13 }}>
          {pending ? "Saving…" : "Save"}
        </button>
        <button type="button" className="cp-btn ghost" disabled={pending}
          onClick={() => setOpen(false)} style={{ padding: "6px 12px", fontSize: 13 }}>
          Cancel
        </button>
      </div>
      {error && <span role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>{error}</span>}
    </div>
  );
}
