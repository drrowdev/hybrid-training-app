"use client";

/**
 * LinkActivityControl — "Link a logged activity" affordance on a planned cardio
 * session drawer. Lets the user attach an already-logged cardio session of
 * their own to this planned slot, with full HYROX load attribution via
 * `linkActivityToPlanned`.
 *
 * Nothing to do with any third-party integration — the candidates are the
 * user's OWN completed sessions carrying a cardio log. It exists because a
 * session logged before the day was swapped, or one on an internal-cardio plan,
 * has no automatic route back to its planned slot.
 *
 * Rendered only where logging is allowed (Today), never on Plan, which is a
 * review/edit surface — see the `allowLogging` gate in `PlanRedesign`.
 *
 * Candidates are fetched on demand (no upfront prop threading) and the chosen
 * link refreshes the route so the Today hero / week rail update immediately.
 */

import { useState } from "react";
import {
  getLinkableActivities,
  linkActivityToPlanned,
  type LinkableActivity,
} from "@/lib/sessions/link-activity";

function summarise(a: LinkableActivity): string {
  const parts: string[] = [];
  if (a.durationMin != null) parts.push(`${a.durationMin} min`);
  if (a.distanceKm != null) parts.push(`${a.distanceKm.toFixed(1)} km`);
  if (a.avgHrBpm != null) parts.push(`avg ${a.avgHrBpm} bpm`);
  const day = a.performedAt ? new Date(a.performedAt).toLocaleDateString() : "";
  return [day, parts.join(" · ")].filter(Boolean).join(" — ");
}

export function LinkActivityControl({
  plannedId,
  onLinked,
}: {
  plannedId: string;
  /**
   * Called after a successful link. The drawer passes its own `router.refresh`
   * so the refresh fires from a component that STAYS mounted — this control
   * unmounts the instant the session flips to done (it's gated on `!done`),
   * which would otherwise drop the refresh transition (same unmount-race the
   * swap-day fix addressed).
   */
  onLinked?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [items, setItems] = useState<LinkableActivity[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);

  const toggle = async () => {
    if (open) {
      setOpen(false);
      return;
    }
    setOpen(true);
    setError(null);
    if (items == null) {
      setLoading(true);
      try {
        setItems(await getLinkableActivities());
      } catch {
        setError("Couldn't load your recent activities.");
      } finally {
        setLoading(false);
      }
    }
  };

  const link = async (sessionId: string) => {
    setPending(sessionId);
    setError(null);
    const fd = new FormData();
    fd.set("plannedId", plannedId);
    fd.set("sessionId", sessionId);
    const res = await linkActivityToPlanned(fd);
    setPending(null);
    if (res?.error) {
      setError(res.error);
      return;
    }
    setOpen(false);
    onLinked?.();
  };

  return (
    <div data-testid="link-activity-control" style={{ display: "grid", gap: 8 }}>
      <button
        type="button"
        onClick={toggle}
        className="cp-btn ghost"
        data-testid="link-activity-toggle"
        aria-expanded={open}
        style={{ width: "100%", minHeight: 44 }}
      >
        {open ? "× Cancel" : "🔗 Link a logged activity"}
      </button>

      {open && (
        <div
          style={{
            display: "grid",
            gap: 6,
            padding: 8,
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
            background: "var(--cp-surface)",
          }}
        >
          {loading && (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Loading…</div>
          )}
          {error && (
            <div role="alert" style={{ fontSize: 12, color: "var(--cp-danger)" }}>
              {error}
            </div>
          )}
          {!loading && items != null && items.length === 0 && (
            <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
              No unlinked activities in the last 3 weeks. Log a run to link it here.
            </div>
          )}
          {!loading &&
            (items ?? []).map((a) => (
              <button
                type="button"
                key={a.sessionId}
                onClick={() => link(a.sessionId)}
                disabled={pending != null}
                data-testid={`link-activity-candidate-${a.sessionId}`}
                style={{
                  textAlign: "left",
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: "1px solid var(--cp-border)",
                  background: "var(--cp-surface-soft)",
                  color: "var(--cp-text)",
                  cursor: pending != null ? "not-allowed" : "pointer",
                  opacity: pending != null && pending !== a.sessionId ? 0.6 : 1,
                  display: "grid",
                  gap: 2,
                  minHeight: 44,
                }}
              >
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.title}</span>
                <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
                  {pending === a.sessionId ? "Linking…" : summarise(a)}
                </span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
