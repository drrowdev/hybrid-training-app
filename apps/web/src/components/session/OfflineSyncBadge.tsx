"use client";

/**
 * OfflineSyncBadge — surfaces offline-logging status during a workout.
 *
 * Three states, driven by `navigator.onLine` + the outbox pending count:
 *  - Offline with queued sets   → "Offline — N saved on this device"
 *  - Online with queued sets    → "Syncing N…"
 *  - Online, queue empty        → render nothing (the quiet happy path)
 *
 * Set logging never blocks on the network (see SessionWorkArea.logSet), so this
 * is purely informational — reassurance that nothing was lost when the signal
 * drops in a gym basement.
 */
import { useEffect, useState } from "react";

export function OfflineSyncBadge({ pendingCount }: { pendingCount: number }) {
  const [online, setOnline] = useState(true);

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

  // Quiet when there's nothing to report and we're connected.
  if (pendingCount === 0 && online) return null;

  const offline = !online;
  const label = offline
    ? `Offline — ${pendingCount} saved on this device`
    : pendingCount > 0
      ? `Syncing ${pendingCount}…`
      : "Synced";

  const accent = offline ? "var(--cp-warning)" : "var(--cp-accent)";

  return (
    <div
      role="status"
      data-testid="offline-sync-badge"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        fontSize: 12,
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
      <span>{label}</span>
      {offline && pendingCount > 0 && (
        <span style={{ color: "var(--cp-text-muted)" }}>
          — they&apos;ll sync when you&apos;re back online
        </span>
      )}
    </div>
  );
}
