"use client";

import { useRef, useState, useTransition } from "react";
import type { TmRow, TmSourceSet } from "@/lib/training-maxes/queries";
import { TmAutoForm } from "./TmAutoForm";
import { TmSourceBadge } from "./TmSourceBadge";
import { TmSourceDetail } from "./TmSourceDetail";
import styles from "./TmSection.module.css";

export type Candidate = { id: string; slug: string; display_name: string };
export type RoleGroupInput = {
  role: string;
  label: string;
  candidates: Candidate[];
  setRow?: TmRow;
  setRowSourceSet?: TmSourceSet | null;
};
export type PickerGroup = { label: string; items: { id: string; display_name: string }[] };

type SaveStatus = "idle" | "saving" | "saved" | "error";

/**
 * The 1-rep-max settings UI, styled to mirror the program wizard's benchmarks
 * step: one row per main lift with an uppercase role heading, a boxless variant
 * dropdown, and a boxed, directly-editable 1RM on the right.
 *
 * The page only collects the 1RM — the working weights a program trains at are a
 * PROGRAM concern (seeded onto `training_maxes.tm_percent` at deploy), so there's
 * no training-max % anywhere on this page.
 */
export function TmSection({
  requiredGroups,
  otherRows,
  otherRowSourceSets,
  pickerGroups,
  hasActiveBlock,
  upsertAction,
  moveAction,
  deleteAction,
  lockAction,
}: {
  requiredGroups: RoleGroupInput[];
  otherRows: TmRow[];
  otherRowSourceSets?: Record<string, TmSourceSet | null>;
  pickerGroups: PickerGroup[];
  hasActiveBlock: boolean;
  upsertAction: (fd: FormData) => Promise<unknown>;
  moveAction: (fd: FormData) => Promise<unknown>;
  deleteAction: (fd: FormData) => Promise<void>;
  lockAction: (fd: FormData) => Promise<unknown>;
}) {
  const setCount = requiredGroups.filter((g) => g.setRow).length;
  const total = requiredGroups.length;
  const allSet = setCount === total;

  return (
    <div style={{ display: "grid", gap: 20 }}>
      <section className="cp-card" style={{ padding: 20 }}>
        <div className={styles.head}>
          <span className={styles.headLabel}>Main lifts</span>
          <span className={`${styles.pill}${allSet ? "" : ` ${styles.pillWarn}`}`}>
            {allSet
              ? `✓ ${total} main lift${total === 1 ? "" : "s"}`
              : `${setCount}/${total} set`}
          </span>
        </div>
        <div className={styles.lifts}>
          {requiredGroups.map((group) => (
            <MainLiftRow
              key={group.role}
              roleLabel={group.label}
              candidates={group.candidates}
              setRow={group.setRow}
              upsertAction={upsertAction}
              moveAction={moveAction}
            />
          ))}
        </div>
        {hasActiveBlock && (
          <p className={styles.note}>
            🔒 Your active program turns these 1-rep maxes into the working weights it
            prescribes.
          </p>
        )}
      </section>

      {otherRows.length > 0 && (
        <section className="cp-card" style={{ padding: 20 }}>
          <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Other lifts</h2>
          <p style={{ margin: "0 0 14px", fontSize: 12, color: "var(--cp-text-muted)" }}>
            1-rep maxes you&apos;ve set that aren&apos;t required by the active program.
          </p>
          <div className={styles.lifts}>
            {otherRows.map((r) => (
              <OtherLiftRow
                key={r.id}
                row={r}
                sourceSet={otherRowSourceSets?.[r.id] ?? null}
                upsertAction={upsertAction}
                deleteAction={deleteAction}
                lockAction={lockAction}
              />
            ))}
          </div>
        </section>
      )}

      <section className="cp-card" style={{ padding: 20 }}>
        <h2 style={{ margin: "0 0 4px", fontSize: 16 }}>Add a max for any other lift</h2>
        <p style={{ margin: "0 0 12px", fontSize: 12, color: "var(--cp-text-muted)" }}>
          Pick from the catalog of compound movements — autosaves once you select a movement and enter your 1RM.
        </p>
        <TmAutoForm mode="new" candidateGroups={pickerGroups} action={upsertAction} />
      </section>
    </div>
  );
}

/**
 * A boxed, debounced 1RM number input that autosaves via `upsertTrainingMax` for
 * the given movement. Renders the small saved/error tick to the left.
 */
