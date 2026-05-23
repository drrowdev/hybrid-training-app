"use client";

/**
 * Post-session summary card (Phase 1 C1 / C2).
 *
 * Rendered at the top of a *completed* session detail page. The numbers
 * (tonnage, duration, PR count) are computed on-the-fly server-side in
 * `summariseSessionSets` and passed in as props — there's no new
 * schema column.
 *
 * "Done" sends the user back to /app; "Add a note" expands an inline
 * textarea that submits via the `updateSessionNotes` server action.
 */

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { SessionSummary } from "@/lib/sessions/queries";
import { updateSessionNotes } from "@/lib/sessions/actions";

export function PostSessionSummary({
  sessionId,
  summary,
  initialNotes,
}: {
  sessionId: string;
  summary: SessionSummary;
  initialNotes: string | null;
}) {
  const [showNote, setShowNote] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(initialNotes);
  const [error, setError] = useState<string | null>(null);

  const submitNote = async (fd: FormData) => {
    setError(null);
    fd.set("sessionId", sessionId);
    const result = await updateSessionNotes(fd);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSavedNote(String(fd.get("notes") ?? "").trim() || null);
    setShowNote(false);
  };

  return (
    <section
      data-testid="post-session-summary"
      className="cp-card"
      style={{
        padding: 24,
        display: "grid",
        gap: 16,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: "var(--cp-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
          }}
        >
          Session complete
        </div>
        <h2 style={{ fontSize: 24, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
          Session complete!
        </h2>
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 10,
        }}
      >
        <SummaryStat
          label="Tonnage"
          value={summary.totalTonnageKg > 0 ? `${formatKg(summary.totalTonnageKg)} kg` : "—"}
          testId="summary-tonnage"
        />
        <SummaryStat
          label="Duration"
          value={summary.durationMin != null ? `${summary.durationMin} min` : "—"}
          testId="summary-duration"
        />
        <SummaryStat
          label="Sets"
          value={`${summary.workingSetCount}`}
          testId="summary-sets"
        />
        <SummaryStat
          label="PRs"
          value={`${summary.prCount}`}
          highlight={summary.prCount > 0}
          testId="summary-prs"
        />
      </div>

      {savedNote && !showNote && (
        <div
          style={{
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Note
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text)", whiteSpace: "pre-wrap" }}>
            {savedNote}
          </p>
        </div>
      )}

      {showNote && (
        <form action={submitNote} style={{ display: "grid", gap: 8 }}>
          <label
            htmlFor="post-session-note"
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Anything to remember?
          </label>
          <textarea
            id="post-session-note"
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={savedNote ?? ""}
            placeholder="What worked, what hurt, anything to chase next time."
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: "var(--cp-danger)" }} role="alert">
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SaveNoteButton />
            <button
              type="button"
              className="cp-btn ghost"
              onClick={() => {
                setShowNote(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!showNote && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <Link href="/app" className="cp-btn primary big" data-testid="summary-done" style={{ flex: "1 1 auto" }}>
            Done
          </Link>
          <button
            type="button"
            className="cp-btn"
            onClick={() => setShowNote(true)}
            style={{ minHeight: 48 }}
          >
            {savedNote ? "Edit note" : "Add a note"}
          </button>
        </div>
      )}
    </section>
  );
}

function SaveNoteButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cp-btn primary" disabled={pending} style={{ minHeight: 48 }}>
      {pending ? "Saving…" : "Save note"}
    </button>
  );
}

function SummaryStat({
  label,
  value,
  highlight,
  testId,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        background: "var(--cp-surface)",
        border: `1px solid ${highlight ? "var(--cp-accent)" : "var(--cp-border)"}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 20,
          fontWeight: 700,
          marginTop: 2,
          color: highlight ? "var(--cp-accent)" : "var(--cp-text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatKg(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 100) / 10}k`;
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n.toFixed(1);
}
