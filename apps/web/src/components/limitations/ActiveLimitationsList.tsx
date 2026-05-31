"use client";
/**
 * ActiveLimitationsList — client wrapper around the active-limitation
 * cards on /app/recovery/injuries that adds a free-text search box.
 *
 * The list can grow long (one row per restriction), so past a small
 * threshold we show a search input that filters by kind, severity,
 * muscle / region labels, affected side, notes, and the resolved
 * affected-movement names. Filtering is purely client-side over the
 * already-loaded rows (max 100) — no extra round-trips.
 */
import { useMemo, useState } from "react";
import type { ReactElement } from "react";
import { MUSCLE_LABELS } from "@/lib/muscle/muscle-groups";
import {
  REGION_LABELS,
  type Region,
} from "@/lib/settings/limitations-constants";
import type { ProfileForFormat } from "@/lib/format/datetime";
import { ActiveLimitationCard } from "./ActiveLimitationCard";
import type { LimitationRow, MovementRef } from "./types";
import { matchesLimitationQuery } from "./utils";

const SEARCH_THRESHOLD = 4;

export type ActiveLimitationsListItem = {
  row: LimitationRow;
  movements: MovementRef[];
};

export function ActiveLimitationsList({
  items,
  formatProfile = null,
}: {
  items: ActiveLimitationsListItem[];
  formatProfile?: ProfileForFormat;
}): ReactElement {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (query.trim() === "") return items;
    return items.filter(({ row, movements }) =>
      matchesLimitationQuery(
        {
          kind: row.kind,
          severity: row.severity,
          side: row.affectedSide,
          notes: row.notes,
          regionLabel: row.region
            ? REGION_LABELS[row.region as Region] ?? row.region
            : null,
          muscleLabels: row.affectedMuscles.map(
            (m) => MUSCLE_LABELS[m] ?? m,
          ),
          movementNames: movements.map((m) => m.displayName),
        },
        query,
      ),
    );
  }, [items, query]);

  const showSearch = items.length >= SEARCH_THRESHOLD;

  return (
    <section data-testid="active-section" style={{ display: "grid", gap: 12 }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700 }}>
          Active{" "}
          <span
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: "var(--cp-text-muted)",
            }}
          >
            ({items.length})
          </span>
        </h2>
        {showSearch && (
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search limitations…"
            aria-label="Search active limitations"
            data-testid="active-limitations-search"
            className="cp-input"
            style={{ fontSize: 13, padding: "6px 10px", maxWidth: 240 }}
          />
        )}
      </div>

      {filtered.length === 0 ? (
        <p
          data-testid="active-limitations-empty"
          style={{ margin: 0, fontSize: 13, color: "var(--cp-text-muted)" }}
        >
          No limitations match &ldquo;{query.trim()}&rdquo;.
        </p>
      ) : (
        <div style={{ display: "grid", gap: 12 }}>
          {filtered.map(({ row, movements }) => (
            <ActiveLimitationCard
              key={row.id}
              row={row}
              movements={movements}
              formatProfile={formatProfile}
            />
          ))}
        </div>
      )}
    </section>
  );
}
