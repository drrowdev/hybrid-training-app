"use client";

/**
 * CompletedSummaryCard — the "how did it go" view shown in the plan/Today drawer
 * for a COMPLETED session, in place of the prescription instructions. Compact
 * performance stats fetched on demand.
 *
 * It used to also render a full-width "View full session →" link. That link is
 * gone: the drawer's ✎ Edit button now navigates to exactly the same place
 * (`SessionDrawer` → `completedSessionHref`), and two buttons to one URL inside
 * one short drawer is a worse affordance than one button in the action row where
 * every other session action already lives.
 */

import { useEffect, useState } from "react";
import {
  getCompletedSessionSummary,
  type CompletedSessionSummary,
} from "@/lib/sessions/completed-summary-action";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div
      style={{
        background: "var(--cp-surface-soft)",
        borderRadius: 10,
        padding: "8px 10px",
        display: "grid",
        gap: 2,
        minWidth: 0,
      }}
    >
      <span
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      <span style={{ fontSize: 15, color: "var(--cp-text)", fontWeight: 600 }}>{value}</span>
    </div>
  );
}

export function CompletedSummaryCard({ sessionId }: { sessionId: string }) {
  const [summary, setSummary] = useState<CompletedSessionSummary | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    getCompletedSessionSummary(sessionId)
      .then((s) => {
        if (!cancelled) setSummary(s);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const stats: { label: string; value: string }[] = [];
  if (summary) {
    if (summary.distanceKm != null) stats.push({ label: "Distance", value: `${summary.distanceKm.toFixed(2)} km` });
    if (summary.durationMin != null) stats.push({ label: "Duration", value: `${summary.durationMin} min` });
    if (summary.avgHrBpm != null) stats.push({ label: "Avg HR", value: `${summary.avgHrBpm} bpm` });
    if (summary.maxHrBpm != null) stats.push({ label: "Max HR", value: `${summary.maxHrBpm} bpm` });
    if (summary.rpe != null) stats.push({ label: "RPE", value: String(summary.rpe) });
  }

  return (
    <section data-testid="plan-drawer-completed-summary" style={{ display: "grid", gap: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontSize: 11,
            fontWeight: 700,
            color: "var(--cp-success)",
            textTransform: "uppercase",
            letterSpacing: "0.07em",
          }}
        >
          ✓ Completed
        </span>
        {summary?.modalityLabel && (
          <span
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              border: "1px solid var(--cp-border)",
              borderRadius: 999,
              padding: "1px 8px",
            }}
          >
            {summary.modalityLabel}
          </span>
        )}
      </div>

      {loading && <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Loading…</div>}

      {!loading && stats.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))",
            gap: 8,
          }}
        >
          {stats.map((s) => (
            <Stat key={s.label} label={s.label} value={s.value} />
          ))}
        </div>
      )}

      {!loading && stats.length === 0 && (
        <div style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          Logged. Tap ✎ Edit session above for the details.
        </div>
      )}
    </section>
  );
}
