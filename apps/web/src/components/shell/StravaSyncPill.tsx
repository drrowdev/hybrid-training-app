/**
 * StravaSyncPill — inline status pill (dot + label) for the Strava
 * last-sync state. Used both by the desktop TopBarRight cluster (when
 * `variant="topbar"`) and by the Today page header on mobile
 * (`variant="inline"`).
 *
 * Hidden entirely when the user has no `strava_connections` row.
 */

import type { CSSProperties } from "react";

type SyncState = "fresh" | "stale";

function computeSyncState(lastSyncedAt: string | null): SyncState {
  if (!lastSyncedAt) return "stale";
  const ts = Date.parse(lastSyncedAt);
  if (!Number.isFinite(ts)) return "stale";
  const ageMs = Date.now() - ts;
  return ageMs <= 24 * 60 * 60 * 1000 ? "fresh" : "stale";
}

function formatRelative(iso: string): string {
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return "";
  const diff = Date.now() - ts;
  const mins = Math.round(diff / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  return `${days}d ago`;
}

export function StravaSyncPill({
  hasStravaConnection,
  lastSyncedAt,
  variant = "inline",
}: {
  hasStravaConnection: boolean;
  lastSyncedAt: string | null;
  variant?: "topbar" | "inline";
}) {
  if (!hasStravaConnection) return null;

  const state = computeSyncState(lastSyncedAt);
  const label = state === "fresh" ? "Up to date" : "Stale";
  const dotColor =
    state === "fresh" ? "var(--cp-accent)" : "var(--cp-text-muted)";
  const title = lastSyncedAt
    ? `Strava — last sync ${formatRelative(lastSyncedAt)}`
    : "Strava — never synced";

  const wrap: CSSProperties =
    variant === "topbar"
      ? {
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          height: 30,
          padding: "0 10px",
          borderRadius: 8,
          border: "1px solid var(--cp-border)",
          background: "transparent",
          color: "var(--cp-text-muted)",
          fontSize: 13,
          lineHeight: 1,
        }
      : {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          height: 24,
          padding: "0 8px",
          borderRadius: 999,
          border: "1px solid var(--cp-border)",
          background: "var(--cp-surface-soft, var(--cp-surface))",
          color: "var(--cp-text-muted)",
          fontSize: 11,
          fontWeight: 500,
          lineHeight: 1,
        };

  return (
    <div
      data-testid="strava-sync-pill"
      data-state={state}
      data-variant={variant}
      title={title}
      style={wrap}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          display: "inline-block",
          background: dotColor,
        }}
      />
      <span>Strava · {label}</span>
    </div>
  );
}
