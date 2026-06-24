"use client";

/**
 * Strava sync banner — three-state surface at the top of an in-progress
 * session detail page.
 *
 *   State A — Connected, no nearby match (neutral)
 *     "No Strava activity found · last synced 12m ago"
 *     [Sync now]
 *
 *   State B — Syncing in progress (spin)
 *     "Syncing with Strava…"
 *     (no actions; the spinner replaces the action area)
 *
 *   State C — Connected, match found (accent — the historical "Use/Dismiss"
 *     surface)
 *
 * The component renders for any session whose owner has a Strava
 * connection, regardless of whether a match exists, because the "no
 * match" surface is the most-used surface in practice (the user wants
 * to know nothing's been imported yet). When the user is NOT connected,
 * the parent skips this component entirely.
 *
 * Manual "Sync now" is wired to the same server action as the settings
 * page sync; on success the page revalidates and a fresh banner reflects
 * the new last_synced_at / match.
 */

import { useState, useTransition } from "react";
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

type ApplyAction = typeof applyStravaAutofill;
type SyncAction = () => Promise<{ ok: true } | { ok: false; error: string }>;

export type BannerState = "no_match" | "syncing" | "match" | "applied" | "dismissed";

/** Pure helper: what state should we render given inputs? Exported for tests. */
export function pickBannerState({
  match,
  syncing,
  applied,
  dismissed,
}: {
  match: StravaAutofillMatch | null;
  syncing: boolean;
  applied: boolean;
  dismissed: boolean;
}): BannerState {
  if (dismissed) return "dismissed";
  if (applied) return "applied";
  if (syncing) return "syncing";
  if (match) return "match";
  return "no_match";
}

/** Pure helper: humanise "minutes ago" / "h ago". Exported for tests. */
export function formatLastSynced(
  lastSyncedAt: Date | string | null,
  now: Date = new Date(),
): string {
  if (lastSyncedAt == null) return "never synced";
  const then =
    lastSyncedAt instanceof Date ? lastSyncedAt : new Date(lastSyncedAt);
  const deltaMs = now.getTime() - then.getTime();
  if (deltaMs < 60_000) return "just now";
  const minutes = Math.round(deltaMs / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function StravaAutofillBanner({
  sessionId,
  match,
  applyAction,
  syncAction,
  lastSyncedAt,
}: {
  sessionId: string;
  match: StravaAutofillMatch | null;
  applyAction: ApplyAction;
  syncAction: SyncAction;
  lastSyncedAt: Date | string | null;
}) {
  const [applied, setApplied] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [syncing, startSync] = useTransition();

  const state = pickBannerState({ match, syncing, applied, dismissed });

  if (state === "dismissed") return null;

  const submitApply = async (fd: FormData) => {
    if (!match) return;
    setError(null);
    fd.set("sessionId", sessionId);
    fd.set("cardioLogId", match.cardioLogId);
    const result = await applyAction(fd);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setApplied(true);
  };

  const onSyncNow = () => {
    setError(null);
    startSync(async () => {
      const result = await syncAction();
      if (!result.ok) setError(result.error);
    });
  };

  const accent =
    state === "applied"
      ? "var(--cp-success)"
      : state === "match"
        ? "var(--cp-accent)"
        : "var(--cp-border)";
  const bg =
    state === "applied"
      ? "color-mix(in oklab, var(--cp-success) 8%, transparent)"
      : state === "match"
        ? "color-mix(in oklab, var(--cp-accent) 6%, transparent)"
        : "var(--cp-surface)";

  const eyebrow =
    state === "applied"
      ? "Autofilled from Strava"
      : state === "syncing"
        ? "Syncing with Strava…"
        : state === "match"
          ? "Strava activity nearby"
          : "Strava — no match yet";
  const eyebrowColor =
    state === "applied"
      ? "var(--cp-success)"
      : state === "match"
        ? "var(--cp-accent)"
        : "var(--cp-text-muted)";

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
        borderColor: accent,
        background: bg,
      }}
    >
      <div
        aria-hidden
        data-testid="strava-autofill-icon"
        style={{
          fontSize: 18,
          lineHeight: 1,
          minWidth: 22,
          textAlign: "center",
          ...(state === "syncing"
            ? {
                animation: "cp-spin 1s linear infinite",
                display: "inline-block",
              }
            : null),
        }}
      >
        {state === "applied" ? "✓" : state === "syncing" ? "⟳" : "⟲"}
      </div>
      <div style={{ display: "grid", gap: 2, flex: 1, minWidth: 180 }}>
        <div
          style={{
            fontSize: 11,
            color: eyebrowColor,
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
          }}
        >
          {eyebrow}
        </div>
        <div
          style={{ fontSize: 14, color: "var(--cp-text)" }}
          data-testid="strava-autofill-summary"
        >
          {state === "match" || state === "applied"
            ? `${match!.modality} · ${formatMatch(match!)}`
            : state === "syncing"
              ? "Checking Strava for new activities"
              : `No activity in window · last synced ${formatLastSynced(lastSyncedAt)}`}
        </div>
        {error && (
          <div style={{ fontSize: 12, color: "var(--cp-danger)" }} role="alert">
            {error}
          </div>
        )}
      </div>
      {state === "match" && (
        <div style={{ display: "flex", gap: 8 }}>
          <form action={submitApply}>
            <ApplyButton />
          </form>
          <button
            type="button"
            className="cp-btn ghost"
            data-testid="strava-autofill-dismiss"
            onClick={() => setDismissed(true)}
            style={{ minHeight: 40 }}
          >
            Dismiss
          </button>
        </div>
      )}
      {state === "no_match" && (
        <button
          type="button"
          className="cp-btn"
          data-testid="strava-autofill-sync"
          onClick={onSyncNow}
          style={{ minHeight: 40 }}
        >
          Sync now
        </button>
      )}
    </section>
  );
}

function formatMatch(match: StravaAutofillMatch): string {
  const minutes = Math.round(match.durationSec / 60);
  const distance =
    match.distanceKm != null ? `${match.distanceKm.toFixed(1)} km` : null;
  const hr = match.avgHrBpm != null ? `${match.avgHrBpm} bpm avg HR` : null;
  return [`${minutes} min`, distance, hr].filter(Boolean).join(" · ");
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
