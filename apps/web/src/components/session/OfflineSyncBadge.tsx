"use client";

/**
 * OfflineSyncBadge — where a logged set currently lives.
 *
 * Logging never blocks on the network (see SessionWorkArea.logSet): a set is
 * written to a durable IndexedDB outbox first and replayed when connectivity
 * returns. That makes the honest question not "did it save?" but "where is it
 * saved?", so the badge names the actual state rather than collapsing
 * everything into "offline":
 *
 *   offline, queued        → "Saved on this device"   (nothing is lost)
 *   online, retry failed   → "Couldn't sync N"        (actionable)
 *   online, queued         → "Syncing N…"             (in flight)
 *   online, just drained   → "All sets synced"        (briefly, then quiet)
 *   online, nothing queued → render nothing           (the happy path)
 *
 * The badge is never a blocker and never implies logging is unavailable — the
 * failure mode that matters is a user in a gym basement believing their work
 * was dropped and re-logging it.
 */
import { useEffect, useRef, useState } from "react";

export type SyncState = "offline" | "failed" | "syncing" | "synced" | "idle";

export function resolveSyncState(opts: {
  online: boolean;
  pendingCount: number;
  failedCount: number;
  droppedCount?: number;
  recentlyDrained: boolean;
}): SyncState {
  const {
    online,
    pendingCount,
    failedCount,
    droppedCount = 0,
    recentlyDrained,
  } = opts;
  if (!online && pendingCount > 0) return "offline";
  if (online && (failedCount > 0 || droppedCount > 0)) return "failed";
  if (online && pendingCount > 0) return "syncing";
  if (online && pendingCount === 0 && recentlyDrained) return "synced";
  // Offline with an empty queue is not worth a badge: nothing is at risk.
  return "idle";
}

export function syncLabel(
  state: SyncState,
  pendingCount: number,
  droppedCount = 0,
): string {
  switch (state) {
    case "offline":
      return `Saved on this device — ${pendingCount} waiting to sync`;
    case "failed":
      return droppedCount > 0
        ? `Couldn't save ${droppedCount} queued ${droppedCount === 1 ? "entry" : "entries"}`
        : `Couldn't sync ${pendingCount} — still saved on this device`;
    case "syncing":
      return `Syncing ${pendingCount}…`;
    case "synced":
      return "All sets synced";
    default:
      return "";
  }
}

export function OfflineSyncBadge({
  pendingCount,
  failedCount = 0,
  droppedCount = 0,
}: {
  pendingCount: number;
  /** Queued ops whose last replay attempt errored. */
  failedCount?: number;
  /** Entries discarded after an explicit deterministic validation error. */
  droppedCount?: number;
}) {
  const [online, setOnline] = useState(true);
  // "All sets synced" is only meaningful right after a drain — showing it
  // permanently would be noise on a session that was never offline.
  const [recentlyDrained, setRecentlyDrained] = useState(false);
  const hadPending = useRef(false);

  useEffect(() => {
    const sync = () =>
      setOnline(typeof navigator === "undefined" ? true : navigator.onLine);
    sync();
    window.addEventListener("online", sync);
    window.addEventListener("offline", sync);
    return () => {
      window.removeEventListener("online", sync);
      window.removeEventListener("offline", sync);
    };
  }, []);

  useEffect(() => {
    if (pendingCount > 0) {
      hadPending.current = true;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- mirror queue depth into the transient "just drained" flag
      setRecentlyDrained(false);
      return;
    }
    if (!hadPending.current) return;
    hadPending.current = false;
    setRecentlyDrained(true);
    const id = window.setTimeout(() => setRecentlyDrained(false), 4000);
    return () => window.clearTimeout(id);
  }, [pendingCount]);

  const state = resolveSyncState({
    online,
    pendingCount,
    failedCount,
    droppedCount,
    recentlyDrained,
  });
  if (state === "idle") return null;

  const accent =
    state === "failed"
      ? "var(--cp-danger)"
      : state === "offline"
        ? "var(--cp-warning)"
        : "var(--cp-accent)";

  return (
    <div
      role="status"
      data-testid="offline-sync-badge"
      data-state={state}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12.5,
        padding: "6px 12px",
        marginBottom: 10,
        borderRadius: 8,
        border: `1px solid ${accent}`,
        background: `color-mix(in oklab, ${accent} 8%, transparent)`,
        color: "var(--cp-text)",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: accent,
          flexShrink: 0,
        }}
      />
      <span>{syncLabel(state, pendingCount, droppedCount)}</span>
      {state === "offline" && (
        <span style={{ color: "var(--cp-text-muted)" }}>
          — keep logging, they&apos;ll go up when you reconnect
        </span>
      )}
    </div>
  );
}
