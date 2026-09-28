"use client";

/**
 * TmSuggestionBanner — Today-page surface for pending TM bumps.
 *
 * Renders one row per pending suggestion. Calls bound server actions to
 * accept (writes the new TM with source='derived_*') or dismiss (status
 * flipped to 'dismissed'). Optimistic disable during the in-flight action
 * keeps double-clicks from spawning duplicate writes.
 */
import { useState, useTransition } from "react";
import type { TmFormula } from "@hta/db";
import type { UpsertResult } from "@/lib/training-maxes/actions";
import styles from "./TmSuggestionBanner.module.css";
import {
  type WeightUnit,
  displayWeight,
  roundDisplayWeight,
  weightUnitLabel,
} from "@/lib/stats/units";

export type TmSuggestionView = {
  id: string;
  movementName: string;
  currentTmKg: number | null;
  suggestedTmKg: number;
  formula: TmFormula | null;
  setWeightKg: number | null;
  setReps: number | null;
  sessionPerformedAt: string | null;
};

function relativeFromNow(iso: string | null): string {
  if (!iso) return "recently";
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return "recently";
  const diffMs = Date.now() - then;
  const days = Math.round(diffMs / (1000 * 60 * 60 * 24));
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;
  if (days < 14) return "1 week ago";
  if (days < 60) return `${Math.round(days / 7)} weeks ago`;
  return `${Math.round(days / 30)} months ago`;
}

export function TmSuggestionBanner({
  suggestions,
  acceptAction,
  dismissAction,
  units = "metric",
  oneRm = false,
}: {
  suggestions: TmSuggestionView[];
  acceptAction: (fd: FormData) => Promise<UpsertResult>;
  dismissAction: (fd: FormData) => Promise<UpsertResult>;
  units?: WeightUnit;
  oneRm?: boolean;
}) {
  const fmtW = (n: number | null): string =>
    n == null ? "—" : oneRm ? String(n) : `${roundDisplayWeight(displayWeight(n, units), units)}`;
  const unitLabel = weightUnitLabel(units);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string[]>([]);
  const [, startTransition] = useTransition();

  const visible = suggestions.filter((suggestion) => !resolved.includes(suggestion.id));
  if (visible.length === 0) return null;

  const submit = (ids: string[], action: (fd: FormData) => Promise<UpsertResult>) => {
    setPendingId(ids.length === 1 ? ids[0]! : "all");
    setError(null);
    const fd = new FormData();
    for (const id of ids) fd.append("suggestionId", id);
    startTransition(async () => {
      try {
        const result = await action(fd);
        if (!result.ok) setError(result.error);
        else setResolved((previous) => [...previous, ...ids]);
      } catch {
        setError("Couldn't save this choice. Try again.");
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <section
      data-testid="tm-suggestion-banner"
      aria-label={oneRm ? "1RM suggestions" : "Training-max suggestions"}
      style={{
        display: "grid",
        gap: 10,
        padding: 14,
        borderRadius: 12,
        border: "1px solid var(--cp-border)",
        background: "var(--cp-surface)",
      }}
    >
      {oneRm && <h2 style={{ fontSize: 15, fontWeight: 600, margin: 0 }}>Increase 1RMs</h2>}
      {error && <p role="alert" style={{ margin: 0 }}>{error}</p>}
      {visible.map((s) => {
        const isBusy = pendingId === s.id;
        const setText =
          s.setWeightKg != null && s.setReps != null
            ? `${fmtW(s.setWeightKg)} ${unitLabel} × ${s.setReps}`
            : null;
        const when = relativeFromNow(s.sessionPerformedAt);
        return (
          <div
            key={s.id}
            data-testid={`tm-suggestion-${s.id}`}
            className={oneRm ? styles.progressionRow : undefined}
            style={{
              display: oneRm ? undefined : "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 14, color: "var(--cp-text)", lineHeight: 1.5 }}>
              <h2 style={{ font: "inherit", fontWeight: 600, margin: 0 }}>
                {s.movementName}{!oneRm && " training max: "}
                <span className={oneRm ? styles.values : undefined}>{s.currentTmKg != null ? `${fmtW(s.currentTmKg)} → ` : ""}{fmtW(s.suggestedTmKg)} {unitLabel}</span>
              </h2>
              {!oneRm && setText && <div style={{ color: "var(--cp-text-muted)", fontSize: 13, marginTop: 3 }}>
                From {setText} {when}
              </div>}
            </div>
            <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
              <button
                type="button"
                onClick={() => submit([s.id], acceptAction)}
                disabled={pendingId !== null}
                aria-label={`Accept ${s.movementName}`}
                data-testid={`tm-suggestion-accept-${s.id}`}
                className={oneRm ? "cp-btn" : "cp-btn primary"}
                style={{ fontSize: 12, padding: "6px 12px", minHeight: 44, minWidth: 44 }}
              >
                {isBusy ? "…" : "Accept"}
              </button>
              <button
                type="button"
                onClick={() => submit([s.id], dismissAction)}
                disabled={pendingId !== null}
                aria-label={`${oneRm ? "Decline" : "Dismiss"} ${s.movementName}`}
                data-testid={`tm-suggestion-dismiss-${s.id}`}
                className="cp-btn ghost"
                style={{ fontSize: 12, padding: "6px 12px", minHeight: 44, minWidth: 44 }}
              >
                {oneRm ? "Decline" : "Dismiss"}
              </button>
            </div>
          </div>
        );
      })}
      {oneRm && <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, paddingTop: 10, borderTop: "1px solid var(--cp-border)" }}>
        <button type="button" className="cp-btn primary" disabled={pendingId !== null}
          onClick={() => submit(visible.map((suggestion) => suggestion.id), acceptAction)}>Accept all</button>
        <button type="button" className="cp-btn ghost" disabled={pendingId !== null}
          onClick={() => submit(visible.map((suggestion) => suggestion.id), dismissAction)}>Decline all</button>
      </div>}
    </section>
  );
}
