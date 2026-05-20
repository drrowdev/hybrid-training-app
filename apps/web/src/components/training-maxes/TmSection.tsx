"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import type { TmRow } from "@/lib/training-maxes/queries";
import { DefaultTmPercentControl } from "./DefaultTmPercentControl";
import { TmAutoForm } from "./TmAutoForm";

export type Candidate = { id: string; slug: string; display_name: string };
export type RoleGroupInput = {
  role: string;
  label: string;
  candidates: Candidate[];
  setRow?: TmRow;
};
export type PickerGroup = { label: string; items: { id: string; display_name: string }[] };

type Status = "idle" | "saving" | "saved" | "error";

function roundToPlate(kg: number, increment = 2.5): number {
  return Math.round(kg / increment) * increment;
}

/**
 * Client-side wrapper around the Training Maxes UI.
 *
 * Owns the live `defaultPercent` so changes propagate instantly to every
 * TM card (their displayed TM is recomputed from their stored 1RM × the
 * live default %, no server round-trip needed). The server-side persistence
 * happens in the background via the bound action props.
 */
export function TmSection({
  initialDefaultPercent,
  requiredGroups,
  otherRows,
  pickerGroups,
  hasActiveBlock,
  upsertAction,
  setDefaultAction,
  deleteAction,
}: {
  initialDefaultPercent: number;
  requiredGroups: RoleGroupInput[];
  otherRows: TmRow[];
  pickerGroups: PickerGroup[];
  hasActiveBlock: boolean;
  upsertAction: (fd: FormData) => Promise<unknown>;
  setDefaultAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
}) {
  const [defaultPercent, setDefaultPercent] = useState<number>(initialDefaultPercent);
  const [defaultStatus, setDefaultStatus] = useState<Status>("idle");
  const [defaultError, setDefaultError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<number>(initialDefaultPercent);
  const [, startTransition] = useTransition();

  const persistDefault = (n: number, immediate: boolean) => {
    if (!Number.isFinite(n) || n <= 0 || n > 100) return;
    if (timer.current) clearTimeout(timer.current);
    const fire = () => {
      if (n === lastSaved.current) return;
      const fd = new FormData();
      fd.set("percent", String(n));
      setDefaultStatus("saving");
      setDefaultError(null);
      startTransition(async () => {
        try {
          const result = (await setDefaultAction(fd)) as
            | undefined
            | void
            | { ok: true }
            | { ok: false; error: string };
          if (result && typeof result === "object" && "ok" in result && result.ok === false) {
            setDefaultStatus("error");
            setDefaultError(result.error);
            return;
          }
          lastSaved.current = n;
          setDefaultStatus("saved");
          window.setTimeout(() => setDefaultStatus((s) => (s === "saved" ? "idle" : s)), 1800);
        } catch (e) {
          setDefaultStatus("error");
          setDefaultError(e instanceof Error ? e.message : "Failed to save");
        }
      });
    };
    if (immediate) fire();
    else timer.current = setTimeout(fire, 600);
  };

  const handlePreset = (n: number) => {
    setDefaultPercent(n);
    persistDefault(n, true); // fire instantly on preset click
  };
  const handleFineTune = (n: number) => {
    setDefaultPercent(n);
    persistDefault(n, false); // debounce typed changes
  };

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          Default TM%
          <span className="cp-info" tabIndex={0} aria-label="Why these presets">
            i
            <span className="pop" style={{ width: 340 }}>
              The literature treats <strong>70–87.5% of true 1RM</strong> as the daily
              strength work zone, with <strong>≥85%</strong> needed on the heaviest
              exposure to maintain strength (Bickel 2011, HIGH).
              &gt;90% of 1RM is reserved for testing or short peaking blocks.
              <br /><br />
              The planner&apos;s intensity wave tops out at 95% of TM, so:
              <br />
              · <strong>TM 85%</strong> → top set ≈ 81% of 1RM (below maintenance floor)
              <br />
              · <strong>TM 90%</strong> → top set ≈ 85.5% of 1RM (right at the floor)
              <br />
              · <strong>TM 95%</strong> → top set ≈ 90.25% of 1RM (testing/peaking)
            </span>
          </span>
        </h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Used for every lift unless you set a per-movement override below.
        </p>
        <DefaultTmPercentControl
          value={defaultPercent}
          onPresetClick={handlePreset}
          onFineTune={handleFineTune}
          status={defaultStatus}
          errorMsg={defaultError}
        />
      </section>

      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: 0, fontSize: 16 }}>
          {hasActiveBlock ? "Required for your active block" : "Main lifts"}
        </h2>
        <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          {hasActiveBlock
            ? "Pick whichever variant you actually train per role."
            : "When you start a block, the planner needs a TM for at least one variant of each role here."}
        </p>
        <div style={{ display: "grid", gap: 14 }}>
          {requiredGroups.map((group) => (
            <RoleGroupCard
              key={group.role}
              label={group.label}
              candidates={group.candidates}
              currentRow={group.setRow}
              defaultPercent={defaultPercent}
              upsertAction={upsertAction}
              deleteAction={deleteAction}
            />
          ))}
        </div>
      </section>

      {otherRows.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: 0, fontSize: 16 }}>Other lifts</h2>
          <p style={{ margin: "4px 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            TMs you&apos;ve set that aren&apos;t required by the active focus.
          </p>
          <ul style={{ listStyle: "none", padding: 0, margin: 0, display: "grid", gap: 8 }}>
            {otherRows.map((r) => (
              <TmCard
                key={r.id}
                row={r}
                defaultPercent={defaultPercent}
                upsertAction={upsertAction}
                deleteAction={deleteAction}
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
          defaultPercent={defaultPercent}
          action={upsertAction}
        />
      </section>

      <div style={{ fontSize: 12, color: "var(--cp-text-muted)" }}>
        <Link href="/app/settings" style={{ color: "var(--cp-link)" }}>
          ← back to settings
        </Link>
      </div>
    </div>
  );
}

function RoleGroupCard({
  label,
  candidates,
  currentRow,
  defaultPercent,
  upsertAction,
  deleteAction,
}: {
  label: string;
  candidates: Candidate[];
  currentRow?: TmRow;
  defaultPercent: number;
  upsertAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
}) {
  return (
    <div>
      <RoleHeader label={label} status={currentRow ? "set" : "missing"} />
      {currentRow ? (
        <TmCard row={currentRow} defaultPercent={defaultPercent} upsertAction={upsertAction} deleteAction={deleteAction} />
      ) : (
        <TmAutoForm
          mode="new"
          candidates={candidates.map((c) => ({ id: c.id, display_name: c.display_name }))}
          defaultPercent={defaultPercent}
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
  defaultPercent,
  upsertAction,
  deleteAction,
}: {
  row: TmRow;
  defaultPercent: number;
  upsertAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
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
      style={{
        border: "1px solid var(--cp-border)",
        borderRadius: 12,
        padding: 14,
        display: "grid",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8 }}>
        <div style={{ fontSize: 15, fontWeight: 600 }}>{row.movementName}</div>
        <div style={{ textAlign: "right" }}>
          <div className="mono" style={{ fontSize: 18, fontWeight: 600, color: "var(--cp-accent)" }}>
            {displayTmKg} kg
          </div>
          <div style={{ fontSize: 11, color: "var(--cp-text-muted)" }}>
            TM ({displayPercent}% × {row.oneRmKg} kg)
          </div>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: 10, alignItems: "end" }}>
        <TmAutoForm
          mode="edit"
          initial={{
            movementId: row.movementId,
            movementName: row.movementName,
            oneRmKg: row.oneRmKg,
            tmPercent: row.tmPercentOverride,
          }}
          defaultPercent={defaultPercent}
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
// Suppress no-unused-import for useEffect (imported for parity with the autoform style; not directly used here).
void useEffect;
