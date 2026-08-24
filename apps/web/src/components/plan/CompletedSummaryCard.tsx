"use client";

/**
 * CompletedSummaryCard — the "how did it go" view shown in the plan/Today drawer
 * for a COMPLETED session, in place of the prescription.
 *
 * Shows the session's headline stats and then what was actually lifted, set by
 * set. Warm-ups are counted, not itemised. The full per-set view is behind the
 * drawer's ✎ button, which navigates to the session page.
 */

import { useEffect, useState } from "react";
import {
  getCompletedSessionSummary,
  type CompletedSessionSummary,
} from "@/lib/sessions/completed-summary-action";
import type { RecapEntry, RecapMovement, RecapSetKind } from "@/lib/sessions/session-recap";
import { skipReasonLabel } from "@/lib/sessions/skip-reasons";
import { formatWeight, type WeightUnit } from "@/lib/stats/units";
import { formatDistance } from "@/lib/cardio/units";

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

const KIND_LABEL: Record<RecapSetKind, string> = {
  main: "Working",
  back_off: "Volume",
  accessory: "Accessory",
  tendon: "Tendon",
  warmup: "Warm-up",
};

/** `3×5 · 100 kg`, `2×30 s`, `2×30 m · 24 kg`, `3×10` for an unloaded set. */
function formatEntry(entry: RecapEntry, units: WeightUnit): string {
  const work =
    entry.measure.type === "reps"
      ? `${entry.measure.reps}`
      : entry.measure.type === "duration"
        ? `${entry.measure.seconds}\u00A0s`
        : `${entry.measure.metres}\u00A0m`;
  const head = `${entry.sets}\u00D7${work}`;
  return entry.weightKg == null ? head : `${head} \u00B7 ${formatWeight(entry.weightKg, units)}`;
}

function MovementRow({ movement, units }: { movement: RecapMovement; units: WeightUnit }) {
  const notes: string[] = [];
  if (movement.warmupSets > 0) {
    notes.push(`${movement.warmupSets} warm-up${movement.warmupSets === 1 ? "" : "s"}`);
  }
  if (movement.skippedSets > 0) {
    const reasons =
      movement.skipReasons.length > 0
        ? ` (${movement.skipReasons.map(skipReasonLabel).join(", ")})`
        : "";
    notes.push(`${movement.skippedSets} skipped${reasons}`);
  }

  return (
    <li
      data-testid="plan-drawer-recap-movement"
      style={{
        display: "grid",
        gap: 3,
        padding: "8px 0",
        borderTop: "1px solid var(--cp-border)",
      }}
    >
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--cp-text)" }}>
        {movement.name}
      </span>
      {movement.groups.map((group) => (
        <span
          key={group.kind}
          style={{
            fontSize: 12.5,
            color: "var(--cp-text-muted)",
            display: "flex",
            gap: 6,
            flexWrap: "wrap",
          }}
        >
          <span style={{ minWidth: 62 }}>{KIND_LABEL[group.kind]}</span>
          <span style={{ color: "var(--cp-text)" }}>
            {group.entries.map((e) => formatEntry(e, units)).join(" \u00B7 ")}
          </span>
        </span>
      ))}
      {notes.length > 0 && (
        <span style={{ fontSize: 11.5, color: "var(--cp-text-muted)" }}>
          {notes.join(" \u00B7 ")}
        </span>
      )}
    </li>
  );
}

export function CompletedSummaryCard({ sessionId }: { sessionId: string }) {
  // Keyed by the session it belongs to. The drawer reuses this component across
  // sessions, so a result is only ever shown against the id it was fetched for
  // — anything else is still loading.
  const [loaded, setLoaded] = useState<{
    id: string;
    summary: CompletedSessionSummary | null;
  } | null>(null);

  useEffect(() => {
    let cancelled = false;
    getCompletedSessionSummary(sessionId)
      .then((summary) => {
        if (!cancelled) setLoaded({ id: sessionId, summary });
      })
      .catch(() => {
        if (!cancelled) setLoaded({ id: sessionId, summary: null });
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const current = loaded?.id === sessionId ? loaded : null;
  const state: CompletedSummaryState = !current
    ? "loading"
    : current.summary
      ? "ready"
      : "unavailable";

  return <CompletedSummaryBody state={state} summary={current?.summary ?? null} />;
}

export type CompletedSummaryState = "loading" | "ready" | "unavailable";

/**
 * The rendered card, separated from the fetch so it can be exercised in every
 * state without a DOM.
 */
export function CompletedSummaryBody({
  state,
  summary,
}: {
  state: CompletedSummaryState;
  summary: CompletedSessionSummary | null;
}) {
  const stats: { label: string; value: string }[] = [];
  if (summary) {
    if (summary.distanceKm != null) stats.push({ label: "Distance", value: formatDistance(summary.distanceKm, summary.units) });
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

      {state === "loading" && (
        <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>Loading…</div>
      )}

      {state === "unavailable" && (
        <div role="alert" style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>
          Couldn&apos;t load this session.
        </div>
      )}

      {state === "ready" && stats.length > 0 && (
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

      {state === "ready" && summary && summary.lifts.length > 0 && (
        <div style={{ display: "grid", gap: 2 }} data-testid="plan-drawer-recap">
          <span
            style={{
              fontSize: 10,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
            }}
          >
            Lifts
          </span>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {summary.lifts.map((movement) => (
              <MovementRow key={movement.movementId} movement={movement} units={summary.units} />
            ))}
          </ul>
        </div>
      )}

      {state === "ready" && summary && summary.lifts.length === 0 && stats.length === 0 && (
        <div
          data-testid="plan-drawer-recap-empty"
          style={{ fontSize: 13, color: "var(--cp-text-muted)" }}
        >
          No sets logged.
        </div>
      )}
    </section>
  );
}
