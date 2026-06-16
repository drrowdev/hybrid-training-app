"use client";

/**
 * Post-session summary card (Phase 1 C1 / C2).
 *
 * Rendered at the top of a *completed* session detail page. The numbers
 * (tonnage, duration, PR count) are computed on-the-fly server-side in
 * `summariseSessionSets` and passed in as props — there's no new
 * schema column.
 *
 * "Done" sends the user back to /app; "Add a note" expands an inline
 * textarea that submits via the `updateSessionNotes` server action.
 */

import Link from "next/link";
import { useState } from "react";
import { useFormStatus } from "react-dom";
import type { SessionSummary } from "@/lib/sessions/queries";
import { updateSessionNotes } from "@/lib/sessions/actions";
import type { ProgressionKind } from "@/lib/progression/suggest-next";
import type { DiagnosticResult } from "@/lib/planner/bw-diagnostics";
import { useUnits } from "@/lib/units/context";
import { displayWeight, weightUnitLabel, type WeightUnit } from "@/lib/stats/units";
import {
  formatDistance,
  formatSecPerKmToPace,
  paceUnitLabel,
} from "@/lib/cardio/units";
import {
  cardioKindLabel,
  modalitySupportsPace,
  type CardioSessionSummary,
} from "@/lib/sessions/cardio-summary";
import type { Zone } from "@/lib/stats/hr-zones";

/**
 * Phase 2 D2 — "Next time" suggestion shown for each main lift in the
 * completed session. Computed server-side from the top set + TM; the
 * card is informational, not commanding (no auto-apply).
 */
export type ProgressionHint = {
  movementId: string;
  movementDisplayName: string;
  kind: ProgressionKind;
  nextWeightKg: number;
  nextReps: number;
  rationale: string;
};

