"use client";

/**
 * Strava history import — client form for the Settings page. Submits
 * to `importStravaHistoryAction` and renders the structured summary
 * inline (no redirect, so the user can immediately see what was
 * imported vs skipped vs matched).
 *
 * Async-but-not-streaming: per the v1 spec, we run the server action
 * to completion and render the summary on its response. Typical
 * 30-day import is 5–15s. The button shows a spinner during the call
 * and is disabled to prevent double-submits.
 */
import { useState, useTransition } from "react";
import type { ImportSummary } from "@/lib/integrations/strava/import-history";

type Action = (input: {
  startDate: string;
  endDate?: string;
  autoLinkToPlanned?: boolean;
}) => Promise<
  | { ok: true; summary: ImportSummary }
  | { ok: false; error: string }
>;

type Quick = "30" | "90" | "365" | "custom";

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ImportHistorySection({ action }: { action: Action }) {
  const [quick, setQuick] = useState<Quick>("90");
  const [start, setStart] = useState<string>(daysAgoIso(90));
  const [end, setEnd] = useState<string>(todayIso());
  const [autoLink, setAutoLink] = useState(true);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function selectQuick(q: Quick) {
    setQuick(q);
    if (q === "30") setStart(daysAgoIso(30));
    else if (q === "90") setStart(daysAgoIso(90));
    else if (q === "365") setStart(daysAgoIso(365));
    if (q !== "custom") setEnd(todayIso());
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSummary(null);
    startTransition(async () => {
      const result = await action({
        startDate: start,
        endDate: end,
        autoLinkToPlanned: autoLink,
      });
      if (result.ok) setSummary(result.summary);
      else setError(result.error);
    });
  }

  return (
    <section
      className="cp-card"
      style={{ padding: 20, display: "grid", gap: 12 }}
      data-testid="strava-import-history"
    >
      <header style={{ display: "grid", gap: 4 }}>
        <h2 style={{ fontSize: 16, margin: 0 }}>Import past activities</h2>
        <p style={{ fontSize: 13, color: "var(--cp-text-muted)", margin: 0 }}>
          Pull your last activities from Strava. They&apos;ll be added to
          your training history and matched to past planned sessions when
          possible.
        </p>
      </header>

      <form onSubmit={submit} style={{ display: "grid", gap: 12 }}>
        <div role="group" aria-label="Range" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {(
            [
              ["30", "30 days"],
              ["90", "90 days"],
              ["365", "365 days"],
              ["custom", "Custom range"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              className={`cp-btn ${quick === key ? "primary" : ""}`}
              onClick={() => selectQuick(key)}
              aria-pressed={quick === key}
              style={{ padding: "6px 12px", fontSize: 13 }}
            >
              {label}
            </button>
          ))}
        </div>

        {quick === "custom" && (
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--cp-text-muted)" }}>Start</span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                required
                max={end || todayIso()}
                style={{ padding: "6px 8px" }}
              />
            </label>
            <label style={{ display: "grid", gap: 4, fontSize: 12 }}>
              <span style={{ color: "var(--cp-text-muted)" }}>End</span>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                required
                min={start}
                max={todayIso()}
                style={{ padding: "6px 8px" }}
              />
            </label>
          </div>
        )}

        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
          }}
        >
          <input
            type="checkbox"
            checked={autoLink}
            onChange={(e) => setAutoLink(e.target.checked)}
          />
          Auto-link to planned sessions
        </label>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button
            type="submit"
            className="cp-btn primary"
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? "Importing…" : "Import"}
          </button>
          {pending && (
            <span
              role="status"
              style={{ fontSize: 12, color: "var(--cp-text-muted)" }}
            >
              Importing activities…
            </span>
          )}
        </div>
      </form>

      {error && (
        <div
          role="alert"
          className="cp-card"
          style={{
            padding: "10px 14px",
            background: "color-mix(in oklab, var(--cp-danger) 12%, transparent)",
            borderColor: "var(--cp-danger)",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      )}

      {summary && <ImportSummaryView summary={summary} />}
    </section>
  );
}

export function ImportSummaryView({ summary }: { summary: ImportSummary }) {
  const totalSkipped =
    summary.skipped.strength +
    summary.skipped.sport +
    summary.skipped.other +
    summary.skipped.duplicates +
    summary.skipped.unknown;
  return (
    <div
      role="status"
      data-testid="strava-import-summary"
      className="cp-card"
      style={{
        padding: "12px 16px",
        display: "grid",
        gap: 8,
        background: "color-mix(in oklab, var(--cp-success) 8%, transparent)",
        borderColor: "var(--cp-success)",
        fontSize: 13,
      }}
    >
      <div style={{ fontWeight: 600 }}>
        Imported {summary.imported}{" "}
        {summary.imported === 1 ? "activity" : "activities"}
        {summary.matchedToPlanned > 0
          ? ` · matched ${summary.matchedToPlanned} to past plans`
          : ""}
      </div>

      {totalSkipped > 0 && (
        <div>
          <div style={{ color: "var(--cp-text-muted)", marginBottom: 4 }}>
            Skipped:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 2 }}>
            {summary.skipped.strength > 0 && (
              <li>
                {summary.skipped.strength} strength sessions (logged separately
                in your training plan)
              </li>
            )}
            {summary.skipped.sport > 0 && (
              <li>{summary.skipped.sport} sports we don&apos;t auto-import</li>
            )}
            {summary.skipped.other > 0 && (
              <li>
                {summary.skipped.other} activities we don&apos;t yet map (e.g.
                Snowboard, Wheelchair)
              </li>
            )}
            {summary.skipped.duplicates > 0 && (
              <li>
                {summary.skipped.duplicates} duplicates (already imported)
              </li>
            )}
            {summary.skipped.unknown > 0 && (
              <li>
                {summary.skipped.unknown} unrecognized activity types
              </li>
            )}
          </ul>
        </div>
      )}

      {summary.errors.length > 0 && (
        <div
          style={{
            marginTop: 4,
            padding: "8px 10px",
            borderRadius: 8,
            background: "color-mix(in oklab, var(--cp-text-muted) 8%, transparent)",
            color: "var(--cp-text-muted)",
            fontSize: 12,
          }}
        >
          <div style={{ marginBottom: 4 }}>
            {summary.errors.length} {summary.errors.length === 1 ? "error" : "errors"}:
          </div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {summary.errors.slice(0, 5).map((e, i) => (
              <li key={i}>{e.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
