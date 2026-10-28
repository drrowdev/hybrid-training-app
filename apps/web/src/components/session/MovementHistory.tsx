"use client";

/**
 * "History" link + bottom sheet listing what the lifter previously logged for
 * one movement, newest session first. Opening it never touches the draft being
 * entered. Data is read when the sheet opens, so it is always current.
 */
import { useEffect, useRef, useState } from "react";
import { getMovementHistory } from "@/lib/sessions/movement-history-actions";
import {
  formatHistoryEntry,
  historySummary,
  weightPrIds,
  type MovementHistory,
} from "@/lib/sessions/movement-history";
import { formatWeight } from "@/lib/stats/units";
import { useUnits } from "@/lib/units/context";

const PAGE = 10;

type State =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; history: MovementHistory };

const dateFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short" });
const yearFormat = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

function sessionDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return (date.getFullYear() === new Date().getFullYear() ? dateFormat : yearFormat).format(date).replace(",", "");
}

export function MovementHistoryButton({
  movementId,
  displayName,
  excludeSessionId,
}: {
  movementId: string;
  displayName: string;
  excludeSessionId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className="cp-link"
        data-testid="movement-history-open"
        aria-label={`${displayName} history`}
        aria-haspopup="dialog"
        onClick={(event) => {
          // Sits inside card headers that toggle on click.
          event.preventDefault();
          event.stopPropagation();
          setOpen(true);
        }}
        style={{ fontSize: 13, minHeight: 44, padding: "0 4px" }}
      >
        History
      </button>
      {open && (
        <MovementHistorySheet
          movementId={movementId}
          displayName={displayName}
          excludeSessionId={excludeSessionId}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function MovementHistorySheet({
  movementId,
  displayName,
  excludeSessionId,
  onClose,
}: {
  movementId: string;
  displayName: string;
  excludeSessionId?: string;
  onClose: () => void;
}) {
  const units = useUnits();
  const [state, setState] = useState<State>({ status: "loading" });
  const [shown, setShown] = useState(PAGE);
  const closeRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    void getMovementHistory(movementId, excludeSessionId)
      .then((result) => {
        if (!active) return;
        setState(result.ok ? { status: "ready", history: result.history } : { status: "error", message: result.error });
      })
      .catch(() => {
        if (active) setState({ status: "error", message: "Couldn't load history." });
      });
    return () => {
      active = false;
    };
  }, [movementId, excludeSessionId]);

  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const history = state.status === "ready" ? state.history : null;
  const summary = history ? historySummary(history) : null;
  const prs = history ? weightPrIds(history) : new Set<string>();

  return (
    <>
      <div className="cp-nav-scrim is-open" onClick={onClose} aria-hidden="true" />
      <div className="cp-nav-sheet is-open" role="dialog" aria-modal="true" aria-label={`${displayName} history`}
        data-testid="movement-history">
        <div className="cp-nav-head">
          <div>
            <h2 className="cp-nav-title">{displayName}</h2>
            <span className="cp-nav-count">History</span>
          </div>
          <button ref={closeRef} type="button" className="cp-nav-close" onClick={onClose}
            aria-label="Close history" data-testid="movement-history-close">✕</button>
        </div>
        <div className="cp-nav-body">
          {state.status === "loading" && <p style={{ color: "var(--cp-text-muted)", fontSize: 13 }}>Loading…</p>}
          {state.status === "error" && (
            <p role="alert" style={{ color: "var(--cp-danger)", fontSize: 13 }}>{state.message}</p>
          )}
          {history && history.sessions.length === 0 && (
            <p style={{ color: "var(--cp-text-muted)", fontSize: 13 }}>Nothing logged yet.</p>
          )}
          {history && history.sessions.length > 0 && summary && (
            <>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 6 }}>
                {summary.heaviest && (
                  <Stat label="Heaviest"
                    value={`${formatWeight(summary.heaviest.weightKg, units)} × ${summary.heaviest.reps}`} />
                )}
                <Stat label="Sessions" value={String(summary.sessions)} />
              </div>
              <ol data-testid="movement-history-list" style={{ listStyle: "none", margin: 0, padding: 0 }}>
                {history.sessions.slice(0, shown).map((session) => (
                  <li key={session.sessionId} data-testid="movement-history-session"
                    style={{ padding: "12px 0", borderBottom: "1px solid var(--cp-border)" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", gap: 12, fontSize: 12,
                      color: "var(--cp-text-muted)", marginBottom: 6 }}>
                      <span style={{ color: "var(--cp-text)", fontWeight: 650 }}>{sessionDate(session.performedAt)}</span>
                      {session.title && <span style={{ textAlign: "right" }}>{session.title}</span>}
                    </div>
                    {session.entries.map((entry, index) => (
                      <div key={entry.id}>
                        <div style={{ display: "grid", gridTemplateColumns: "24px 1fr auto", gap: 8, alignItems: "baseline",
                          padding: "3px 0", opacity: entry.kind === "set" && entry.skipped ? 0.7 : 1 }}>
                          <span className="mono" style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>{index + 1}</span>
                          <span className="mono" style={{ fontSize: 15 }}>
                            {formatHistoryEntry(entry, units)}
                            {prs.has(entry.id) && (
                              <span style={{ marginLeft: 6, fontSize: 10, color: "var(--cp-warning)",
                                border: "1px solid var(--cp-warning)", borderRadius: 6, padding: "1px 5px" }}>PR</span>
                            )}
                          </span>
                          <span className="mono" style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                            {entry.rpe != null ? `RPE ${entry.rpe}` : ""}
                          </span>
                        </div>
                        {entry.notes && (
                          <div style={{ fontSize: 12, color: "var(--cp-text-muted)", margin: "0 0 4px 32px" }}>{entry.notes}</div>
                        )}
                      </div>
                    ))}
                  </li>
                ))}
              </ol>
              {history.sessions.length > shown && (
                <button type="button" className="cp-link" onClick={() => setShown((count) => count + PAGE)}
                  data-testid="movement-history-more" style={{ display: "block", margin: "12px auto 0", minHeight: 44 }}>
                  Show older
                </button>
              )}
              {history.sessions.length <= shown && history.truncated && (
                <p style={{ color: "var(--cp-text-muted)", fontSize: 12, textAlign: "center" }}>
                  Older sessions aren&apos;t shown.
                </p>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background: "var(--cp-surface-soft)", border: "1px solid var(--cp-border)", borderRadius: 12, padding: "8px 10px" }}>
      <div style={{ fontSize: 10, color: "var(--cp-text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{label}</div>
      <div className="mono" style={{ fontSize: 14, fontWeight: 600 }}>{value}</div>
    </div>
  );
}
