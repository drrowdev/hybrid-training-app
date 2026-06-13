/**
 * TrainingMaxesCard — right-rail summary of the user's strength TMs.
 *
 * Pure render. The parent fetches via `listTrainingMaxes()` and passes
 * the rows in. Sorted by movement name for stability.
 */

import Link from "next/link";
import type { TmRow } from "@/lib/training-maxes/queries";
import { TmSourceBadge } from "@/components/training-maxes/TmSourceBadge";
import {
  type WeightUnit,
  displayWeight,
  roundDisplayWeight,
  weightUnitLabel,
} from "@/lib/stats/units";

export function TrainingMaxesCard({ rows, units = "metric" }: { rows: TmRow[]; units?: WeightUnit }) {
  const sorted = [...rows].sort((a, b) =>
    a.movementName.localeCompare(b.movementName),
  );

  return (
    <section
      className="cp-card"
      style={{ padding: 18 }}
      aria-label="Training maxes"
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 12,
        }}
      >
        <h4 style={{ fontSize: 14, fontWeight: 700, margin: 0 }}>
          Training maxes
        </h4>
        <Link
          href="/app/settings"
          className="cp-link"
          style={{
            fontSize: 12,
            fontWeight: 500,
          }}
        >
          Edit
        </Link>
      </div>
      {sorted.length === 0 ? (
        <p
          style={{
            fontSize: 12,
            color: "var(--cp-text-muted)",
            margin: 0,
            lineHeight: 1.5,
          }}
        >
          No training maxes set yet.{" "}
          <Link
            href="/app/settings"
            className="cp-link"
          >
            Set them →
          </Link>
        </p>
      ) : (
        <>
          {sorted.map((r) => (
            <div
              key={r.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 8,
                padding: "8px 0",
                fontSize: 14,
                borderBottom: "1px solid var(--cp-border)",
              }}
            >
              <span
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                }}
              >
                <span>{r.movementName}</span>
                <TmSourceBadge source={r.source} formula={r.derivedFormula} compact />
              </span>
              <span
                className="mono"
                style={{
                  color: "var(--cp-text-muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {roundDisplayWeight(displayWeight(r.tmKg, units), units)}&nbsp;{weightUnitLabel(units)}
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}
