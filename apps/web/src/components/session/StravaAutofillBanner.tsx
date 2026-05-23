"use client";

/**
 * Strava autofill banner (Phase 2 C2 / C3).
 *
 * Shows at the top of an in-progress session detail page when a recent
 * Strava activity matches the session's performed_at within ±90 min.
 * Two actions: ``Use`` (calls the server action and replaces the banner
 * with a green check) and ``Dismiss`` (hides the banner for the rest of
 * the session view; no nag).
 *
 * If no Strava match is found, the parent page passes ``match = null``
 * and the banner doesn't render — silent graceful no-op (C3).
 */

import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { applyStravaAutofill } from "@/lib/sessions/actions";

export type StravaAutofillMatch = {
  cardioLogId: string;
  stravaActivityId: string;
  modality: string;
  durationSec: number;
  distanceKm: number | null;
  avgHrBpm: number | null;
};

type Action = typeof applyStravaAutofill;

export function StravaAutofillBanner({
  sessionId,
  match,
  applyAction,
}: {
  sessionId: string;
  match: StravaAutofillMatch;
  applyAction: Action;
}) {
  const [state, setState] = useState<"idle" | "applied" | "dismissed">("idle");
  const [error, setError] = useState<string | null>(null);

  if (state === "dismissed") return null;

  const submit = async (fd: FormData) => {
    setError(null);
    fd.set("sessionId", sessionId);
    fd.set("cardioLogId", match.cardioLogId);
    const result = await applyAction(fd);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setState("applied");
  };

  const minutes = Math.round(match.durationSec / 60);
  const distance = match.distanceKm != null ? `${match.distanceKm.toFixed(1)} km` : null;
  const hr = match.avgHrBpm != null ? `${match.avgHrBpm} bpm` : null;
  const summary = [
    `${minutes} min`,
    distance,
    hr ? `${hr} avg HR` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <section
      data-testid="strava-autofill"
      data-state={state}
      className="cp-card"
      style={{
        padding: 14,
        display: "flex",
        gap: 12,
        alignItems: "center",
        flexWrap: "wrap",
        borderColor: state === "applied" ? "var(--cp-success)" : "var(--cp-accent)",
        background:
          state === "applied"
            ? "color-mix(in oklab, var(--cp-success) 8%, transparent)"
            : "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div
        aria-hidden
        style={{
          fontSize: 18,
          lineHeight: 1,
          minWidth: 22,
          textAlign: "center",
        }}
      >
        {state === "applied" ? "✓" : "⟲"}
      </div>
      <div style={{ display: "grid", gap: 2, flex: 1, minWidth: 180 }}>
        <div
          style={{
            fontSize: 11,
            color: state === "applied" ? "var(--cp-success)" : "var(--cp-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
          }}
        >
          {state === "applied" ? "Autofilled from Strava" : "Strava activity nearby"}
        </div>
        <div style={{ fontSize: 14, color: "var(--cp-text)" }} className="mono">
          {match.modality} · {summary}
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--cp-danger)" }} role="alert">
            {error}
          </div>
        )}
      </div>
      {state === "idle" && (
        <div style={{ display: "flex", gap: 8 }}>
          <form action={submit}>
            <ApplyButton />
          </form>
          <button
            type="button"
            className="cp-btn ghost"
            data-testid="strava-autofill-dismiss"
            onClick={() => setState("dismissed")}
            style={{ minHeight: 40 }}
          >
            Dismiss
          </button>
        </div>
      )}
    </section>
  );
}

function ApplyButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="cp-btn primary"
      disabled={pending}
      data-testid="strava-autofill-use"
      style={{ minHeight: 40 }}
    >
      {pending ? "Filling…" : "Use"}
    </button>
  );
}
