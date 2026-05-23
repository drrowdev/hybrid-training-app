/**
 * TrainingMaxesCard — right-rail summary of the user's strength TMs.
 *
 * Pure render. The parent fetches via `listTrainingMaxes()` and passes
 * the rows in. Sorted by movement name for stability.
 */

import Link from "next/link";
import type { TmRow } from "@/lib/training-maxes/queries";

export function TrainingMaxesCard({ rows }: { rows: TmRow[] }) {
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
          style={{
            fontSize: 12,
            color: "var(--cp-link)",
            textDecoration: "none",
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
            style={{ color: "var(--cp-link)" }}
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
                padding: "8px 0",
                fontSize: 14,
                borderBottom: "1px solid var(--cp-border)",
              }}
            >
              <span>{r.movementName}</span>
              <span
                className="mono"
                style={{
                  color: "var(--cp-text-muted)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {formatKg(r.tmKg)}&nbsp;kg
              </span>
            </div>
          ))}
        </>
      )}
    </section>
  );
}

function formatKg(n: number): string {
  // Trim trailing zeros so 100 → "100", 102.5 → "102.5".
  return Number.isInteger(n) ? n.toString() : n.toFixed(1).replace(/\.0$/, "");
}
