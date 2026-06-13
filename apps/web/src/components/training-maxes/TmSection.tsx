"use client";

import { useRef, useState, useTransition } from "react";
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

/**
 * Client-side wrapper around the 1-rep-max settings UI.
 *
 * The page collects only the user's 1RM per lift. The working weights a program
 * trains at are a PROGRAM concern (5/3/1 / TB from the wizard template, Hybrid
 * from its Loadout intensity), seeded onto `training_maxes.tm_percent` at deploy
 * — so this page never asks for or shows a training-max %.
 */
export function TmSection({
  requiredGroups,
  otherRows,
  otherRowSourceSets,
  pickerGroups,
  hasActiveBlock,
  upsertAction,
  deleteAction,
  lockAction,
}: {
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
  upsertAction,
  deleteAction,
  lockAction,
}: {
  label: string;
  candidates: Candidate[];
  currentRow?: TmRow;
  currentRowSourceSet?: TmSourceSet | null;
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
        {status === "set" ? "✓ set" : "needs a 1RM"}
      </span>
    </div>
  );
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The lift's 1RM rendered as the prominent, directly-editable number on the
 * right of the card. Autosaves (debounced) via `upsertTrainingMax`; the program
 * owns the working-weight %, so there's nothing else to edit here.
 */
function InlineOneRm({
  movementId,
  movementName,
  initialKg,
  action,
}: {
  movementId: string;
  movementName: string;
  initialKg: number;
  action: (fd: FormData) => Promise<unknown>;
}) {
  const [val, setVal] = useState<string>(String(initialKg));
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<number>(initialKg);
  const [, startTransition] = useTransition();

  const save = (raw: string) => {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0 || n > 1000) return;
    if (n === lastSaved.current) return;
    const fd = new FormData();
    fd.set("movementId", movementId);
    fd.set("oneRmKg", raw);
    setStatus("saving");
    startTransition(async () => {
      try {
        const result = (await action(fd)) as
          | undefined
          | void
          | { ok: true }
          | { ok: false; error: string };
        if (result && typeof result === "object" && "ok" in result && result.ok === false) {
          setStatus("error");
          return;
        }
        lastSaved.current = n;
        setStatus("saved");
        window.setTimeout(() => setStatus((s) => (s === "saved" ? "idle" : s)), 1600);
      } catch {
        setStatus("error");
      }
    });
  };

  const onChange = (v: string) => {
    setVal(v);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => save(v), 600);
  };

  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 6, justifyContent: "flex-end" }}>
      <input
        type="number"
        step="0.5"
        min="1"
        max="1000"
        value={val}
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          save(val);
        }}
        inputMode="decimal"
        aria-label={`${movementName} 1RM in kg`}
        className="mono"
        style={{
          width: "5ch",
          padding: "2px 4px",
          fontSize: 18,
          fontWeight: 600,
          textAlign: "right",
          color: "var(--cp-accent)",
          background: "transparent",
          border: "none",
          borderBottom: "1px solid var(--cp-border-strong, var(--cp-border))",
        }}
      />
      <span style={{ fontSize: 13, color: "var(--cp-text-muted)" }}>kg</span>
      <span
        aria-hidden
        style={{
          fontSize: 11,
          width: 10,
          color:
            status === "saved"
              ? "var(--cp-success)"
              : status === "error"
                ? "var(--cp-danger)"
                : "var(--cp-text-muted)",
        }}
      >
        {status === "saving" ? "…" : status === "saved" ? "✓" : status === "error" ? "✗" : ""}
      </span>
    </div>
  );
}

function TmCard({
  row,
  sourceSet,
  upsertAction,
  deleteAction,
  lockAction,
}: {
  row: TmRow;
  sourceSet: TmSourceSet | null;
  upsertAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  return (
    <li
      data-testid={`tm-card-${row.id}`}
      data-source={row.source}
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{row.movementName}</div>
          {/* Provenance is only worth surfacing for ESTIMATED rows — an entered
              1RM is the default and shouldn't add noise. */}
          {row.source !== "entered" && (
            <TmSourceBadge source={row.source} formula={row.derivedFormula} />
          )}
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
          <InlineOneRm
            movementId={row.movementId}
            movementName={row.movementName}
            initialKg={row.oneRmKg}
            action={upsertAction}
          />
          <form action={deleteAction}>
            <input type="hidden" name="id" value={row.id} />
            <button
              type="submit"
              className="cp-btn ghost"
              style={{ fontSize: 11, color: "var(--cp-text-muted)", padding: "2px 6px" }}
              aria-label={`Remove ${row.movementName} 1RM`}
            >
              × remove
            </button>
          </form>
        </div>
      </div>

      {/* Derived-only "where did this estimate come from?" expander (returns null
          for entered rows). Lets the user lock an estimate as a deliberate 1RM. */}
      <TmSourceDetail row={row} sourceSet={sourceSet} lockAction={lockAction} />
    </li>
  );
}

// Re-export for convenience if needed.
export { TmCard };
