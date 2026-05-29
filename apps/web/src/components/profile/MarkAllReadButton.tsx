"use client";

/**
 * MarkAllReadButton — client wrapper around `markAuditReadAction` so
 * the surrounding `ProfileNotifications` can stay a server component.
 */

import { useState, useTransition } from "react";

export function MarkAllReadButton({
  action,
}: {
  action: () => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      data-testid="profile-notifications-mark-read"
      disabled={pending || done}
      onClick={() =>
        startTransition(async () => {
          const res = await action();
          if (res?.ok) setDone(true);
        })
      }
      style={{
        background: "transparent",
        border: "none",
        padding: 0,
        fontSize: 12,
        color: "var(--cp-accent)",
        cursor: pending ? "wait" : "pointer",
      }}
    >
      {done ? "Marked" : pending ? "…" : "Mark all read"}
    </button>
  );
}
