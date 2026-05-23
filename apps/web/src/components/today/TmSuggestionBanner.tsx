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

const FORMULA_LABEL: Record<TmFormula, string> = {
  epley: "Epley",
  brzycki: "Brzycki",
  rpe_zourdos: "RPE",
};

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

function fmtKg(n: number | null): string {
  if (n == null) return "—";
  return Number.isInteger(n) ? n.toString() : n.toFixed(1).replace(/\.0$/, "");
}

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
}: {
  suggestions: TmSuggestionView[];
  acceptAction: (fd: FormData) => Promise<unknown>;
  dismissAction: (fd: FormData) => Promise<unknown>;
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  if (suggestions.length === 0) return null;

  const submit = (id: string, action: (fd: FormData) => Promise<unknown>) => {
    setPendingId(id);
    const fd = new FormData();
    fd.set("suggestionId", id);
    startTransition(async () => {
      try {
        await action(fd);
      } finally {
        setPendingId(null);
      }
    });
  };

  return (
    <section
      data-testid="tm-suggestion-banner"
      aria-label="Training-max suggestions"
      style={{
        display: "grid",
        gap: 10,
        padding: 14,
        borderRadius: 12,
        border: "1px solid var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 8%, transparent)",
      }}
    >
      <div
        style={{
          fontSize: 11,
          color: "var(--cp-accent)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 700,
        }}
      >
        New TM suggested
      </div>
      {suggestions.map((s) => {
        const isBusy = pendingId === s.id;
        const setText =
          s.setWeightKg != null && s.setReps != null
            ? `${fmtKg(s.setWeightKg)} kg × ${s.setReps}`
            : "your AMRAP";
        const when = relativeFromNow(s.sessionPerformedAt);
        const formulaLabel = s.formula ? FORMULA_LABEL[s.formula] : "e1RM";
        return (
          <div
            key={s.id}
            data-testid={`tm-suggestion-${s.id}`}
            style={{
              display: "flex",
              flexWrap: "wrap",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.4 }}>
              <strong>{s.movementName}</strong>{" "}
              <span className="mono" style={{ fontWeight: 600 }}>
                {fmtKg(s.suggestedTmKg)} kg
              </span>
              {s.currentTmKg != null && (
                <span style={{ color: "var(--cp-text-muted)" }}>
                  {" "}
                  (from{" "}
                  <span className="mono">{fmtKg(s.currentTmKg)} kg</span>)
                </span>
              )}
              <span style={{ color: "var(--cp-text-muted)" }}>
                {" "}
                · from your AMRAP <span className="mono">{setText}</span> · {when}
                {" "}({formulaLabel})
              </span>
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                type="button"
                onClick={() => submit(s.id, acceptAction)}
                disabled={isBusy}
                data-testid={`tm-suggestion-accept-${s.id}`}
                className="cp-btn primary"
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                {isBusy ? "…" : "Accept"}
              </button>
              <button
                type="button"
                onClick={() => submit(s.id, dismissAction)}
                disabled={isBusy}
                data-testid={`tm-suggestion-dismiss-${s.id}`}
                className="cp-btn ghost"
                style={{ fontSize: 12, padding: "6px 12px" }}
              >
                Dismiss
              </button>
            </div>
          </div>
        );
      })}
    </section>
  );
}
