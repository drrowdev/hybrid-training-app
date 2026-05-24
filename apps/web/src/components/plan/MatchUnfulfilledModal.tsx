"use client";

/**
 * MatchUnfulfilledModal — UI shell for matching a past planned
 * session to a Strava activity (or quick-logging / marking skipped).
 *
 * Scope of this PR: UI shell + the link action that updates
 * `planned_sessions.completed_session_id` to a chosen session row.
 * The actual Strava-matching backend (importing an activity and
 * surfacing it as a session) is a follow-up — see the PR description
 * for the full plan.
 *
 * The modal accepts a pre-resolved planned row + a list of unlinked
 * Strava-sourced session candidates from the same day. If the user
 * picks one, we call the `linkAction` server action with
 * `{ plannedId, sessionId }`; the page revalidates.
 */
import { useState } from "react";
import { formatDate, type ProfileForFormat } from "@/lib/format/datetime";

export type StravaCandidate = {
  sessionId: string;
  title: string;
  modality: string | null;
  durationMin: number | null;
  stravaActivityId: string | null;
};

function formatHeaderDate(iso: string, profile: ProfileForFormat): string {
  if (!iso) return iso;
  const input = iso.length === 10 ? `${iso}T00:00:00` : iso;
  return formatDate(input, profile, "weekday_short");
}

export type MatchUnfulfilledModalProps = {
  open: boolean;
  onClose: () => void;
  planned: {
    id: string;
    date: string;
    title: string;
    summary?: string;
  } | null;
  candidates: StravaCandidate[];
  /** Server action linking a planned row to a logged session. */
  onLink?: (formData: FormData) => Promise<void> | void;
  /** Server action marking a planned row as skipped. */
  onSkip?: (formData: FormData) => Promise<void> | void;
  formatProfile?: ProfileForFormat;
};

export function MatchUnfulfilledModal({
  open,
  onClose,
  planned,
  candidates,
  onLink,
  onSkip,
  formatProfile,
}: MatchUnfulfilledModalProps) {
  const [pending, setPending] = useState<string | null>(null);
  if (!open || !planned) return null;

  const quickLogHref = `/app/sessions/new?date=${planned.date}&plannedId=${planned.id}`;

  const handleLink = async (sessionId: string) => {
    if (!onLink) return;
    setPending(sessionId);
    const fd = new FormData();
    fd.set("plannedId", planned.id);
    fd.set("sessionId", sessionId);
    try {
      await onLink(fd);
      onClose();
    } finally {
      setPending(null);
    }
  };

  const handleSkip = async () => {
    if (!onSkip) return;
    const fd = new FormData();
    fd.set("id", planned.id);
    fd.set("reason", "user");
    setPending("skip");
    try {
      await onSkip(fd);
      onClose();
    } finally {
      setPending(null);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="match-modal-title"
      data-testid="match-unfulfilled-modal"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0,0,0,0.5)",
        display: "grid",
        placeItems: "center",
        zIndex: 50,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cp-card"
        style={{
          maxWidth: 480,
          width: "100%",
          padding: 20,
          display: "grid",
          gap: 14,
          background: "var(--cp-surface)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
          <div style={{ display: "grid", gap: 2 }}>
            <span
              style={{
                fontSize: 11,
                color: "var(--cp-warning)",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                fontWeight: 600,
              }}
            >
              Past unfulfilled · {planned.date}
            </span>
            <h2 id="match-modal-title" style={{ margin: 0, fontSize: 16 }}>
              <span data-testid="match-modal-planned-title">{planned.title}</span>
              <span style={{ color: "var(--cp-text-muted)", fontWeight: 500 }}>
                {" · "}
                <span data-testid="match-modal-planned-date">{formatHeaderDate(planned.date, formatProfile ?? null)}</span>
              </span>
            </h2>
            {planned.summary && (
              <span
                data-testid="match-modal-planned-summary"
                style={{ fontSize: 12, color: "var(--cp-text-muted)", fontStyle: "italic" }}
              >
                {planned.summary}
              </span>
            )}
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={onClose}
            style={{
              background: "transparent",
              border: 0,
              color: "var(--cp-text-muted)",
              fontSize: 18,
              cursor: "pointer",
            }}
          >
            ×
          </button>
        </div>

        <section style={{ display: "grid", gap: 6 }}>
          <h3 style={{ margin: 0, fontSize: 12, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
            Activities on this day
          </h3>
          {candidates.length === 0 ? (
            <div
              data-testid="match-modal-empty"
              style={{
                padding: 12,
                background: "var(--cp-surface-soft)",
                border: "1px dashed var(--cp-border)",
                borderRadius: 8,
                fontSize: 12,
                color: "var(--cp-text-muted)",
              }}
            >
              No activities found on this date. Quick-log it below or mark it skipped.
            </div>
          ) : (
            <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
              {candidates.map((c) => (
                <li
                  key={c.sessionId}
                  data-testid="match-candidate"
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 10px",
                    border: "1px solid var(--cp-border)",
                    borderRadius: 8,
                    background: "var(--cp-surface-soft)",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 13 }}>
                    <strong>{c.title}</strong>
                    {(c.modality || c.durationMin) && (
                      <span style={{ color: "var(--cp-text-muted)", fontSize: 11, marginLeft: 6 }}>
                        {[c.modality, c.durationMin ? `${c.durationMin} min` : null]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                    )}
                  </span>
                  <button
                    type="button"
                    className="cp-btn primary"
                    style={{ fontSize: 12, padding: "4px 10px" }}
                    disabled={!!pending}
                    onClick={() => handleLink(c.sessionId)}
                    data-testid="match-candidate-link"
                  >
                    {pending === c.sessionId ? "Linking…" : "Link"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
          <button
            type="button"
            className="cp-btn ghost"
            onClick={handleSkip}
            disabled={!!pending || !onSkip}
            data-testid="match-modal-skip"
            style={{ fontSize: 12 }}
          >
            Mark skipped
          </button>
          <a
            href={quickLogHref}
            className="cp-btn"
            data-testid="match-modal-quicklog"
            style={{ fontSize: 12, textDecoration: "none" }}
          >
            Quick log →
          </a>
        </div>
      </div>
    </div>
  );
}