function OneRmInput({
  movementId,
  ariaLabel,
  initialKg,
  action,
}: {
  movementId: string;
  ariaLabel: string;
  initialKg: number | null;
  action: (fd: FormData) => Promise<unknown>;
}) {
  const [val, setVal] = useState<string>(initialKg != null ? String(initialKg) : "");
  const [status, setStatus] = useState<SaveStatus>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSaved = useRef<number | null>(initialKg);
  const [, startTransition] = useTransition();

  const save = (raw: string) => {
    if (!movementId) return;
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
    <div className={styles.right}>
      <span
        aria-hidden
        className={`${styles.status}${
          status === "saved" ? ` ${styles.statusSaved}` : status === "error" ? ` ${styles.statusErr}` : ""
        }`}
      >
        {status === "saving" ? "…" : status === "saved" ? "✓" : status === "error" ? "✗" : ""}
      </span>
      <span className={styles.inp}>
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
          aria-label={ariaLabel}
        />
        <span className={styles.unit}>kg</span>
      </span>
    </div>
  );
}

/**
 * A required main-lift row: uppercase role heading + a variant dropdown
 * (switching it moves the 1RM onto the chosen variant) + the boxed 1RM input.
 */
function MainLiftRow({
  roleLabel,
  candidates,
  setRow,
  upsertAction,
  moveAction,
}: {
  roleLabel: string;
  candidates: Candidate[];
  setRow?: TmRow;
  upsertAction: (fd: FormData) => Promise<unknown>;
  moveAction: (fd: FormData) => Promise<unknown>;
}) {
  const initialVariant = setRow?.movementId ?? candidates[0]?.id ?? "";
  const [variantId, setVariantId] = useState<string>(initialVariant);
  const [, startTransition] = useTransition();

  const onVariant = (newId: string) => {
    setVariantId(newId);
    // If a 1RM already exists for this role, move it onto the chosen variant so
    // the role keeps exactly one number. With no row yet, just retarget entry.
    if (setRow && newId !== setRow.movementId) {
      const fd = new FormData();
      fd.set("fromMovementId", setRow.movementId);
      fd.set("toMovementId", newId);
      startTransition(async () => {
        await moveAction(fd);
      });
    }
  };

  return (
    <div className={styles.lift}>
      <div className={styles.linfo}>
        <span className={styles.ln}>{roleLabel}</span>
        {candidates.length > 1 ? (
          <select
            className={styles.variantSel}
            value={variantId}
            onChange={(e) => onVariant(e.target.value)}
            aria-label={`${roleLabel} variant`}
          >
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.display_name}
              </option>
            ))}
          </select>
        ) : (
          <span className={styles.variantStatic}>
            {candidates[0]?.display_name ?? setRow?.movementName}
          </span>
        )}
      </div>
      <OneRmInput
        // Remount the input when the targeted variant changes so it re-seeds
        // from the (possibly moved) row's value.
        key={variantId}
        movementId={variantId}
        ariaLabel={`${roleLabel} 1RM in kg`}
        initialKg={variantId === setRow?.movementId ? setRow?.oneRmKg ?? null : null}
        action={upsertAction}
      />
    </div>
  );
}

/**
 * An "other lift" row — a movement the user set that isn't required by the active
 * program. Name + provenance (estimated only) on the left, editable 1RM + remove
 * on the right.
 */
function OtherLiftRow({
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
    <div
      data-testid={`tm-card-${row.id}`}
      data-source={row.source}
      className={styles.lift}
      style={{ flexWrap: "wrap" }}
    >
      <div className={styles.linfo}>
        <span className={styles.ln}>{row.movementName}</span>
        {row.source !== "entered" && (
          <TmSourceBadge source={row.source} formula={row.derivedFormula} />
        )}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <OneRmInput
          movementId={row.movementId}
          ariaLabel={`${row.movementName} 1RM in kg`}
          initialKg={row.oneRmKg}
          action={upsertAction}
        />
        <form action={deleteAction}>
          <input type="hidden" name="id" value={row.id} />
          <button
            type="submit"
            className={styles.rm}
            aria-label={`Remove ${row.movementName} 1RM`}
          >
            ✕
          </button>
        </form>
      </div>
      <div style={{ flexBasis: "100%" }}>
        <TmSourceDetail row={row} sourceSet={sourceSet} lockAction={lockAction} />
      </div>
    </div>
  );
}
