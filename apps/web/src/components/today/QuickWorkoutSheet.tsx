"use client";

/**
 * Quick-workout bottom sheet — fired from `<QuickWorkoutCard>` on the
 * Today page. Quick workouts are STRENGTH-ONLY: the sheet offers a
 * single "Strength" start plus, when available, a "Recent" list of
 * completed strength workouts the user can clone with one tap.
 *
 * Cardio is intentionally NOT a quick-workout option. In-app cardio
 * capture (GPS live tracking) was removed — cardio is logged in Strava
 * and flows in via the Strava integration, or is entered manually on a
 * planned cardio session. Steering ad-hoc cardio out of the quick-workout
 * picker keeps that mental model clean.
 *
 * Both the Strength start and every Recent row call a server action
 * exposed via props rather than imported directly — keeps the component
 * pure for tests and lets the page wire the actions once.
 *
 * Wraps the shared `<BottomSheet>` for the backdrop + swipe-down UX.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { QuickRepeatCandidate } from "@/lib/sessions/queries";

export type StartStrengthFn = () => Promise<string>;
export type RepeatFn = (input: { sessionId: string }) => Promise<string>;
export type GenerateStrengthFn = (input: {
  length: "short" | "normal";
}) => Promise<string>;
export type HyroxStation =
  | "run"
  | "ski_erg"
  | "rower"
  | "sled"
  | "sandbag"
  | "wall_ball"
  | "farmers"
  | "burpees";
export type GenerateHyroxFn = (input: {
  length: "short" | "normal";
  stations: HyroxStation[];
}) => Promise<string>;

const HYROX_STATION_LABELS: { id: HyroxStation; label: string }[] = [
  { id: "run", label: "Run" },
  { id: "ski_erg", label: "Ski Erg" },
  { id: "rower", label: "Rower" },
  { id: "sled", label: "Sled" },
  { id: "sandbag", label: "Sandbag" },
  { id: "wall_ball", label: "Wall Ball" },
  { id: "farmers", label: "Farmers" },
  { id: "burpees", label: "Burpees" },
];

export function QuickWorkoutSheet({
  open,
  onClose,
  recent,
  startStrength,
  repeatRecent,
  generateStrength,
  generateHyrox,
  hyroxStationDefaults,
}: {
  open: boolean;
  onClose: () => void;
  recent: QuickRepeatCandidate[];
  startStrength: StartStrengthFn;
  repeatRecent: RepeatFn;
  generateStrength: GenerateStrengthFn;
  generateHyrox: GenerateHyroxFn;
  hyroxStationDefaults: HyroxStation[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [modality, setModality] = useState<"strength" | "hyrox">("strength");
  const [stations, setStations] = useState<Set<HyroxStation>>(
    () => new Set(hyroxStationDefaults),
  );
  const toggleStation = (id: HyroxStation) =>
    setStations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  // circuit needs ≥2 stations; erg/run need their option; so allow generate when
  // ≥2 selected OR (run/erg present). Keep it simple: ≥1 station of any kind.
  const stationCount = [...stations].filter((s) => s !== "run").length;
  const canGenerateHyrox =
    stations.has("ski_erg") ||
    stations.has("rower") ||
    stations.has("run") ||
    stationCount >= 2;

  const fire = (id: string, fn: () => Promise<string>) => {
    if (pending) return;
    setPendingId(id);
    startTransition(async () => {
      try {
        const sessionId = await fn();
        // Navigate client-side so the destination's loading.tsx skeleton
        // shows instantly — a server-action redirect() would instead block
        // this transition until the full session RSC was ready ("Starting…"
        // hang). The create itself is a single insert round-trip.
        if (sessionId) router.push(`/app/sessions/${sessionId}`);
      } catch (err) {
        // A server action that still redirects throws `NEXT_REDIRECT`; that's
        // expected and not an error path the user needs to see.
        const msg = err instanceof Error ? err.message : String(err);
        if (!/NEXT_REDIRECT/i.test(msg)) {
          console.error("[quick-workout] action failed", err);
          setPendingId(null);
        }
      }
    });
  };

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      testId="quick-workout-sheet"
      ariaLabelledById="quick-workout-sheet-title"
      title={
        <div>
          <h2
            id="quick-workout-sheet-title"
            style={{ margin: 0, fontSize: 16, fontWeight: 700 }}
          >
            Quick workout
          </h2>
          <p
            style={{
              margin: "4px 0 0",
              fontSize: 13,
              color: "var(--cp-text-muted)",
              lineHeight: 1.4,
            }}
          >
            Generate one tuned to what&apos;s recovered, or build your own. It
            won&apos;t replace your planned workout — it&apos;s logged on top.
          </p>
        </div>
      }
    >
      <div
        role="tablist"
        aria-label="Quick workout type"
        data-testid="quick-modality-toggle"
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 4,
          padding: 4,
          background: "var(--cp-surface-soft)",
          borderRadius: 10,
          marginBottom: 16,
        }}
      >
        {(["strength", "hyrox"] as const).map((m) => {
          const active = modality === m;
          return (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`quick-modality-${m}`}
              onClick={() => setModality(m)}
              style={{
                padding: "8px 10px",
                borderRadius: 8,
                border: "none",
                cursor: "pointer",
                font: "inherit",
                fontSize: 13,
                fontWeight: 600,
                background: active ? "var(--cp-accent)" : "transparent",
                color: active ? "var(--cp-accent-fg)" : "var(--cp-text-muted)",
              }}
            >
              {m === "strength" ? "Strength" : "HYROX"}
            </button>
          );
        })}
      </div>

      {modality === "hyrox" ? (
        <div data-testid="quick-hyrox" style={{ display: "grid", gap: 12 }}>
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            What can you do right now?
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            {HYROX_STATION_LABELS.map(({ id, label }) => {
              const on = stations.has(id);
              return (
                <button
                  key={id}
                  type="button"
                  aria-pressed={on}
                  data-testid={`quick-hyrox-station-${id}`}
                  onClick={() => toggleStation(id)}
                  style={{
                    padding: "6px 12px",
                    borderRadius: 999,
                    border: "1px solid var(--cp-border)",
                    background: on ? "var(--cp-accent)" : "transparent",
                    color: on ? "var(--cp-accent-fg)" : "var(--cp-text)",
                    cursor: "pointer",
                    font: "inherit",
                    fontSize: 13,
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <GenerateTile
              length="short"
              label="Short"
              sublabel="~30 min"
              disabled={pending || !canGenerateHyrox}
              loading={pendingId === "hyrox:short"}
              onClick={() =>
                fire("hyrox:short", () =>
                  generateHyrox({ length: "short", stations: [...stations] }),
                )
              }
            />
            <GenerateTile
              length="normal"
              label="Normal"
              sublabel="up to ~60 min"
              disabled={pending || !canGenerateHyrox}
              loading={pendingId === "hyrox:normal"}
              onClick={() =>
                fire("hyrox:normal", () =>
                  generateHyrox({ length: "normal", stations: [...stations] }),
                )
              }
            />
          </div>
          <p
            style={{
              margin: "2px 0 0",
              fontSize: 11,
              color: "var(--cp-text-muted)",
              lineHeight: 1.4,
            }}
          >
            {canGenerateHyrox
              ? "Builds a station circuit, an erg/run, or a compromised run \u2014 picking whichever you\u2019re due for. Weights are set to your division standard."
              : "Pick an erg or run, or at least two stations, to generate."}
          </p>
        </div>
      ) : (
        <>
      <div
        data-testid="quick-workout-generate"
        style={{ display: "grid", gap: 8 }}
      >
        <div
          style={{
            fontSize: 11,
            letterSpacing: "0.1em",
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Generate for me
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <GenerateTile
            length="short"
            label="Short"
            sublabel="~30 min"
            disabled={pending}
            loading={pendingId === "generate:short"}
            onClick={() =>
              fire("generate:short", () => generateStrength({ length: "short" }))
            }
          />
          <GenerateTile
            length="normal"
            label="Normal"
            sublabel="up to ~60 min"
            disabled={pending}
            loading={pendingId === "generate:normal"}
            onClick={() =>
              fire("generate:normal", () =>
                generateStrength({ length: "normal" }),
              )
            }
          />
        </div>
        <p
          style={{
            margin: "2px 0 0",
            fontSize: 11,
            color: "var(--cp-text-muted)",
            lineHeight: 1.4,
          }}
        >
          Picks the freshest lift for today and fills accessories around the
          muscles you haven&apos;t hit recently.
        </p>
      </div>

      <div
        data-testid="quick-workout-tiles"
        style={{ display: "grid", gap: 10, marginTop: 20 }}
      >
        <StrengthTile
          disabled={pending}
          loading={pendingId === "strength"}
          onClick={() => fire("strength", () => startStrength())}
        />
      </div>

      {recent.length > 0 && (
        <div
          data-testid="quick-workout-recent"
          style={{ marginTop: 20, display: "grid", gap: 8 }}
        >
          <div
            style={{
              fontSize: 11,
              letterSpacing: "0.1em",
              color: "var(--cp-text-muted)",
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            Recent
          </div>
          {recent.map((s) => (
            <RecentRow
              key={s.id}
              candidate={s}
              disabled={pending}
              loading={pendingId === `repeat:${s.id}`}
              onRepeat={() =>
                fire(`repeat:${s.id}`, () => repeatRecent({ sessionId: s.id }))
              }
            />
          ))}
        </div>
      )}
        </>
      )}
    </BottomSheet>
  );
}

function StrengthTile({
  onClick,
  disabled,
  loading,
}: {
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid="quick-tile-strength"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 16,
        background: "var(--cp-bg)",
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
        color: "var(--cp-text)",
        font: "inherit",
        width: "100%",
      }}
    >
      <span
        aria-hidden
        style={{
          width: 36,
          height: 36,
          borderRadius: 999,
          background: "var(--cp-accent-soft)",
          color: "var(--cp-accent)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 18,
          fontWeight: 700,
          flex: "0 0 auto",
        }}
      >
        🏋️
      </span>
      <span style={{ display: "grid", gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 700 }}>Start empty</span>
        <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
          {loading ? "Starting…" : "build your own"}
        </span>
      </span>
    </button>
  );
}

function GenerateTile({
  length,
  label,
  sublabel,
  onClick,
  disabled,
  loading,
}: {
  length: "short" | "normal";
  label: string;
  sublabel: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  return (
    <button
      type="button"
      data-testid={`quick-tile-generate-${length}`}
      data-loading={loading ? "true" : "false"}
      onClick={onClick}
      disabled={disabled}
      className="cp-generate-tile"
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "flex-start",
        gap: 2,
        padding: 14,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !loading ? 0.5 : 1,
        textAlign: "left",
        color: "var(--cp-text)",
        font: "inherit",
        width: "100%",
      }}
    >
      <span style={{ fontSize: 14, fontWeight: 700 }}>
        {loading ? "Generating…" : label}
      </span>
      <span style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        {sublabel}
      </span>
    </button>
  );
}

function RecentRow({
  candidate,
  onRepeat,
  disabled,
  loading,
}: {
  candidate: QuickRepeatCandidate;
  onRepeat: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const dow = dayOfWeekShort(candidate.performedAt);
  return (
    <div
      data-testid={`quick-recent-${candidate.id}`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 12px",
        background: "var(--cp-bg)",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
      }}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {candidate.title ?? "Untitled"}
        </div>
        <div
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            marginTop: 2,
          }}
        >
          {candidate.summary} · {dow}
        </div>
      </div>
      <button
        type="button"
        className="cp-btn"
        data-testid={`quick-recent-repeat-${candidate.id}`}
        onClick={onRepeat}
        disabled={disabled}
        style={{ fontSize: 13, padding: "6px 12px" }}
      >
        {loading ? "Starting…" : "Repeat"}
      </button>
    </div>
  );
}

function dayOfWeekShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { weekday: "short" });
}