export function PostSessionSummary({
  sessionId,
  summary,
  programmedSets,
  sessionRpe,
  initialNotes,
  progressionHints,
  bwDiagnostics,
  cardio,
}: {
  sessionId: string;
  summary: SessionSummary;
  /**
   * Total programmed WORKING sets for this session (warm-ups excluded), so the
   * card can show "X of Y sets logged" — making it obvious whether every
   * prescribed set was completed. Omitted / 0 for off-plan sessions with no
   * prescription, where only the logged count is shown.
   */
  programmedSets?: number;
  /**
   * Session RPE (the "how hard overall, 1-10" rating captured at
   * finish). Surfaced here as a friendly "Effort" stat so the
   * post-mortem owns it — the in-progress banner no longer renders a
   * separate completed-state line. Null when the user didn't rate it.
   */
  sessionRpe?: number | string | null;
  initialNotes: string | null;
  /** Up to 3 suggested-progression hints for the main lifts (Phase 2 D2). */
  progressionHints?: ProgressionHint[];
  /**
   * Phase 6 — diagnostic signals relevant to this session's movement
   * families (already filtered server-side, capped at 2). Rendered
   * under the per-set summary as soft-yellow info cards that deep-link
   * to the settings page for full context.
   */
  bwDiagnostics?: DiagnosticResult[];
  /**
   * Aggregated cardio metrics for sessions that logged cardio blocks
   * (e.g. a Strava run). When present, the card shows cardio-relevant
   * stats — distance, HR, pace, time-in-zone — instead of (pure cardio)
   * or alongside (hybrid) the strength tiles. Null/omitted for
   * strength-only sessions, which render byte-identically to before.
   */
  cardio?: CardioSessionSummary | null;
}) {
  const units = useUnits();
  const [showNote, setShowNote] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(initialNotes);
  const [error, setError] = useState<string | null>(null);

  // Normalise sRPE to a trimmed numeric string ("7.5", "8"). The column
  // is numeric but can arrive as a string from the row; drop trailing
  // ".0" so "8.0" reads as "8".
  const effortValue = (() => {
    if (sessionRpe == null) return null;
    const n = Number(sessionRpe);
    if (!Number.isFinite(n) || n <= 0) return null;
    return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
  })();

  const submitNote = async (fd: FormData) => {
    setError(null);
    fd.set("sessionId", sessionId);
    const result = await updateSessionNotes(fd);
    if (result?.error) {
      setError(result.error);
      return;
    }
    setSavedNote(String(fd.get("notes") ?? "").trim() || null);
    setShowNote(false);
  };

  // A session counts as having strength content when it logged working
  // sets, accrued tonnage, or prescribed strength sets. Pure-cardio
  // sessions (a Strava run) have none of these, so we suppress the
  // strength tiles entirely; hybrid sessions show both blocks.
  const hasStrength =
    summary.workingSetCount > 0 ||
    summary.totalTonnageKg > 0 ||
    (programmedSets ?? 0) > 0;
  const showStrengthTiles = hasStrength || !cardio;
  const cardioOnly = !!cardio && !showStrengthTiles;

  return (
    <section
      data-testid="post-session-summary"
      className="cp-card"
      style={{
        padding: 24,
        display: "grid",
        gap: 16,
        borderColor: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 6%, transparent)",
      }}
    >
      <div>
        <div
          style={{
            fontSize: 11,
            color: "var(--cp-accent)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 700,
          }}
        >
          {cardioOnly ? "Workout complete" : "Session complete"}
        </div>
        <h2 style={{ fontSize: 24, margin: "4px 0 0", letterSpacing: "-0.01em" }}>
          {cardioOnly ? "Workout complete!" : "Session complete!"}
        </h2>
      </div>

      {showStrengthTiles && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
            gap: 10,
          }}
        >
          <SummaryStat
            label="Tonnage"
            value={summary.totalTonnageKg > 0 ? `${formatKg(displayWeight(summary.totalTonnageKg, units))} ${weightUnitLabel(units)}` : "—"}
            testId="summary-tonnage"
          />
          <SummaryStat
            label="Duration"
            value={summary.durationMin != null ? `${summary.durationMin} min` : "—"}
            testId="summary-duration"
          />
          <SummaryStat
            label="Sets"
            value={
              programmedSets && programmedSets > 0
                ? `${summary.workingSetCount} / ${programmedSets}`
                : `${summary.workingSetCount}`
            }
            testId="summary-sets"
          />
          <SummaryStat
            label="PRs"
            value={`${summary.prCount}`}
            highlight={summary.prCount > 0}
            testId="summary-prs"
          />
          {effortValue != null && (
            <SummaryStat
              label="Effort"
              value={`${effortValue} / 10`}
              testId="summary-effort"
            />
          )}
        </div>
      )}

      {cardio && (
        <CardioStats
          cardio={cardio}
          units={units}
          withHeader={!cardioOnly}
          showSessionLevel={cardioOnly}
          effortValue={effortValue}
        />
      )}

      {progressionHints && progressionHints.length > 0 && (
        <div
          data-testid="progression-hints"
          style={{
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "grid",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Next time
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {progressionHints.slice(0, 3).map((h) => (
              <li
                key={h.movementId}
                data-testid={`progression-hint-${h.movementId}`}
                style={{ display: "flex", gap: 10, alignItems: "baseline", fontSize: 13 }}
              >
                <span
                  aria-hidden
                  title={progressionKindLabel(h.kind)}
                  style={{ fontSize: 14, lineHeight: 1, minWidth: 18, textAlign: "center" }}
                >
                  {progressionKindGlyph(h.kind)}
                </span>
                <span style={{ fontWeight: 600, color: "var(--cp-text)" }}>
                  {h.movementDisplayName}:
                </span>
                <span style={{ color: "var(--cp-text-muted)" }}>{h.rationale}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {bwDiagnostics && bwDiagnostics.length > 0 && (
        <div
          data-testid="bw-session-diagnostics"
          style={{
            background: "color-mix(in oklab, var(--cp-warning) 8%, transparent)",
            border: "1px solid var(--cp-warning)",
            borderRadius: 12,
            padding: "12px 14px",
            display: "grid",
            gap: 8,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--cp-warning)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 700,
            }}
          >
            Heads up
          </div>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 6 }}>
            {bwDiagnostics.slice(0, 2).map((d, i) => (
              <li
                key={`${d.signal.kind}-${i}`}
                data-testid={`bw-session-diagnostic-${d.signal.kind}`}
                style={{ fontSize: 13, color: "var(--cp-text)", lineHeight: 1.5 }}
              >
                {d.intervention.copy}
              </li>
            ))}
          </ul>
          <Link
            href="/app/settings/bodyweight-progression"
            data-testid="bw-session-diagnostics-link"
            style={{
              fontSize: 11,
              color: "var(--cp-warning)",
              fontWeight: 600,
              textDecoration: "none",
              alignSelf: "start",
            }}
          >
            View all diagnostics →
          </Link>
        </div>
      )}

      {savedNote && !showNote && (
        <div
          style={{
            background: "var(--cp-surface)",
            border: "1px solid var(--cp-border)",
            borderRadius: 10,
            padding: 12,
          }}
        >
          <div
            style={{
              fontSize: 10,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
              marginBottom: 4,
            }}
          >
            Note
          </div>
          <p style={{ margin: 0, fontSize: 14, color: "var(--cp-text)", whiteSpace: "pre-wrap" }}>
            {savedNote}
          </p>
        </div>
      )}

      {showNote && (
        <form action={submitNote} style={{ display: "grid", gap: 8 }}>
          <label
            htmlFor="post-session-note"
            style={{
              fontSize: 11,
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              fontWeight: 600,
            }}
          >
            Anything to remember?
          </label>
          <textarea
            id="post-session-note"
            name="notes"
            rows={3}
            maxLength={2000}
            defaultValue={savedNote ?? ""}
            placeholder="What worked, what hurt, anything to chase next time."
            style={{
              padding: 12,
              borderRadius: 10,
              border: "1px solid var(--cp-border)",
              background: "var(--cp-surface)",
              color: "var(--cp-text)",
              fontSize: 14,
              fontFamily: "inherit",
              resize: "vertical",
            }}
          />
          {error && (
            <div style={{ fontSize: 12, color: "var(--cp-danger)" }} role="alert">
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <SaveNoteButton />
            <button
              type="button"
              className="cp-btn ghost"
              onClick={() => {
                setShowNote(false);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {!showNote && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
          <button
            type="button"
            className="cp-btn"
            onClick={() => setShowNote(true)}
            data-testid="summary-add-note"
            style={{ minHeight: 48 }}
          >
            {savedNote ? "Edit note" : "Add a note"}
          </button>
        </div>
      )}
    </section>
  );
}

function SaveNoteButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" className="cp-btn primary" disabled={pending} style={{ minHeight: 48 }}>
      {pending ? "Saving…" : "Save note"}
    </button>
  );
}

function fmtZoneMin(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtCardioDuration(sec: number): string {
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h}h ${String(m % 60).padStart(2, "0")}m`;
}

const ZONE_META: Record<Zone, { label: string; desc: string; color: string }> = {
  Z1: { label: "Z1", desc: "recovery", color: "var(--cp-zone-z1, #6bbf6b)" },
  Z2: { label: "Z2", desc: "easy aerobic", color: "var(--cp-zone-z2, #4ea8de)" },
  Z3: { label: "Z3", desc: "tempo", color: "var(--cp-zone-z3, #f7c948)" },
  Z4: { label: "Z4", desc: "threshold", color: "var(--cp-zone-z4, #f49f3b)" },
  Z5: { label: "Z5", desc: "VO2max", color: "var(--cp-zone-z5, #e35454)" },
};

const ZONES: Zone[] = ["Z1", "Z2", "Z3", "Z4", "Z5"];

/**
 * Cardio block of the post-session card. Renders the activity-relevant
 * stat tiles (distance, HR, pace) plus a time-in-HR-zone bar when zone
 * data exists. `showSessionLevel` adds Duration + Effort tiles for
 * pure-cardio sessions (where there's no strength grid to carry them);
 * hybrid sessions keep those in the strength grid. `withHeader` labels
 * the block "Cardio" to separate it from the strength tiles above.
 */
function CardioStats({
  cardio,
  units,
  withHeader,
  showSessionLevel,
  effortValue,
}: {
  cardio: CardioSessionSummary;
  units: WeightUnit;
  withHeader: boolean;
  showSessionLevel: boolean;
  effortValue: string | null;
}) {
  const kindLabel = cardioKindLabel(cardio.inferredKind);
  const showPace =
    cardio.paceSecPerKm != null && modalitySupportsPace(cardio.modality);

  return (
    <div data-testid="cardio-summary" style={{ display: "grid", gap: 10 }}>
      {withHeader && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 10,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            fontWeight: 600,
          }}
        >
          Cardio
          {kindLabel && <CardioKindChip label={kindLabel} />}
        </div>
      )}
      {!withHeader && kindLabel && (
        <div>
          <CardioKindChip label={kindLabel} />
        </div>
      )}

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
          gap: 10,
        }}
      >
        {cardio.distanceKm != null && (
          <SummaryStat
            label="Distance"
            value={formatDistance(cardio.distanceKm, units)}
            testId="cardio-distance"
          />
        )}
        {showSessionLevel && (
          <SummaryStat
            label="Duration"
            value={fmtCardioDuration(cardio.durationSec)}
            testId="cardio-duration"
          />
        )}
        {cardio.avgHrBpm != null && (
          <SummaryStat
            label="Avg HR"
            value={`${cardio.avgHrBpm} bpm`}
            testId="cardio-avg-hr"
          />
        )}
        {cardio.maxHrBpm != null && (
          <SummaryStat
            label="Max HR"
            value={`${cardio.maxHrBpm} bpm`}
            testId="cardio-max-hr"
          />
        )}
        {showPace && (
          <SummaryStat
            label="Pace"
            value={`${formatSecPerKmToPace(cardio.paceSecPerKm, units)} ${paceUnitLabel(units)}`}
            testId="cardio-pace"
          />
        )}
        {showSessionLevel && effortValue != null && (
          <SummaryStat
            label="Effort"
            value={`${effortValue} / 10`}
            testId="cardio-effort"
          />
        )}
      </div>

      {cardio.zones && <CardioZoneBar zones={cardio.zones} />}
    </div>
  );
}

function CardioKindChip({ label }: { label: string }) {
  return (
    <span
      data-testid="cardio-kind-chip"
      style={{
        fontSize: 10,
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color: "var(--cp-accent)",
        background: "color-mix(in oklab, var(--cp-accent) 12%, transparent)",
        border: "1px solid color-mix(in oklab, var(--cp-accent) 40%, transparent)",
        borderRadius: 999,
        padding: "2px 8px",
      }}
    >
      {label}
    </span>
  );
}

/** Single-session time-in-HR-zone stacked bar with a minutes legend. */
function CardioZoneBar({ zones }: { zones: Record<Zone, number> }) {
  const total = ZONES.reduce((acc, z) => acc + zones[z], 0);
  if (total <= 0) return null;
  const pct = (z: Zone) => zones[z] / total;

  return (
    <div data-testid="cardio-zone-bar" style={{ display: "grid", gap: 8 }}>
      <div
        style={{
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          fontWeight: 600,
        }}
      >
        Time in HR zones
      </div>
      <div
        role="img"
        aria-label="Time-in-zone stacked bar from Z1 (recovery) to Z5 (VO2max)"
        style={{
          display: "flex",
          height: 16,
          borderRadius: 4,
          overflow: "hidden",
          background: "var(--cp-surface)",
          border: "1px solid var(--cp-border)",
        }}
      >
        {ZONES.map((z) =>
          zones[z] > 0 ? (
            <div
              key={z}
              data-testid={`cardio-zone-segment-${z}`}
              title={`${ZONE_META[z].label} · ${ZONE_META[z].desc} · ${fmtZoneMin(zones[z])}`}
              style={{ flexGrow: zones[z], flexBasis: 0, background: ZONE_META[z].color }}
            />
          ) : null,
        )}
      </div>
      <div
        style={{
          display: "flex",
          marginTop: -2,
        }}
      >
        {(() => {
          const visible = ZONES.filter((z) => zones[z] > 0);
          return visible.map((z, i) => {
            const justify =
              i === 0 ? "flex-start" : i === visible.length - 1 ? "flex-end" : "center";
            return (
              <div
                key={z}
                data-testid={`cardio-zone-legend-${z}`}
                style={{
                  flexGrow: zones[z],
                  flexBasis: 0,
                  minWidth: 0,
                  display: "flex",
                  justifyContent: justify,
                }}
              >
                <span
                  style={{
                    whiteSpace: "nowrap",
                    fontSize: 12,
                    display: "inline-flex",
                    gap: 5,
                    alignItems: "baseline",
                  }}
                >
                  <span style={{ color: "var(--cp-text)", fontWeight: 600 }}>
                    {ZONE_META[z].label}
                  </span>
                  <span style={{ color: "var(--cp-text-muted)" }} className="mono">
                    {fmtZoneMin(zones[z])}
                  </span>
                </span>
              </div>
            );
          });
        })()}
      </div>
    </div>
  );
}

function SummaryStat({
  label,
  value,
  highlight,
  testId,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  testId?: string;
}) {
  return (
    <div
      data-testid={testId}
      style={{
        background: "var(--cp-surface)",
        border: `1px solid ${highlight ? "var(--cp-accent)" : "var(--cp-border)"}`,
        borderRadius: 12,
        padding: "12px 14px",
      }}
    >
      <div
        style={{
          fontFamily: "var(--cp-font-mono)",
          fontSize: 10,
          color: "var(--cp-text-muted)",
          textTransform: "uppercase",
          letterSpacing: "0.1em",
          fontWeight: 500,
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--cp-font-display)",
          fontSize: 24,
          fontWeight: 600,
          letterSpacing: "0.01em",
          marginTop: 2,
          color: highlight ? "var(--cp-accent)" : "var(--cp-text)",
        }}
      >
        {value}
      </div>
    </div>
  );
}

function formatKg(n: number): string {
  if (n >= 10_000) return `${Math.round(n / 100) / 10}k`;
  if (Math.abs(n - Math.round(n)) < 0.05) return String(Math.round(n));
  return n.toFixed(1);
}

function progressionKindGlyph(kind: ProgressionKind): string {
  switch (kind) {
    case "increase":
      return "↑";
    case "hold":
      return "→";
    case "retry":
      return "↻";
    case "reset":
      return "↓";
  }
}

function progressionKindLabel(kind: ProgressionKind): string {
  switch (kind) {
    case "increase":
      return "Add load next time";
    case "hold":
      return "Hold weight, chase a rep";
    case "retry":
      return "Same weight — try again";
    case "reset":
      return "Reset and rebuild";
  }
}
