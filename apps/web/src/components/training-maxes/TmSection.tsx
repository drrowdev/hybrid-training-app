"use client";

import { useMemo } from "react";
import type { TmRow, TmSourceSet } from "@/lib/training-maxes/queries";
import { TmAutoForm } from "./TmAutoForm";
import { TmSourceBadge } from "./TmSourceBadge";
import { TmSourceDetail } from "./TmSourceDetail";

export type Candidate = { id: string; slug: string; display_name: string };
export type RoleGroupInput = {
  role: string;
  label: string;
  candidates: Candidate[];
  setRow?: TmRow;
  setRowSourceSet?: TmSourceSet | null;
};
export type PickerGroup = { label: string; items: { id: string; display_name: string }[] };

function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

/**
 * Client-side wrapper around the Training Maxes UI.
 *
 * Each lift's working training max is derived from the user's 1RM × the loading
 * percentage their ACTIVE PROGRAM seeded onto `training_maxes.tm_percent` (5/3/1
 * and TB on the wizard's template/basis choice, Hybrid on its Loadout intensity).
 * This page no longer lets the user set a TM% directly — it's a program concern —
 * so it only collects the 1RM and shows the resulting TM read-only.
 */
export function TmSection({
  defaultPercent,
  requiredGroups,
  otherRows,
  otherRowSourceSets,
  pickerGroups,
  hasActiveBlock,
  upsertAction,
  deleteAction,
  lockAction,
}: {
  /** Fallback loading % used only to render a TM for a lift no program has seeded yet. */
  defaultPercent: number;
  requiredGroups: RoleGroupInput[];
  otherRows: TmRow[];
  otherRowSourceSets?: Record<string, TmSourceSet | null>;
  pickerGroups: PickerGroup[];
  hasActiveBlock: boolean;
  upsertAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          {hasActiveBlock ? "Required for your active program" : "Main lifts"}
        </h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          {hasActiveBlock
            ? "Pick whichever variant you actually train per role."
            : "When you start a program, the planner needs a 1RM for at least one variant of each role here."}
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          {requiredGroups.map((group) => (
            <RoleGroupCard
              key={group.role}
              label={group.label}
              candidates={group.candidates}
              currentRow={group.setRow}
              currentRowSourceSet={group.setRowSourceSet ?? null}
              defaultPercent={defaultPercent}
              upsertAction={upsertAction}
              deleteAction={deleteAction}
              lockAction={lockAction}
            />
          ))}
        </div>
      </section>

      {otherRows.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Other lifts</h2>
          <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            1RMs you&apos;ve set that aren&apos;t required by the active program.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {otherRows.map((r) => (
              <TmCard
                key={r.id}
                row={r}
                sourceSet={otherRowSourceSets?.[r.id] ?? null}
                defaultPercent={defaultPercent}
                upsertAction={upsertAction}
                deleteAction={deleteAction}
                lockAction={lockAction}
              />
            ))}
          </ul>
        </section>
      )}

      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>Add a max for any other lift</h2>
        <p style={{ margin: "4px 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Pick from the catalog of compound movements — autosaves once you select a movement and enter your 1RM.
        </p>
        <TmAutoForm
          mode="new"
          candidateGroups={pickerGroups}
          action={upsertAction}
        />
      </section>
    </div>
  );
}

function RoleGroupCard({
  label,
  candidates,
  currentRow,
  currentRowSourceSet,
  defaultPercent,
  upsertAction,
  deleteAction,
  lockAction,
}: {
  label: string;
  candidates: Candidate[];
  currentRow?: TmRow;
  currentRowSourceSet?: TmSourceSet | null;
  defaultPercent: number;
  upsertAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  return (
    <div>
      <RoleHeader label={label} status={currentRow ? "set" : "missing"} />
      {currentRow ? (
        <TmCard
          row={currentRow}
          sourceSet={currentRowSourceSet ?? null}
          defaultPercent={defaultPercent}
          upsertAction={upsertAction}
          deleteAction={deleteAction}
          lockAction={lockAction}
        />
      ) : (
        <TmAutoForm
          mode="new"
          candidates={candidates.map((c) => ({ id: c.id, display_name: c.display_name }))}
          action={upsertAction}
        />
      )}
    </div>
  );
}

function RoleHeader({ label, status }: { label: string; status: "set" | "missing" }) {
  return (
    <div
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "baseline",
        marginBottom: 6,
      }}
    >
      <div
        style={{
          fontSize: 11,
          textTransform: "uppercase",
          letterSpacing: "0.08em",
          color: "var(--cp-text-muted)",
          fontWeight: 600,
        }}
      >
        {label}
      </div>
      <span
        className="cp-pill"
        style={{
          color: status === "set" ? "var(--cp-success)" : "var(--cp-danger)",
          borderColor: status === "set" ? "var(--cp-success)" : "var(--cp-danger)",
        }}
      >
        {status === "set" ? "✓ set" : "needs a TM"}
      </span>
    </div>
  );
}

function TmCard({
  row,
  sourceSet,
  defaultPercent,
  upsertAction,
  deleteAction,
  lockAction,
}: {
  row: TmRow;
  sourceSet: TmSourceSet | null;
  defaultPercent: number;
  upsertAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  // Live-compute the displayed TM from the user's stored 1RM × the live default %
  // (or the per-movement override if set). This is what makes preset clicks feel snappy.
  const { displayTmKg, displayPercent } = useMemo(() => {
    const pct = row.tmPercentOverride ?? defaultPercent;
    return {
      displayPercent: pct,
      displayTmKg: roundToPlate((row.oneRmKg * pct) / 100),
    };
  }, [row.oneRmKg, row.tmPercentOverride, defaultPercent]);

  return (
    <li
      data-testid={`tm-card-${row.id}`}
      data-source={row.source}
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{row.movementName}</div>
          <TmSourceBadge source={row.source} formula={row.derivedFormula} />
        </div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--cp-accent)" }}>
            {displayTmKg} kg
          </div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            TM ({displayPercent}% × {row.oneRmKg} kg)
          </div>
        </div>
      </div>

      <TmSourceDetail row={row} sourceSet={sourceSet} lockAction={lockAction} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <TmAutoForm
          mode="edit"
          initial={{
            movementId: row.movementId,
            movementName: row.movementName,
            oneRmKg: row.oneRmKg,
          }}
          action={upsertAction}
        />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className="cp-btn ghost"
            style={{ fontSize: 11, color: "var(--cp-text-muted)", padding: "6px 10px" }}
            aria-label={`Remove ${row.movementName} training max`}
          >
            × remove
          </button>
        </form>
      </div>
    </li>
  );
}

// Re-export for convenience if needed.
export { TmCard };
