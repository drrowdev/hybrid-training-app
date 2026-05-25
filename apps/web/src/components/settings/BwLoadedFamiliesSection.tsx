"use client";

/**
 * Phase 7 — settings UI for loaded BW progression.
 *
 * Renders one row per loadable family with:
 *   - current node + applied external load (target_external_load_kg)
 *   - suggestLoadOrVariant verdict ("+2.5 kg" / "advance to {variant}")
 *   - Apply button that fires the matching server action
 *   - "loaded only" filter toggle controlling visibility
 *
 * Brand-purity (DC-Q6): copy is plain English, no methodology names.
 * Inline `var(--cp-*)` styling to match the rest of the settings
 * surface.
 */
import { useState, useTransition } from "react";
import {
  applyLoadIncrement,
  applyVariantAdvance,
} from "@/lib/settings/bw-loaded-actions";

export type LoadedFamilyRow = {
  family: string;
  familyLabel: string;
  currentNodeKey: string;
  currentNodeDisplayName: string;
  currentLoadKg: number;
  suggestion:
    | { kind: "hold"; reason: string }
    | { kind: "increase_load"; deltaKg: number; reason: string }
    | {
        kind: "advance_variant";
        toNodeKey: string;
        toNodeId: string;
        toNodeDisplayName: string;
        reason: string;
      };
};

export function BwLoadedFamiliesSection({ rows }: { rows: LoadedFamilyRow[] }) {
  const [loadedOnly, setLoadedOnly] = useState(false);
  const visible = loadedOnly ? rows.filter((r) => r.currentLoadKg > 0) : rows;
  if (rows.length === 0) {
    return (
      <section
        data-testid="bw-loaded-empty"
        style={{ display: "grid", gap: 8 }}
      >
        <h2 style={{ fontSize: 14, margin: 0 }}>Loaded bodyweight</h2>
        <p
          style={{
            margin: 0,
            fontSize: 12,
            color: "var(--cp-text-muted)",
            lineHeight: 1.5,
          }}
        >
          No loadable families on your current bodyweight rotation.
          Add a weighted vest, dip belt, or ankle weights in
          settings → equipment to unlock loaded variants.
        </p>
      </section>
    );
  }
  return (
    <section
      data-testid="bw-loaded-families"
      style={{ display: "grid", gap: 8 }}
    >
      <header
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <h2 style={{ fontSize: 14, margin: 0 }}>Loaded bodyweight</h2>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--cp-text-muted)",
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            data-testid="bw-loaded-only-toggle"
            checked={loadedOnly}
            onChange={(e) => setLoadedOnly(e.target.checked)}
          />
          Show loaded only
        </label>
      </header>
      <div style={{ display: "grid", gap: 6 }}>
        {visible.map((row) => (
          <LoadedFamilyCard key={row.family} row={row} />
        ))}
      </div>
    </section>
  );
}

function LoadedFamilyCard({ row }: { row: LoadedFamilyRow }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onApply = () => {
    setError(null);
    start(async () => {
      if (row.suggestion.kind === "hold") return;
      const fd = new FormData();
      fd.set("family", row.family);
      let res: { ok?: true; error?: string };
      if (row.suggestion.kind === "increase_load") {
        fd.set("deltaKg", String(row.suggestion.deltaKg));
        res = await applyLoadIncrement(fd);
      } else {
        fd.set("toNodeId", row.suggestion.toNodeId);
        res = await applyVariantAdvance(fd);
      }
      if (res.error) setError(res.error);
    });
  };

  const suggestionText = (() => {
    if (row.suggestion.kind === "hold") return row.suggestion.reason;
    if (row.suggestion.kind === "increase_load") {
      return `Suggested next: +${row.suggestion.deltaKg} kg`;
    }
    return `Suggested next: advance to ${row.suggestion.toNodeDisplayName}`;
  })();

  return (
    <div
      data-testid={`bw-loaded-row-${row.family}`}
      style={{
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 12,
        alignItems: "center",
        padding: "10px 14px",
        border: "1px solid var(--cp-border)",
        borderRadius: 10,
        background: "var(--cp-surface)",
      }}
    >
      <div style={{ display: "grid", gap: 4 }}>
        <span style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
          {row.familyLabel}
        </span>
        <span style={{ fontSize: 14, fontWeight: 600 }}>
          {row.currentNodeDisplayName}
          {row.currentLoadKg > 0 && (
            <span
              data-testid={`bw-loaded-badge-${row.family}`}
              style={{
                marginLeft: 8,
                padding: "1px 6px",
                borderRadius: 999,
                background: "var(--cp-accent-soft, var(--cp-surface))",
                color: "var(--cp-accent, var(--cp-text))",
                fontSize: 10,
                fontWeight: 600,
              }}
            >
              +{row.currentLoadKg} kg
            </span>
          )}
        </span>
        <span
          style={{
            fontSize: 11,
            color: "var(--cp-text-muted)",
            lineHeight: 1.4,
          }}
        >
          {suggestionText}
        </span>
        {error && (
          <span style={{ fontSize: 11, color: "var(--cp-danger, #b00020)" }}>
            {error}
          </span>
        )}
      </div>
      <button
        type="button"
        data-testid={`bw-loaded-apply-${row.family}`}
        disabled={row.suggestion.kind === "hold" || pending}
        onClick={onApply}
        style={{
          padding: "6px 12px",
          borderRadius: 8,
          border: "1px solid var(--cp-border)",
          background:
            row.suggestion.kind === "hold"
              ? "var(--cp-surface)"
              : "var(--cp-accent, var(--cp-text))",
          color:
            row.suggestion.kind === "hold"
              ? "var(--cp-text-muted)"
              : "var(--cp-on-accent, var(--cp-surface))",
          fontSize: 12,
          fontWeight: 600,
          cursor:
            row.suggestion.kind === "hold" || pending ? "default" : "pointer",
        }}
      >
        {pending ? "Applying…" : "Apply"}
      </button>
    </div>
  );
}
