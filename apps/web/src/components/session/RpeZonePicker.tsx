"use client";

/**
 * Zone-based RPE picker for the per-set logging surface.
 *
 * Renders a 2×2 grid of large tap-target cards: Easy / Moderate / Hard
 * / Max effort. Tap selects the zone. The component persists the
 * MIDPOINT of the chosen zone as a numeric so the DB schema for
 * `set_logs.rpe` is unchanged (see lib/sessions/rpe-zones.ts).
 *
 * The component is hidden by the caller for warm-up sets — there is
 * no setKind handling here, that's the parent's job.
 */

import {
  RPE_ZONES,
  ZONE_LABELS,
  ZONE_MIDPOINTS,
  ZONE_RANGES,
  ZONE_TOKEN,
  zoneForRpe,
  type RpeZone,
} from "@/lib/sessions/rpe-zones";

export type RpeZonePickerProps = {
  /** Persisted numeric RPE (6 – 10). Maps back to a zone via zoneForRpe. */
  value?: number | null;
  /** Called with the zone midpoint, or null when the user clears. */
  onChange: (rpe: number | null) => void;
  disabled?: boolean;
  compact?: boolean;
};

export function RpeZonePicker({
  value,
  onChange,
  disabled,
  compact = false,
}: RpeZonePickerProps) {
  const active = zoneForRpe(value);

  return (
    <div
      data-testid="rpe-zone-picker"
      data-active-zone={active ?? ""}
      style={{ display: "grid", gap: 8 }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 8,
        }}
      >
        <div
          style={{
            fontSize: 10,
            color: "var(--cp-text-muted)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            fontWeight: 600,
          }}
        >
          How did it feel?
        </div>
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled || active == null}
          data-testid="rpe-zone-clear"
          style={{
            all: "unset",
            cursor: disabled || active == null ? "default" : "pointer",
            fontSize: 11,
            color:
              disabled || active == null
                ? "var(--cp-text-muted)"
                : "var(--cp-accent)",
            textDecoration: "underline",
            opacity: disabled || active == null ? 0.5 : 1,
          }}
        >
          clear
        </button>
      </div>

      <div
        role="radiogroup"
        aria-label="How did it feel?"
        style={{
          display: "grid",
          gridTemplateColumns: compact ? "repeat(4, 1fr)" : "1fr 1fr",
          gap: compact ? 6 : 8,
        }}
      >
        {RPE_ZONES.map((zone) => (
          <ZoneCard
            key={zone}
            zone={zone}
            selected={active === zone}
            disabled={!!disabled}
            compact={compact}
            onPick={() => onChange(ZONE_MIDPOINTS[zone])}
          />
        ))}
      </div>
    </div>
  );
}

function ZoneCard({
  zone,
  selected,
  disabled,
  onPick,
  compact,
}: {
  zone: RpeZone;
  selected: boolean;
  disabled: boolean;
  onPick: () => void;
  compact: boolean;
}) {
  const token = ZONE_TOKEN[zone];
  const bg = selected
    ? `color-mix(in oklab, ${token} 16%, transparent)`
    : "var(--cp-surface)";
  const border = selected
    ? token
    : `color-mix(in oklab, ${token} 45%, var(--cp-border))`;

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onPick}
      disabled={disabled}
      data-testid={`rpe-zone-${zone}`}
      data-selected={selected ? "true" : "false"}
      style={{
        all: "unset",
        cursor: disabled ? "default" : "pointer",
        minHeight: compact ? 42 : 64,
        padding: compact ? "8px 6px" : "10px 12px",
        borderRadius: compact ? 10 : 12,
        background: bg,
        border: `${selected ? 2 : 1}px solid ${border}`,
        display: "grid",
        gap: compact ? 0 : 4,
        textAlign: "center",
        opacity: disabled ? 0.55 : 1,
        transition: "background 140ms ease-out, border-color 140ms ease-out",
      }}
    >
      <div
        style={{
          fontSize: compact ? 12 : 15,
          fontWeight: 700,
          color: selected ? token : "var(--cp-text)",
          lineHeight: 1.1,
        }}
      >
        {ZONE_LABELS[zone]}
      </div>
      {!compact && (
        <div
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
          }}
        >
          RPE {ZONE_RANGES[zone]}
        </div>
      )}
    </button>
  );
}
